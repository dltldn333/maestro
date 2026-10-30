//! Maestro's local server (127.0.0.1, random port, per-run token):
//! - `/permission/…` — permission prompts answered from the chat view (below)
//! - `/api/…` — the `maestro` CLI agents use to drive Maestro (control.rs)
//!
//! Permission prompts answered from the chat view.
//! Each agent is started with a `PermissionRequest` hook (via `--settings <file>`) that POSTs the request
//! to this localhost server with curl and prints our reply. The server shows it in the UI and holds the
//! connection until the user answers. No answer (Maestro closed, user picks "answer in CLI") → empty reply
//! → Claude falls back to its own terminal prompt, so nothing is ever approved by silence.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Below the hook's own timeout so we always answer before Claude gives up on curl.
const WAIT_MAX: Duration = Duration::from_secs(590);
const HOOK_TIMEOUT_SECS: u64 = 600;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    pub id: u64,
    pub worktree_path: String,
    pub tool_name: String,
    pub tool_input: Value,
    /// Claude offered an "always allow" rule for this call
    pub can_always: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Done {
    id: u64,
    worktree_path: String,
}

struct Pending {
    approval: Approval,
    /// Claude's permission_suggestions, sent back as-is for "always allow"
    suggestions: Value,
    reply: Sender<Option<Value>>,
}

#[derive(Default)]
struct Inner {
    next_id: u64,
    pending: HashMap<u64, Pending>,
    /// our session id → worktree path (the URL carries the id; it survives /clear, the hook input's doesn't)
    agents: HashMap<String, String>,
}

#[derive(Clone)]
pub struct Approvals {
    port: u16,
    token: String,
    inner: Arc<Mutex<Inner>>,
}

impl Approvals {
    pub fn start(app: AppHandle) -> Result<Approvals, String> {
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let token = {
            use std::collections::hash_map::RandomState;
            use std::hash::BuildHasher;
            format!("{:016x}{:016x}", RandomState::new().hash_one(1), RandomState::new().hash_one(2))
        };
        let me = Approvals { port, token, inner: Arc::default() };
        let srv = me.clone();
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let (srv, app) = (srv.clone(), app.clone());
                thread::spawn(move || srv.handle(stream, &app));
            }
        });
        Ok(me)
    }

    pub fn register(&self, session_id: &str, worktree_path: &str) {
        self.inner.lock().unwrap().agents.insert(session_id.into(), worktree_path.into());
    }

    /// Per-agent settings file for `--settings`: just the hook, user settings stay untouched.
    pub fn write_settings(&self, file: &Path, session_id: &str) -> Result<(), String> {
        let url = format!("http://127.0.0.1:{}/permission/{session_id}?t={}", self.port, self.token);
        let command = format!("curl -s --max-time {HOOK_TIMEOUT_SECS} -X POST -H \"Content-Type: application/json\" --data-binary @- \"{url}\"");
        let settings = json!({ "hooks": { "PermissionRequest": [{ "matcher": "*", "hooks": [{ "type": "command", "command": command, "timeout": HOOK_TIMEOUT_SECS }] }] } });
        std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
        std::fs::write(file, serde_json::to_string_pretty(&settings).unwrap()).map_err(|e| e.to_string())
    }

    pub fn pending(&self) -> Vec<Approval> {
        self.inner.lock().unwrap().pending.values().map(|p| p.approval.clone()).collect()
    }

    /// "allow" | "always" | "deny" | "cli" (hand the question back to the terminal prompt)
    pub fn answer(&self, id: u64, choice: &str) {
        let Some(p) = self.inner.lock().unwrap().pending.remove(&id) else { return };
        let _ = p.reply.send(decision(choice, &p.suggestions));
    }

    /// `127.0.0.1:<port>`, for the maestro CLI (MAESTRO_URL)
    pub fn addr(&self) -> String {
        format!("127.0.0.1:{}", self.port)
    }

    pub fn token(&self) -> &str {
        &self.token
    }

    fn handle(&self, mut stream: TcpStream, app: &AppHandle) {
        let Some((path, headers, body)) = read_request(&stream) else { return };
        // the maestro CLI: token in a header, caller's worktree too (control.rs)
        if let Some(route) = path.strip_prefix("/api/") {
            if headers.get("x-maestro-token").map(String::as_str) != Some(self.token.as_str()) {
                return respond(&mut stream, 403, &json!({ "error": "토큰이 맞지 않아요" }).to_string());
            }
            let caller = headers.get("x-maestro-worktree").cloned().unwrap_or_default();
            let input: Value = serde_json::from_slice(&body).unwrap_or_default();
            return match crate::control::handle(app, route, &caller, &input) {
                Ok(v) => respond(&mut stream, 200, &v.to_string()),
                Err(e) => respond(&mut stream, 400, &json!({ "error": e }).to_string()),
            };
        }
        let Some(rest) = path.strip_prefix("/permission/") else { return respond(&mut stream, 404, "") };
        let (sid, query) = rest.split_once('?').unwrap_or((rest, ""));
        if query != format!("t={}", self.token) {
            return respond(&mut stream, 403, "");
        }
        let Some(worktree_path) = self.inner.lock().unwrap().agents.get(sid).cloned() else { return respond(&mut stream, 200, "") };
        let input: Value = serde_json::from_slice(&body).unwrap_or_default();

        let (tx, rx) = mpsc::channel();
        let approval = {
            let mut inner = self.inner.lock().unwrap();
            inner.next_id += 1;
            let approval = Approval {
                id: inner.next_id,
                worktree_path: worktree_path.clone(),
                tool_name: input["tool_name"].as_str().unwrap_or("?").into(),
                tool_input: input["tool_input"].clone(),
                can_always: input["permission_suggestions"].as_array().is_some_and(|s| !s.is_empty()),
            };
            inner.pending.insert(approval.id, Pending { approval: approval.clone(), suggestions: input["permission_suggestions"].clone(), reply: tx });
            approval
        };
        let _ = app.emit("agent://approval", &approval);

        // Wait for the UI, but notice when Claude gives up (answered in the TUI, turn interrupted → curl killed).
        let start = Instant::now();
        let reply = loop {
            match rx.recv_timeout(Duration::from_secs(1)) {
                Ok(r) => break r,
                Err(RecvTimeoutError::Disconnected) => break None,
                Err(RecvTimeoutError::Timeout) if start.elapsed() > WAIT_MAX || peer_closed(&stream) => {
                    self.inner.lock().unwrap().pending.remove(&approval.id);
                    break None;
                }
                Err(RecvTimeoutError::Timeout) => {}
            }
        };
        let _ = app.emit("agent://approval-done", Done { id: approval.id, worktree_path });
        respond(&mut stream, 200, &reply.map(|d| d.to_string()).unwrap_or_default());
    }
}

/// The hook's stdout for a choice; None = no decision (Claude shows its own prompt).
fn decision(choice: &str, suggestions: &Value) -> Option<Value> {
    let d = match choice {
        "allow" => json!({ "behavior": "allow" }),
        "always" => json!({ "behavior": "allow", "updatedPermissions": suggestions }),
        "deny" => json!({ "behavior": "deny", "message": "사용자가 Maestro에서 거부했어요." }),
        _ => return None,
    };
    Some(json!({ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": d } }))
}

/// (path, `x-maestro-*` headers lowercased, body)
fn read_request(stream: &TcpStream) -> Option<(String, HashMap<String, String>, Vec<u8>)> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let mut r = BufReader::new(stream);
    let mut line = String::new();
    r.read_line(&mut line).ok()?;
    let path = line.split_whitespace().nth(1)?.to_string();
    let mut len = 0usize;
    let mut headers = HashMap::new();
    loop {
        let mut h = String::new();
        if r.read_line(&mut h).ok()? == 0 || h.trim().is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            let k = k.trim().to_ascii_lowercase();
            if k == "content-length" {
                len = v.trim().parse().ok()?;
            } else if k.starts_with("x-maestro-") {
                headers.insert(k, v.trim().to_string());
            }
        }
    }
    let mut body = vec![0; len.min(4 << 20)];
    r.read_exact(&mut body).ok()?;
    Some((path, headers, body))
}

fn peer_closed(stream: &TcpStream) -> bool {
    let _ = stream.set_nonblocking(true);
    let closed = matches!(stream.peek(&mut [0u8; 1]), Ok(0));
    let _ = stream.set_nonblocking(false);
    closed
}

fn respond(stream: &mut TcpStream, status: u16, body: &str) {
    let _ = write!(stream, "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decisions_match_hook_schema() {
        let sug = json!([{ "type": "addRules", "behavior": "allow" }]);
        let allow = decision("allow", &sug).unwrap();
        assert_eq!(allow["hookSpecificOutput"]["hookEventName"], "PermissionRequest");
        assert_eq!(allow["hookSpecificOutput"]["decision"]["behavior"], "allow");
        assert_eq!(decision("always", &sug).unwrap()["hookSpecificOutput"]["decision"]["updatedPermissions"], sug);
        assert_eq!(decision("deny", &sug).unwrap()["hookSpecificOutput"]["decision"]["behavior"], "deny");
        assert!(decision("cli", &sug).is_none());
    }

    #[test]
    fn parses_hook_post() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap();
        let t = thread::spawn(move || {
            let mut c = TcpStream::connect(addr).unwrap();
            c.write_all(b"POST /permission/abc?t=x HTTP/1.1\r\nHost: h\r\nX-Maestro-Token: tk\r\nContent-Length: 13\r\n\r\n{\"a\":\"hello\"}").unwrap();
        });
        let (s, _) = l.accept().unwrap();
        let (path, headers, body) = read_request(&s).unwrap();
        t.join().unwrap();
        assert_eq!(path, "/permission/abc?t=x");
        assert_eq!(headers.get("x-maestro-token").map(String::as_str), Some("tk"));
        assert!(!headers.contains_key("host"));
        assert_eq!(body, br#"{"a":"hello"}"#);
    }
}
