//! The workspace every window shows: which windows there are, each one's split layout and focused group, the
//! tab groups and the projects' remembered tabs. One copy, here; windows are views of it.
//!
//! The frontend owns the rules (store.ts / layout.ts): a window computes the next state and commits it against
//! the version it started from. A commit on an older version is refused with the current state, and the window
//! redoes its change on that (optimistic concurrency), so two windows never overwrite each other. Every accepted
//! state goes to all windows (`workspace://state`), which is how a tab dragged from one window to another leaves
//! the first and shows up in the second: one change, no hand-over.
//!
//! Also here: unsaved editor text per file (so a file tab keeps its edits in whatever window it moves to), and a
//! pool of hidden, already-loaded windows, so popping a tab out shows a window at once instead of booting a webview.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct Workspace {
    state: Mutex<(Value, u64)>,
    drafts: Mutex<HashMap<String, String>>,
    /// hidden windows that finished loading, ready to show
    pool: Mutex<Vec<String>>,
    next_window: AtomicU64,
}

#[derive(Serialize, Clone)]
pub struct Snapshot {
    state: Value,
    version: u64,
}

#[derive(Serialize)]
pub struct Commit {
    ok: bool,
    version: u64,
    /// the current state, when refused
    state: Option<Value>,
}

/// Group ids a layout node refers to (`{ group }` or `{ dir, children }`).
fn layout_groups(node: &Value, out: &mut HashSet<String>) {
    if let Some(id) = node.get("group").and_then(Value::as_str) {
        out.insert(id.to_string());
    }
    for c in node.get("children").and_then(Value::as_array).into_iter().flatten() {
        layout_groups(c, out);
    }
}

/// `state` without window `label`, and without the groups no window shows any more.
fn drop_window(state: &mut Value, label: &str) -> bool {
    let Some(windows) = state.get_mut("windows").and_then(Value::as_object_mut) else { return false };
    if windows.remove(label).is_none() {
        return false;
    }
    let mut shown = HashSet::new();
    for w in windows.values() {
        if let Some(l) = w.get("layout") {
            layout_groups(l, &mut shown);
        }
    }
    if let Some(groups) = state.get_mut("groups").and_then(Value::as_object_mut) {
        groups.retain(|id, _| shown.contains(id));
    }
    true
}

impl Workspace {
    fn publish(app: &AppHandle, state: &Value, version: u64) {
        let _ = app.emit("workspace://state", Snapshot { state: state.clone(), version });
    }

    /// A window closed: it and the groups only it showed are gone.
    pub fn window_closed(&self, app: &AppHandle, label: &str) {
        self.pool.lock().unwrap().retain(|l| l != label);
        let mut s = self.state.lock().unwrap();
        if drop_window(&mut s.0, label) {
            s.1 += 1;
            Self::publish(app, &s.0, s.1);
        }
    }

    /// A hidden window, loading in the background (its page reports in with `ws_window_ready`).
    fn warm(app: &AppHandle, ws: &Workspace) -> Result<String, String> {
        let label = format!("ws-{}", ws.next_window.fetch_add(1, Ordering::Relaxed) + 1);
        tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App("index.html?ws=1".into()))
            .title("Maestro")
            .inner_size(1100.0, 760.0)
            .min_inner_size(480.0, 320.0)
            .decorations(false)
            .visible(false)
            .disable_drag_drop_handler() // HTML5 drag and drop (tabs, file attachments), as in the main window
            .build()
            .map_err(|e| e.to_string())?;
        Ok(label)
    }
}

#[tauri::command]
pub fn ws_get(ws: State<Workspace>) -> Snapshot {
    let s = ws.state.lock().unwrap();
    Snapshot { state: if s.0.is_null() { json!({ "windows": {}, "groups": {}, "parked": {} }) } else { s.0.clone() }, version: s.1 }
}

#[tauri::command]
pub fn ws_commit(app: AppHandle, ws: State<Workspace>, state: Value, base: u64) -> Commit {
    let mut s = ws.state.lock().unwrap();
    if s.1 != base {
        return Commit { ok: false, version: s.1, state: Some(s.0.clone()) };
    }
    *s = (state, base + 1);
    Workspace::publish(&app, &s.0, s.1);
    Commit { ok: true, version: s.1, state: None }
}

#[tauri::command]
pub fn ws_draft_set(ws: State<Workspace>, key: String, text: Option<String>) {
    let mut d = ws.drafts.lock().unwrap();
    match text {
        Some(t) => d.insert(key, t),
        None => d.remove(&key),
    };
}

#[tauri::command]
pub fn ws_draft_get(ws: State<Workspace>, key: String) -> Option<String> {
    ws.drafts.lock().unwrap().get(&key).cloned()
}

/// A hidden window's page has loaded: it can be handed a group and shown at once.
#[tauri::command]
pub fn ws_window_ready(window: tauri::Window, ws: State<Workspace>) {
    let mut pool = ws.pool.lock().unwrap();
    if !pool.iter().any(|l| l == window.label()) {
        pool.push(window.label().to_string());
    }
}

/// A window for a new pop-out: a warm one from the pool if there is one (a fresh one starts warming to replace
/// it), else a new one that shows once it has loaded. Async: creating windows from a sync command deadlocks on
/// Windows.
#[tauri::command]
pub async fn ws_take_window(app: AppHandle) -> Result<String, String> {
    let ws = app.state::<Workspace>();
    let taken = ws.pool.lock().unwrap().pop();
    let label = match taken {
        Some(l) => l,
        None => Workspace::warm(&app, &ws)?,
    };
    Workspace::warm(&app, &ws)?;
    Ok(label)
}

/// Shows a window taken from the pool, its top bar under the pointer if a tab was dropped at (x, y).
#[tauri::command]
pub async fn ws_show_window(app: AppHandle, label: String, x: Option<f64>, y: Option<f64>) -> Result<(), String> {
    let w = app.get_webview_window(&label).ok_or("창을 찾을 수 없어요")?;
    match (x, y) {
        (Some(x), Some(y)) => w.set_position(tauri::LogicalPosition::new(x - 120.0, y - 16.0)),
        _ => w.center(),
    }
    .map_err(|e| e.to_string())?;
    w.show().map_err(|e| e.to_string())?;
    w.set_focus().map_err(|e| e.to_string())
}

/// One warm window a moment after start, so the first pop-out is instant too.
/// (Its own thread: building a window off the main thread hands the work to the event loop instead of blocking it.)
pub fn warm_later(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(3));
        let ws = app.state::<Workspace>();
        let _ = Workspace::warm(&app, &ws);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closing_a_window_drops_only_its_groups() {
        let mut s = json!({
            "windows": {
                "main": { "layout": { "dir": "row", "children": [{ "group": "a" }, { "group": "b" }] }, "focus": "a" },
                "ws-1": { "layout": { "group": "c" }, "focus": "c" }
            },
            "groups": { "a": {}, "b": {}, "c": {} },
            "parked": {}
        });
        assert!(drop_window(&mut s, "ws-1"));
        assert_eq!(s["groups"].as_object().unwrap().keys().collect::<Vec<_>>(), ["a", "b"]);
        assert!(!drop_window(&mut s, "ws-1"));
    }
}
