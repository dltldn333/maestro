#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent;
mod worktree;

use agent::{Agent, AgentMeta, AgentState, Files};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

/// Running agents keyed by lowercased worktree path (Windows paths are case-insensitive).
#[derive(Default)]
struct AppState {
    agents: Mutex<HashMap<String, Arc<Agent>>>,
}

impl AppState {
    fn get(&self, path: &str) -> Option<Arc<Agent>> {
        self.agents.lock().unwrap().get(&path.to_lowercase()).cloned()
    }
}

fn home(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().home_dir().map_err(|e| e.to_string())
}

fn files(app: &AppHandle, project_root: &str, worktree_path: &str) -> Result<Files, String> {
    Ok(Files::new(&worktree::project_dir(&home(app)?, project_root), worktree_path))
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
    Ok(home(app)?.join(".maestro").join("repos.json"))
}

fn read_repos(app: &AppHandle) -> Result<Vec<String>, String> {
    match std::fs::read_to_string(repos_file(app)?) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("repos.json 손상: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(e.to_string()),
    }
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
        atomic_write(&repos_file(&app)?, &serde_json::to_string_pretty(&roots).unwrap())?;
    }
    Ok(repo_info(&root))
}

/// Forgets the repo in the sidebar; worktrees on disk are left alone.
#[tauri::command]
fn remove_repo(app: AppHandle, root: String) -> Result<(), String> {
    let roots: Vec<String> = read_repos(&app)?.into_iter().filter(|r| *r != root).collect();
    atomic_write(&repos_file(&app)?, &serde_json::to_string_pretty(&roots).unwrap())
}

// ---------- worktrees & agents ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeInfo {
    path: String,
    branch: String,
    adapter_id: Option<String>,
    permission_mode: Option<String>,
    state: AgentState,
}

fn info(state: &AppState, f: &Files, path: String, branch: String) -> WorktreeInfo {
    let meta = f.read_meta();
    WorktreeInfo {
        state: state.get(&path).map(|a| a.state.lock().unwrap().clone()).unwrap_or(AgentState::Idle),
        adapter_id: meta.as_ref().map(|m| m.adapter_id.clone()),
        permission_mode: meta.map(|m| m.permission_mode),
        path,
        branch,
    }
}

#[tauri::command]
async fn list_worktrees(app: AppHandle, state: State<'_, AppState>, project_root: String) -> Result<Vec<WorktreeInfo>, String> {
    let pdir = worktree::project_dir(&home(&app)?, &project_root);
    Ok(worktree::list(&project_root, &pdir)?
        .into_iter()
        .map(|(path, branch)| info(&state, &Files::new(&pdir, &path), path, branch))
        .collect())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAgentReq {
    project_root: String,
    adapter_id: String,
    permission_mode: String,
    branch_name: String,
    base_branch: String,
}

/// A CLI block: new worktree + agent, started right away.
#[tauri::command]
async fn create_agent(app: AppHandle, state: State<'_, AppState>, req: CreateAgentReq) -> Result<WorktreeInfo, String> {
    let pdir = worktree::project_dir(&home(&app)?, &req.project_root);
    let (path, branch) = worktree::create(&req.project_root, &pdir, &req.branch_name, &req.base_branch)?;
    let path = worktree::norm(&path);
    let f = Files::new(&pdir, &path);
    let meta = AgentMeta { adapter_id: req.adapter_id, permission_mode: req.permission_mode, cli_session_id: None };
    let started = f.write_meta(&meta).and_then(|_| Agent::spawn(app.clone(), &path, Files::new(&pdir, &path), meta));
    match started {
        Ok(a) => {
            state.agents.lock().unwrap().insert(path.to_lowercase(), Arc::new(a));
            Ok(info(&state, &f, path, branch))
        }
        Err(e) => {
            // don't leave an orphan worktree behind a failed start
            let _ = worktree::discard(&req.project_root, &path, &branch);
            let _ = std::fs::remove_file(&f.meta);
            Err(e)
        }
    }
}

/// Sends one turn, starting (or resuming) the agent first if it isn't running.
#[tauri::command]
async fn send_message(app: AppHandle, state: State<'_, AppState>, project_root: String, worktree_path: String, text: String, files_attached: Vec<String>) -> Result<(), String> {
    let agent = match state.get(&worktree_path).filter(|a| a.alive()) {
        Some(a) => a,
        None => {
            let f = files(&app, &project_root, &worktree_path)?;
            let meta = f.read_meta().ok_or("이 워크트리에는 에이전트 설정이 없습니다")?;
            let a = Arc::new(Agent::spawn(app.clone(), &worktree_path, f, meta)?);
            state.agents.lock().unwrap().insert(worktree_path.to_lowercase(), a.clone());
            a
        }
    };
    agent.send(&text, &files_attached)
}

/// Stops the current turn by ending the process; the next message resumes the conversation.
#[tauri::command]
fn stop_agent(state: State<AppState>, worktree_path: String) {
    if let Some(a) = state.get(&worktree_path) {
        a.kill();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptRes {
    events: Vec<Value>,
    seq: u64,
}

#[tauri::command]
async fn get_transcript(app: AppHandle, project_root: String, worktree_path: String) -> Result<TranscriptRes, String> {
    let events = files(&app, &project_root, &worktree_path)?.read_transcript();
    Ok(TranscriptRes { seq: events.len() as u64, events })
}

/// Kill the agent, `git worktree remove --force`, delete the branch and the agent's files.
#[tauri::command]
async fn discard_worktree(app: AppHandle, state: State<'_, AppState>, project_root: String, worktree_path: String, branch: String) -> Result<(), String> {
    if let Some(a) = state.agents.lock().unwrap().remove(&worktree_path.to_lowercase()) {
        a.kill();
        std::thread::sleep(Duration::from_millis(300)); // let the process release file handles (Windows)
    }
    worktree::discard(&project_root, &worktree_path, &branch)?;
    let f = files(&app, &project_root, &worktree_path)?;
    let _ = std::fs::remove_file(f.meta);
    let _ = std::fs::remove_file(f.transcript);
    Ok(())
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
    Ok(worktree::project_dir(&home(app)?, project_root).join("canvas_state.json"))
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
            create_agent,
            send_message,
            stop_agent,
            get_transcript,
            discard_worktree,
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
                for a in app.state::<AppState>().agents.lock().unwrap().values() {
                    a.kill();
                }
            }
        });
}
