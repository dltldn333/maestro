//! What the `maestro` CLI can do, run by the local server (approval.rs) for an agent inside Maestro.
//! The caller is the worktree the CLI ran in (MAESTRO_WORKTREE, set when Maestro starts an agent), so
//! every command is scoped to that worktree's project. Deliberately no delete/discard: agents can add
//! worktrees and talk to each other, not tear anything down.

use crate::{agent, create_worktree, ensure, files, home, library, link, read_repos, worktree, worktree_infos, AppState, CreateAgentReq, WorktreeInfo};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

/// What `maestro --help` lists; `maestro <route words> --flag value` maps onto these.
pub const ROUTES: &[(&str, &str)] = &[
    ("whoami", "내 워크트리, 상위 블록, 내 워커들, 나에게 연결된 참조 문서"),
    ("worktree list", "이 프로젝트의 워크트리와 에이전트 상태"),
    ("worktree create", "--name 이름 [--prompt 첫 지시] [--agent claude-code|antigravity] [--model 모델] [--description 설명]"),
    ("send", "--to 워크트리 --text 내용  (다른 에이전트에게 지시 보내기)"),
    ("read", "[--to 워크트리]  (그 에이전트의 상태와 마지막 답변, 기본은 나)"),
];

pub fn handle(app: &AppHandle, route: &str, caller: &str, input: &Value) -> Result<Value, String> {
    if route == "help" {
        return Ok(json!(ROUTES.iter().map(|(r, d)| json!({ "command": r, "usage": d })).collect::<Vec<_>>()));
    }
    if caller.is_empty() {
        return Err("maestro 명령은 Maestro가 띄운 에이전트 안에서 실행해야 해요 (MAESTRO_WORKTREE 없음)".into());
    }
    let state = app.state::<AppState>();
    let (root, me) = locate(app, &state, caller)?;
    let arg = |k: &str| input[k].as_str().unwrap_or("").trim().to_string();
    match route {
        "whoami" => {
            let all = worktree_infos(app, &state, &root)?;
            Ok(json!({
                "project": root,
                "worktree": card(&me),
                "parent": parent_of(&all, &me.path).map(|p| card(p)),
                "workers": all.iter().filter(|w| me.workers.iter().any(|p| p.eq_ignore_ascii_case(&w.path))).map(card).collect::<Vec<_>>(),
                // documents linked to you on the canvas: read them before working
                "references": me.refs.iter().map(|r| json!({ "path": r, "title": library::title_of(std::path::Path::new(r)) })).collect::<Vec<_>>(),
            }))
        }
        "worktree/list" => {
            let all = worktree_infos(app, &state, &root)?;
            Ok(json!(all
                .iter()
                .map(|w| {
                    let mut c = card(w);
                    c["role"] = json!(if w.is_maestro { "maestro" } else { "" });
                    c["parent"] = json!(parent_of(&all, &w.path).map(|p| p.name.clone().unwrap_or(p.branch.clone())));
                    c
                })
                .collect::<Vec<_>>()))
        }
        "worktree/create" => {
            let name = arg("name");
            if name.is_empty() {
                return Err("--name 이 필요해요".into());
            }
            let n = worktree_infos(app, &state, &root)?.len() + 1;
            let info = create_worktree(app, &state, CreateAgentReq {
                project_root: root.clone(),
                adapter_id: Some(arg("agent")).filter(|s| !s.is_empty()).or(me.adapter_id.clone()).unwrap_or("claude-code".into()),
                permission_mode: files(app, &root, &me.path)?.read_meta().map(|m| m.permission_mode).unwrap_or("acceptEdits".into()),
                branch_name: format!("agent-{n}"),
                base_branch: worktree::default_branch(&root),
                name,
                description: arg("description"),
                model: arg("model"),
            })?;
            // made by you → it's your worker (a line from your card on the project canvas)
            link(app, &root, &me.path, &info.path)?;
            let _ = app.emit("maestro://worktrees", &root); // the UI reloads this project's worktrees
            let prompt = arg("prompt");
            if !prompt.is_empty() {
                deliver(app, &state, &root, &info.path, &prompt)?;
            }
            Ok(card(&info))
        }
        "send" => {
            let text = arg("text");
            if text.is_empty() {
                return Err("--text 가 필요해요".into());
            }
            let to = target(app, &state, &root, &arg("to"))?;
            deliver(app, &state, &root, &to.path, &text)?;
            Ok(json!({ "sent": card(&to) }))
        }
        "read" => {
            let to = match arg("to").as_str() {
                "" => me,
                key => target(app, &state, &root, key)?,
            };
            Ok(json!({ "worktree": card(&to), "lastAnswer": last_answer(app, &root, &to.path) }))
        }
        _ => Err(format!("모르는 명령: {}. `maestro --help`를 보세요.", route.replace('/', " "))),
    }
}

fn parent_of<'a>(all: &'a [WorktreeInfo], path: &str) -> Option<&'a WorktreeInfo> {
    all.iter().find(|w| w.workers.iter().any(|p| p.eq_ignore_ascii_case(path)))
}

fn card(w: &WorktreeInfo) -> Value {
    json!({ "name": w.name.clone().unwrap_or(w.branch.clone()), "branch": w.branch, "agent": w.adapter_id, "status": w.state, "path": w.path })
}

/// The caller's project and its own worktree. git names the caller's repo in one call; scanning every
/// registered repo is only the fallback (each git call costs ~0.3 s on Windows).
fn locate(app: &AppHandle, state: &AppState, caller: &str) -> Result<(String, WorktreeInfo), String> {
    let me = worktree::norm(std::path::Path::new(caller));
    let repos = read_repos(app)?;
    let guess = worktree::main_checkout(caller).and_then(|m| repos.iter().find(|r| r.replace('\\', "/").eq_ignore_ascii_case(&m)).cloned());
    for root in guess.iter().chain(repos.iter().filter(|r| Some(*r) != guess.as_ref())) {
        if let Some(w) = worktree_infos(app, state, root)?.into_iter().find(|w| w.path.eq_ignore_ascii_case(&me)) {
            return Ok((root.clone(), w));
        }
    }
    Err(format!("Maestro가 모르는 워크트리예요: {caller}"))
}

/// A worktree of this project by name, branch, folder or path.
fn target(app: &AppHandle, state: &AppState, root: &str, key: &str) -> Result<WorktreeInfo, String> {
    if key.is_empty() {
        return Err("--to 로 워크트리를 지정해 주세요 (`maestro worktree list`)".into());
    }
    let k = key.to_lowercase();
    worktree_infos(app, state, root)?
        .into_iter()
        .find(|w| {
            w.name.as_deref().is_some_and(|n| n.to_lowercase() == k)
                || w.branch.to_lowercase() == k
                || w.path.to_lowercase() == worktree::norm(std::path::Path::new(&k))
                || w.path.rsplit('/').next().is_some_and(|f| f.to_lowercase() == k)
        })
        .ok_or(format!("이 프로젝트에 '{key}' 워크트리가 없어요"))
}

/// Start/resume the agent, wait for its prompt, paste the text.
fn deliver(app: &AppHandle, state: &AppState, root: &str, path: &str, text: &str) -> Result<(), String> {
    let (agent, _) = ensure(app, state, root, path)?;
    if agent.wait_ready() {
        return Err("그 워크트리는 폴더 신뢰 확인이 먼저 필요해요 (Maestro 화면에서 확인)".into());
    }
    agent.send(text, &[])
}

fn last_answer(app: &AppHandle, root: &str, path: &str) -> Option<String> {
    let meta = files(app, root, path).ok()?.read_meta()?;
    let home = home(app).ok()?;
    let id = agent::conversation_id(&meta, &home, path)?;
    let events = agent::Tail::read_all(agent::transcript_file(&meta.adapter_id, &home, path, &id), &meta.adapter_id);
    events.iter().rev().find_map(|e| {
        let texts: Vec<&str> = e["message"]["content"].as_array()?.iter().filter_map(|b| b["text"].as_str()).collect();
        (e["type"] == "assistant" && !texts.is_empty()).then(|| texts.join("\n"))
    })
}
