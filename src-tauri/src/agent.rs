//! Chat-style agent: the CLI runs headless with JSON lines in and out
//! (`claude -p --input-format stream-json --output-format stream-json`), and the
//! UI renders those events as a conversation instead of a raw TUI.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentState {
    Running,
    Idle,
    Terminated,
}

/// Saved next to the transcript so an agent can be resumed after a restart.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentMeta {
    pub adapter_id: String,
    pub permission_mode: String,
    pub cli_session_id: Option<String>,
}

pub struct Files {
    pub meta: PathBuf,
    pub transcript: PathBuf,
}

impl Files {
    /// <project_dir>/agents/<worktree folder>.{json,jsonl}
    pub fn new(project_dir: &Path, worktree_path: &str) -> Files {
        let name = Path::new(worktree_path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let dir = project_dir.join("agents");
        Files { meta: dir.join(format!("{name}.json")), transcript: dir.join(format!("{name}.jsonl")) }
    }

    pub fn read_meta(&self) -> Option<AgentMeta> {
        serde_json::from_str(&std::fs::read_to_string(&self.meta).ok()?).ok()
    }

    pub fn write_meta(&self, meta: &AgentMeta) -> Result<(), String> {
        std::fs::create_dir_all(self.meta.parent().unwrap()).map_err(|e| e.to_string())?;
        std::fs::write(&self.meta, serde_json::to_string_pretty(meta).unwrap()).map_err(|e| e.to_string())
    }

    pub fn read_transcript(&self) -> Vec<Value> {
        std::fs::read_to_string(&self.transcript)
            .unwrap_or_default()
            .lines()
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect()
    }
}

/// Event "agent://event": one transcript line. `seq` is its 1-based index, so a view
/// that loaded the transcript can skip live events it already has.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AgentEvent {
    worktree_path: String,
    seq: u64,
    event: Value,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AgentStateEvent {
    worktree_path: String,
    state: AgentState,
}

/// Append-only jsonl transcript shared by the stdout reader and the sender.
struct Transcript {
    file: File,
    count: u64,
}

pub struct Agent {
    stdin: Mutex<ChildStdin>,
    child: Arc<Mutex<Child>>,
    transcript: Arc<Mutex<Transcript>>,
    pub state: Arc<Mutex<AgentState>>,
    app: AppHandle,
    worktree_path: String,
}

fn emit_state(app: &AppHandle, path: &str, cur: &Mutex<AgentState>, next: AgentState) {
    let mut cur = cur.lock().unwrap();
    if *cur == AgentState::Terminated || *cur == next {
        return;
    }
    *cur = next.clone();
    let _ = app.emit("agent://state", AgentStateEvent { worktree_path: path.into(), state: next });
}

fn record(app: &AppHandle, path: &str, t: &Mutex<Transcript>, event: Value) {
    let mut t = t.lock().unwrap();
    let _ = writeln!(t.file, "{event}");
    t.count += 1;
    let _ = app.emit("agent://event", AgentEvent { worktree_path: path.into(), seq: t.count, event });
}

/// Only what the chat view renders; hooks, rate limits and summaries are dropped.
fn keep(ev: &Value) -> bool {
    match ev["type"].as_str() {
        Some("assistant") | Some("user") | Some("result") => true,
        Some("system") => ev["subtype"] == "init",
        _ => false,
    }
}

/// shortcut: Claude Code only; add an argv builder per CLI when Codex etc. are wired in.
fn argv(meta: &AgentMeta) -> Result<Vec<String>, String> {
    if meta.adapter_id != "claude-code" {
        return Err(format!("지원하지 않는 에이전트: {}", meta.adapter_id));
    }
    let mut a: Vec<String> = ["claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--permission-mode"]
        .iter().map(|s| s.to_string()).collect();
    a.push(meta.permission_mode.clone());
    if let Some(id) = &meta.cli_session_id {
        a.extend(["--resume".into(), id.clone()]);
    }
    // npm installs CLIs as .cmd shims, which CreateProcess cannot run directly
    if cfg!(windows) {
        a.splice(0..0, ["cmd.exe".to_string(), "/c".to_string()]);
    }
    Ok(a)
}

impl Agent {
    pub fn spawn(app: AppHandle, worktree_path: &str, files: Files, meta: AgentMeta) -> Result<Agent, String> {
        let argv = argv(&meta)?;
        let mut cmd = Command::new(&argv[0]);
        cmd.args(&argv[1..])
            .current_dir(worktree_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // If Maestro itself was launched from a Claude Code session, don't make every agent look like its child.
            .env_remove("CLAUDECODE")
            .env_remove("CLAUDE_CODE_CHILD_SESSION");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd.spawn().map_err(|e| format!("에이전트 실행 실패: {e}"))?;
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();

        std::fs::create_dir_all(files.transcript.parent().unwrap()).map_err(|e| e.to_string())?;
        let count = files.read_transcript().len() as u64;
        let file = OpenOptions::new().create(true).append(true).open(&files.transcript).map_err(|e| e.to_string())?;
        let transcript = Arc::new(Mutex::new(Transcript { file, count }));
        let state = Arc::new(Mutex::new(AgentState::Idle));
        let child = Arc::new(Mutex::new(child));
        let path = worktree_path.to_string();

        let (a, p, t, st, meta_path) = (app.clone(), path.clone(), transcript.clone(), state.clone(), files.meta.clone());
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Ok(ev) = serde_json::from_str::<Value>(&line) else { continue };
                if ev["type"] == "system" && ev["subtype"] == "init" {
                    // remember the CLI's session so the next launch can --resume it
                    if let Some(id) = ev["session_id"].as_str() {
                        let f = Files { meta: meta_path.clone(), transcript: PathBuf::new() };
                        if let Some(mut m) = f.read_meta() {
                            if m.cli_session_id.as_deref() != Some(id) {
                                m.cli_session_id = Some(id.into());
                                let _ = f.write_meta(&m);
                            }
                        }
                    }
                }
                if ev["type"] == "result" {
                    emit_state(&a, &p, &st, AgentState::Idle);
                }
                if keep(&ev) {
                    record(&a, &p, &t, ev);
                }
            }
        });

        let (a, p, t) = (app.clone(), path.clone(), transcript.clone());
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if !line.trim().is_empty() {
                    record(&a, &p, &t, json!({ "type": "stderr", "text": line }));
                }
            }
        });

        let (a, p, t, st, ch) = (app.clone(), path.clone(), transcript.clone(), state.clone(), child.clone());
        thread::spawn(move || loop {
            thread::sleep(Duration::from_millis(500));
            let status = ch.lock().unwrap().try_wait();
            match status {
                Ok(None) => continue,
                Ok(Some(code)) => {
                    record(&a, &p, &t, json!({ "type": "exit", "code": code.code() }));
                    emit_state(&a, &p, &st, AgentState::Terminated);
                    break;
                }
                Err(_) => break,
            }
        });

        Ok(Agent { stdin: Mutex::new(stdin), child, transcript, state, app, worktree_path: path })
    }

    pub fn alive(&self) -> bool {
        *self.state.lock().unwrap() != AgentState::Terminated
    }

    /// One user turn. Attached paths are listed in plain text; the agent reads them with its own tools.
    pub fn send(&self, text: &str, files: &[String]) -> Result<(), String> {
        let mut body = text.to_string();
        if !files.is_empty() {
            body.push_str(&format!("\n\n[첨부 파일 — 작업 폴더 기준 경로] {}", files.join(", ")));
        }
        let line = json!({ "type": "user", "message": { "role": "user", "content": [{ "type": "text", "text": body }] } });
        {
            let mut w = self.stdin.lock().unwrap();
            writeln!(w, "{line}").and_then(|_| w.flush()).map_err(|e| format!("에이전트에 전송 실패: {e}"))?;
        }
        record(&self.app, &self.worktree_path, &self.transcript, json!({ "type": "user_input", "text": text, "files": files }));
        emit_state(&self.app, &self.worktree_path, &self.state, AgentState::Running);
        Ok(())
    }

    /// Kills the whole process tree (cmd.exe → node → tools on Windows).
    pub fn kill(&self) {
        let mut child = self.child.lock().unwrap();
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let _ = Command::new("taskkill")
                .args(["/PID", &child.id().to_string(), "/T", "/F"])
                .creation_flags(0x0800_0000)
                .output();
        }
        let _ = child.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_chat_events() {
        assert!(keep(&json!({"type": "assistant"})));
        assert!(keep(&json!({"type": "result"})));
        assert!(keep(&json!({"type": "system", "subtype": "init"})));
        assert!(!keep(&json!({"type": "system", "subtype": "hook_response"})));
        assert!(!keep(&json!({"type": "rate_limit_event"})));
    }

    #[test]
    fn argv_resumes_saved_session() {
        let m = AgentMeta { adapter_id: "claude-code".into(), permission_mode: "acceptEdits".into(), cli_session_id: Some("abc".into()) };
        let a = argv(&m).unwrap();
        assert!(a.windows(2).any(|w| w == ["--permission-mode", "acceptEdits"]));
        assert!(a.windows(2).any(|w| w == ["--resume", "abc"]));
        assert!(argv(&AgentMeta { adapter_id: "x".into(), ..m }).is_err());
    }
}
