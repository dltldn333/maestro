#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod pty;
mod worktree;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use pty::Pty;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

struct Session {
    project_root: String,
    worktree_path: PathBuf,
    branch_name: String,
    port: Option<u16>,
    pty: Pty,
}

#[derive(Default)]
struct AppState {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    next_id: Mutex<u64>,
}

impl AppState {
    fn get(&self, id: &str) -> Result<Arc<Session>, String> {
        self.sessions.lock().unwrap().get(id).cloned().ok_or_else(|| format!("세션이 없습니다: {id}"))
    }
}

/// shortcut: hardcoded adapters; move to ~/.maestro/adapters_registry.json when a second CLI is needed.
fn adapter_argv(adapter_id: &str) -> Result<Vec<String>, String> {
    let bin = match adapter_id {
        "claude-code" => "claude",
        "shell" if cfg!(windows) => return Ok(vec!["powershell.exe".into(), "-NoLogo".into()]),
        "shell" => return Ok(vec![std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())]),
        _ => return Err(format!("알 수 없는 어댑터: {adapter_id}")),
    };
    // npm installs CLIs as .cmd shims, which CreateProcess cannot run directly
    Ok(if cfg!(windows) { vec!["cmd.exe".into(), "/c".into(), bin.into()] } else { vec![bin.into()] })
}

#[tauri::command]
fn open_project(path: String) -> Result<String, String> {
    worktree::toplevel(&path)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpawnWorktreeAgentReq {
    project_root: String,
    adapter_id: String,
    branch_name: String,
    base_branch: String,
    cols: u16,
    rows: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpawnWorktreeAgentRes {
    session_id: String,
    worktree_path: String,
    branch_name: String,
    allocated_port: Option<u16>,
}

// async commands run off the main thread, so git and sleeps here don't freeze the window
#[tauri::command]
async fn spawn_worktree_agent(app: AppHandle, state: State<'_, AppState>, req: SpawnWorktreeAgentReq) -> Result<SpawnWorktreeAgentRes, String> {
    let argv = adapter_argv(&req.adapter_id)?;
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let pdir = worktree::project_dir(&home, &req.project_root);
    let (path, branch) = worktree::create(&req.project_root, &pdir, &req.branch_name, &req.base_branch)?;

    let session_id = {
        let mut n = state.next_id.lock().unwrap();
        *n += 1;
        format!("s{}", *n)
    };
    let port = {
        let used: Vec<u16> = state.sessions.lock().unwrap().values().filter_map(|s| s.port).collect();
        (3001..=3099).find(|p| !used.contains(p))
    };
    let pty = match Pty::spawn(app, session_id.clone(), &argv, &path, port, req.cols, req.rows) {
        Ok(p) => p,
        Err(e) => {
            // don't leave an orphan worktree behind a failed spawn
            let _ = worktree::discard(&req.project_root, &path, &branch);
            return Err(e);
        }
    };
    let session = Session { project_root: req.project_root, worktree_path: path.clone(), branch_name: branch.clone(), port, pty };
    state.sessions.lock().unwrap().insert(session_id.clone(), Arc::new(session));
    Ok(SpawnWorktreeAgentRes {
        session_id,
        worktree_path: path.to_string_lossy().into(),
        branch_name: branch,
        allocated_port: port,
    })
}

/// Solo/Tutti: same prompt to every bound session, wrapped in bracketed paste so
/// embedded newlines don't submit early.
#[tauri::command]
async fn dispatch_prompt_to_sessions(state: State<'_, AppState>, session_ids: Vec<String>, prompt: String, context_files: Vec<String>) -> Result<(), String> {
    let refs: String = context_files.iter().map(|p| format!("@{p} ")).collect();
    let paste = format!("\x1b[200~{refs}{prompt}\x1b[201~");
    let sessions = session_ids.iter().map(|id| state.get(id)).collect::<Result<Vec<_>, _>>()?;
    for s in &sessions {
        s.pty.write(paste.as_bytes())?;
    }
    // TUIs can treat Enter arriving in the same read as the paste as part of it
    std::thread::sleep(Duration::from_millis(60));
    for s in &sessions {
        s.pty.write(b"\r")?;
    }
    Ok(())
}

#[tauri::command]
fn write_raw_stdin(state: State<AppState>, session_id: String, data_b64: String) -> Result<(), String> {
    let bytes = B64.decode(data_b64).map_err(|e| e.to_string())?;
    state.get(&session_id)?.pty.write(&bytes)
}

#[tauri::command]
fn resize_pty(state: State<AppState>, session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    state.get(&session_id)?.pty.resize(cols, rows)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Scrollback {
    data_b64: String,
    seq: u64,
}

#[tauri::command]
fn get_session_scrollback(state: State<AppState>, session_id: String) -> Result<Scrollback, String> {
    let s = state.get(&session_id)?;
    let sb = s.pty.scrollback.lock().unwrap();
    Ok(Scrollback { data_b64: B64.encode(&sb.buf), seq: sb.total })
}

/// Stops the process but keeps the session, so its worktree can still be discarded.
#[tauri::command]
fn kill_session(state: State<AppState>, session_id: String) -> Result<(), String> {
    state.get(&session_id)?.pty.kill();
    Ok(())
}

/// Session ids still known to the backend, so a reopened canvas can tell live nodes from dead ones.
#[tauri::command]
fn list_sessions(state: State<AppState>, project_root: String) -> Vec<String> {
    state.sessions.lock().unwrap().iter().filter(|(_, s)| s.project_root == project_root).map(|(id, _)| id.clone()).collect()
}

/// Kill + `git worktree remove --force` + delete branch.
#[tauri::command]
async fn discard_session(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let s = state.sessions.lock().unwrap().remove(&session_id).ok_or("세션이 없습니다")?;
    s.pty.kill();
    std::thread::sleep(Duration::from_millis(300)); // let the process release file handles (Windows)
    worktree::discard(&s.project_root, &s.worktree_path, &s.branch_name)
}

fn canvas_path(app: &AppHandle, project_root: &str) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(worktree::project_dir(&home, project_root).join("canvas_state.json"))
}

#[tauri::command]
fn load_canvas_state(app: AppHandle, project_root: String) -> Result<Option<String>, String> {
    match std::fs::read_to_string(canvas_path(&app, &project_root)?) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Atomic save: write .tmp then rename, so a crash never leaves a half-written file.
#[tauri::command]
fn save_canvas_state(app: AppHandle, project_root: String, state_json: String) -> Result<(), String> {
    let path = canvas_path(&app, &project_root)?;
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, state_json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            open_project,
            spawn_worktree_agent,
            dispatch_prompt_to_sessions,
            write_raw_stdin,
            resize_pty,
            get_session_scrollback,
            kill_session,
            list_sessions,
            discard_session,
            load_canvas_state,
            save_canvas_state,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Maestro")
        .run(|app, event| {
            // no orphan agents after the window closes
            if let tauri::RunEvent::Exit = event {
                for s in app.state::<AppState>().sessions.lock().unwrap().values() {
                    s.pty.kill();
                }
            }
        });
}
