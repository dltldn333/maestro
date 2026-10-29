use base64::{engine::general_purpose::STANDARD as B64, Engine};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const BATCH_WINDOW: Duration = Duration::from_millis(16);
const BATCH_MAX: usize = 64 * 1024;
const SCROLLBACK_MAX: usize = 1024 * 1024;
/// No output for this long = the agent is waiting (shown as idle, like Orca's activity dot).
const IDLE_AFTER: Duration = Duration::from_secs(3);

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", rename_all_fields = "camelCase")]
pub enum AgentState {
    Running,
    Idle,
    Terminated { exit_code: Option<i32> },
}

/// Emits only real transitions; Terminated is final.
fn set_state(app: &AppHandle, session_id: &str, cur: &Mutex<AgentState>, next: AgentState) {
    let mut cur = cur.lock().unwrap();
    if matches!(*cur, AgentState::Terminated { .. }) || std::mem::discriminant(&*cur) == std::mem::discriminant(&next) {
        return;
    }
    *cur = next.clone();
    let _ = app.emit("agent://state", AgentStateEvent { session_id: session_id.into(), state: next });
}

/// Event "pty://stdout". `seq` = total bytes emitted so far, so a remounted terminal
/// can drop live batches already contained in its scrollback snapshot.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PtyStdoutBatchEvent {
    pub session_id: String,
    pub data_b64: String,
    pub stripped_tail: Vec<String>,
    pub seq: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentStateEvent {
    pub session_id: String,
    pub state: AgentState,
}

#[derive(Default)]
pub struct Scrollback {
    pub buf: Vec<u8>,
    pub total: u64,
}

impl Scrollback {
    fn push(&mut self, data: &[u8]) {
        self.buf.extend_from_slice(data);
        self.total += data.len() as u64;
        if self.buf.len() > SCROLLBACK_MAX {
            // shortcut: may cut an escape sequence at the front, garbling the first replayed line
            let cut = self.buf.len() - SCROLLBACK_MAX;
            self.buf.drain(..cut);
        }
    }
}

pub struct Pty {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    pub scrollback: Arc<Mutex<Scrollback>>,
    pub state: Arc<Mutex<AgentState>>,
}

impl Pty {
    pub fn spawn(app: AppHandle, session_id: String, argv: &[String], cwd: &Path, port: Option<u16>, cols: u16, rows: u16) -> Result<Pty, String> {
        let pair = native_pty_system()
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
        let mut cmd = CommandBuilder::new(&argv[0]);
        cmd.args(&argv[1..]);
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        if let Some(p) = port {
            cmd.env("PORT", p.to_string());
        }
        let child = pair.slave.spawn_command(cmd).map_err(|e| format!("프로세스 실행 실패: {e}"))?;
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        let scrollback = Arc::new(Mutex::new(Scrollback::default()));
        let child = Arc::new(Mutex::new(child));
        let state = Arc::new(Mutex::new(AgentState::Running));

        // Blocking reads live on their own thread so a silent PTY never stalls anything else.
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 || tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        });

        // Batcher: one IPC event per 16 ms window (or sooner at 64 KB). Never drops bytes.
        let (sb, app2, sid, st) = (scrollback.clone(), app.clone(), session_id.clone(), state.clone());
        thread::spawn(move || loop {
            let first = match rx.recv_timeout(IDLE_AFTER) {
                Ok(c) => c,
                Err(RecvTimeoutError::Timeout) => {
                    set_state(&app2, &sid, &st, AgentState::Idle);
                    continue;
                }
                Err(RecvTimeoutError::Disconnected) => break,
            };
            set_state(&app2, &sid, &st, AgentState::Running);
            {
                let mut batch = first;
                let deadline = Instant::now() + BATCH_WINDOW;
                while batch.len() < BATCH_MAX {
                    let left = deadline.saturating_duration_since(Instant::now());
                    match rx.recv_timeout(left) {
                        Ok(c) => batch.extend(c),
                        Err(RecvTimeoutError::Timeout) | Err(RecvTimeoutError::Disconnected) => break,
                    }
                }
                let (seq, tail) = {
                    let mut s = sb.lock().unwrap();
                    s.push(&batch);
                    let from = s.buf.len().saturating_sub(4096);
                    (s.total, tail_lines(&s.buf[from..], 2))
                };
                let _ = app2.emit("pty://stdout", PtyStdoutBatchEvent {
                    session_id: sid.clone(),
                    data_b64: B64.encode(&batch),
                    stripped_tail: tail,
                    seq,
                });
            }
        });

        // ConPTY may keep the read pipe open after the child exits, so poll the child instead of waiting for EOF.
        let (ch, sid, st) = (child.clone(), session_id.clone(), state.clone());
        thread::spawn(move || loop {
            thread::sleep(Duration::from_millis(500));
            let status = ch.lock().unwrap().try_wait();
            match status {
                Ok(None) => continue,
                Ok(Some(code)) => {
                    set_state(&app, &sid, &st, AgentState::Terminated { exit_code: Some(code.exit_code() as i32) });
                    break;
                }
                Err(_) => break,
            }
        });

        Ok(Pty { writer: Mutex::new(writer), master: Mutex::new(pair.master), child, scrollback, state })
    }

    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        let mut w = self.writer.lock().unwrap();
        w.write_all(data).and_then(|_| w.flush()).map_err(|e| e.to_string())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master.lock().unwrap()
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())
    }

    /// shortcut: kills the direct child only; grandchildren rely on ConPTY/SIGHUP teardown when the
    /// master drops. Upgrade to Job Objects / killpg when orphaned dev servers show up.
    pub fn kill(&self) {
        let _ = self.child.lock().unwrap().kill();
    }
}

/// Drops ANSI escape sequences and control bytes, keeping text and newlines.
pub fn strip_ansi(bytes: &[u8]) -> String {
    let s = String::from_utf8_lossy(bytes);
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        match c {
            '\x1b' => match it.next() {
                Some('[') => {
                    // CSI: parameters until a final byte in @..~
                    while let Some(n) = it.next() {
                        if ('@'..='~').contains(&n) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    // OSC: until BEL or ESC \
                    while let Some(n) = it.next() {
                        if n == '\x07' || (n == '\x1b' && it.peek() == Some(&'\\')) {
                            if n == '\x1b' {
                                it.next();
                            }
                            break;
                        }
                    }
                }
                _ => {}
            },
            '\n' => out.push('\n'),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    out
}

fn tail_lines(bytes: &[u8], n: usize) -> Vec<String> {
    let text = strip_ansi(bytes);
    let mut lines: Vec<String> = text.lines().map(str::trim_end).filter(|l| !l.trim().is_empty()).map(String::from).collect();
    lines.split_off(lines.len().saturating_sub(n))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_csi_osc_and_controls() {
        let raw = b"\x1b]0;title\x07\x1b[1;32mhello\x1b[0m\r\nwor\x1b[2Kld\x1b]8;;x\x1b\\\n";
        assert_eq!(strip_ansi(raw), "hello\nworld\n");
    }

    #[test]
    fn tail_keeps_last_non_empty_lines() {
        assert_eq!(tail_lines(b"a\n\nb\nc\n\n", 2), vec!["b", "c"]);
        assert_eq!(tail_lines(b"only", 2), vec!["only"]);
    }

    #[test]
    fn scrollback_caps_and_counts() {
        let mut s = Scrollback::default();
        s.push(&vec![b'x'; SCROLLBACK_MAX]);
        s.push(b"yz");
        assert_eq!(s.buf.len(), SCROLLBACK_MAX);
        assert_eq!(s.total, SCROLLBACK_MAX as u64 + 2);
        assert!(s.buf.ends_with(b"yz"));
    }
}
