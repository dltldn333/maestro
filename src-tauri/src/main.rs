#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod pty;
mod worktree;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use pty::{AgentState, Pty};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

struct Session {
    worktree_path: String,
    adapter_id: String,
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

fn maestro_home(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().home_dir().map_err(|e| e.to_string())
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

// ---------- repos (~/.maestro/repos.json) ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RepoInfo {
    root: String,
    name: String,
    default_branch: String,
}

fn repo_info(root: &str) -> RepoInfo {
    RepoInfo {
        root: root.to_string(),
        name: Path::new(root).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| root.into()),
        default_branch: worktree::default_branch(root),
    }
}

fn repos_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(maestro_home(app)?.join(".maestro").join("repos.json"))
}

fn read_repos(app: &AppHandle) -> Result<Vec<String>, String> {
    match std::fs::read_to_string(repos_file(app)?) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("repos.json 손상: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(e.to_string()),
    }
}

fn write_repos(app: &AppHandle, roots: &[String]) -> Result<(), String> {
    atomic_write(&repos_file(app)?, &serde_json::to_string_pretty(roots).unwrap())
}

/// Write .tmp then rename, so a crash never leaves a half-written file.
fn atomic_write(path: &Path, text: &str) -> Result<(), String> {
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_repos(app: AppHandle) -> Result<Vec<RepoInfo>, String> {
    Ok(read_repos(&app)?.iter().map(|r| repo_info(r)).collect())
}

#[tauri::command]
async fn add_repo(app: AppHandle, path: String) -> Result<RepoInfo, String> {
    let root = worktree::toplevel(&path)?;
    let mut roots = read_repos(&app)?;
    if !roots.contains(&root) {
        roots.push(root.clone());
        write_repos(&app, &roots)?;
    }
    Ok(repo_info(&root))
}

/// Forgets the repo in the sidebar; worktrees on disk are left alone.
#[tauri::command]
fn remove_repo(app: AppHandle, root: String) -> Result<(), String> {
    let roots: Vec<String> = read_repos(&app)?.into_iter().filter(|r| *r != root).collect();
    write_repos(&app, &roots)
}

// ---------- worktrees & sessions ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionInfo {
    session_id: String,
    adapter_id: String,
    state: AgentState,
    allocated_port: Option<u16>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeInfo {
    path: String,
    branch: String,
    session: Option<SessionInfo>,
}

fn session_for_path(state: &AppState, path: &str) -> Option<(String, Arc<Session>)> {
    // newest session wins if a worktree was restarted
    state.sessions.lock().unwrap().iter()
        .filter(|(_, s)| s.worktree_path.eq_ignore_ascii_case(path))
        .max_by_key(|(id, _)| id[1..].parse::<u64>().unwrap_or(0))
        .map(|(id, s)| (id.clone(), s.clone()))
}

fn session_info(id: String, s: &Session) -> SessionInfo {
    SessionInfo { session_id: id, adapter_id: s.adapter_id.clone(), state: s.pty.state.lock().unwrap().clone(), allocated_port: s.port }
}

#[tauri::command]
async fn list_worktrees(app: AppHandle, state: State<'_, AppState>, project_root: String) -> Result<Vec<WorktreeInfo>, String> {
    let pdir = worktree::project_dir(&maestro_home(&app)?, &project_root);
    Ok(worktree::list(&project_root, &pdir)?
        .into_iter()
        .map(|(path, branch)| {
            let session = session_for_path(&state, &path).map(|(id, s)| session_info(id, &s));
            WorktreeInfo { path, branch, session }
        })
        .collect())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartSessionReq {
    worktree_path: String,
    adapter_id: String,
    cols: u16,
    rows: u16,
}

/// Starts an agent CLI inside an existing worktree.
#[tauri::command]
async fn start_session(app: AppHandle, state: State<'_, AppState>, req: StartSessionReq) -> Result<SessionInfo, String> {
    let argv = adapter_argv(&req.adapter_id)?;
    if let Some((_, old)) = session_for_path(&state, &req.worktree_path) {
        if !matches!(*old.pty.state.lock().unwrap(), AgentState::Terminated { .. }) {
            return Err("이 워크트리에는 이미 실행 중인 에이전트가 있습니다".into());
        }
    }
    let session_id = {
        let mut n = state.next_id.lock().unwrap();
        *n += 1;
        format!("s{}", *n)
    };
    let port = {
        let used: Vec<u16> = state.sessions.lock().unwrap().values().filter_map(|s| s.port).collect();
        (3001..=3099).find(|p| !used.contains(p))
    };
    let pty = Pty::spawn(app, session_id.clone(), &argv, Path::new(&req.worktree_path), port, req.cols, req.rows)?;
    let session = Session { worktree_path: req.worktree_path, adapter_id: req.adapter_id, port, pty };
    let info = session_info(session_id.clone(), &session);
    state.sessions.lock().unwrap().insert(session_id, Arc::new(session));
    Ok(info)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateWorktreeReq {
    project_root: String,
    adapter_id: String,
    branch_name: String,
    base_branch: String,
    cols: u16,
    rows: u16,
}

/// New worktree + agent in one step (PRD spawn_worktree_agent).
#[tauri::command]
async fn spawn_worktree_agent(app: AppHandle, state: State<'_, AppState>, req: CreateWorktreeReq) -> Result<WorktreeInfo, String> {
    let pdir = worktree::project_dir(&maestro_home(&app)?, &req.project_root);
    let (path, branch) = worktree::create(&req.project_root, &pdir, &req.branch_name, &req.base_branch)?;
    let path = worktree::norm(&path);
    let start = StartSessionReq { worktree_path: path.clone(), adapter_id: req.adapter_id, cols: req.cols, rows: req.rows };
    match start_session(app, state, start).await {
        Ok(s) => Ok(WorktreeInfo { path, branch, session: Some(s) }),
        Err(e) => {
            // don't leave an orphan worktree behind a failed spawn
            let _ = worktree::discard(&req.project_root, &path, &branch);
            Err(e)
        }
    }
}

/// Kill any agent in it, then `git worktree remove --force` + delete the branch.
#[tauri::command]
async fn discard_worktree(state: State<'_, AppState>, project_root: String, worktree_path: String, branch: String) -> Result<(), String> {
    let ids: Vec<String> = state.sessions.lock().unwrap().iter()
        .filter(|(_, s)| s.worktree_path.eq_ignore_ascii_case(&worktree_path))
        .map(|(id, _)| id.clone()).collect();
    for id in &ids {
        if let Some(s) = state.sessions.lock().unwrap().remove(id) {
            s.pty.kill();
        }
    }
    if !ids.is_empty() {
        std::thread::sleep(Duration::from_millis(300)); // let the process release file handles (Windows)
    }
    worktree::discard(&project_root, &worktree_path, &branch)
}

/// Stops the process but keeps the worktree.
#[tauri::command]
fn kill_session(state: State<AppState>, session_id: String) -> Result<(), String> {
    state.get(&session_id)?.pty.kill();
    Ok(())
}

// ---------- terminal I/O ----------

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

// ---------- right panel: files & changes ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirEntry {
    name: String,
    is_dir: bool,
}

#[tauri::command]
async fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut out: Vec<DirEntry> = std::fs::read_dir(&path)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name() != ".git")
        .map(|e| DirEntry { name: e.file_name().to_string_lossy().into(), is_dir: e.file_type().map(|t| t.is_dir()).unwrap_or(false) })
        .collect();
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

#[derive(Serialize)]
struct FileChange {
    code: String,
    path: String,
}

#[tauri::command]
async fn git_status(worktree_path: String) -> Result<Vec<FileChange>, String> {
    Ok(worktree::status(&worktree_path)?.into_iter().map(|(code, path)| FileChange { code, path }).collect())
}

#[tauri::command]
async fn git_diff_file(worktree_path: String, file: String) -> Result<String, String> {
    worktree::diff(&worktree_path, &file)
}

// ---------- canvas ----------

fn canvas_path(app: &AppHandle, project_root: &str) -> Result<PathBuf, String> {
    Ok(worktree::project_dir(&maestro_home(app)?, project_root).join("canvas_state.json"))
}

#[tauri::command]
fn load_canvas_state(app: AppHandle, project_root: String) -> Result<Option<String>, String> {
    match std::fs::read_to_string(canvas_path(&app, &project_root)?) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn save_canvas_state(app: AppHandle, project_root: String, state_json: String) -> Result<(), String> {
    atomic_write(&canvas_path(&app, &project_root)?, &state_json)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            list_repos,
            add_repo,
            remove_repo,
            list_worktrees,
            start_session,
            spawn_worktree_agent,
            discard_worktree,
            kill_session,
            dispatch_prompt_to_sessions,
            write_raw_stdin,
            resize_pty,
            get_session_scrollback,
            list_dir,
            git_status,
            git_diff_file,
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
