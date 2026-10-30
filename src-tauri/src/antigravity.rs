//! Antigravity CLI (`agy`, Google's successor to Gemini CLI) as an agent: argv, where its transcript
//! lives, and turning transcript entries into the same chat events Claude's produce.
//! Everything lives under the CLI's own data dir `~/.gemini/antigravity-cli/` (not `antigravity/`, which
//! is the IDE app's):
//! - transcript: `brain/<conversation id>/.system_generated/logs/transcript.jsonl`
//! - `cache/last_conversations.json`: working folder → its latest conversation id

use serde_json::{json, Value};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};

pub const ID: &str = "antigravity";

fn data_dir(home: &Path) -> PathBuf {
    home.join(".gemini").join("antigravity-cli")
}

pub fn transcript(home: &Path, conversation: &str) -> PathBuf {
    data_dir(home).join("brain").join(conversation).join(".system_generated").join("logs").join("transcript.jsonl")
}

/// The conversation agy is keeping for a working folder. agy can't be told an id up front, but it records
/// this map as soon as a conversation starts, so a new agent's conversation is found by its worktree.
pub fn conversation_for(home: &Path, cwd: &str) -> Option<String> {
    let map: Value = serde_json::from_str(&std::fs::read_to_string(data_dir(home).join("cache").join("last_conversations.json")).ok()?).ok()?;
    lookup(&map, cwd)
}

/// Keys are Windows paths with backslashes; ours use forward slashes. Compared case-insensitively.
fn lookup(map: &Value, cwd: &str) -> Option<String> {
    let want = cwd.replace('\\', "/").to_lowercase();
    map.as_object()?.iter().find(|(k, _)| k.replace('\\', "/").to_lowercase() == want).and_then(|(_, v)| v.as_str().map(String::from))
}

/// Maestro's permission choices → agy's flags.
pub fn argv(permission_mode: &str, conversation: Option<&str>, model: Option<&str>) -> Vec<String> {
    let mut a = vec!["agy".to_string()];
    match permission_mode {
        "bypassPermissions" => a.push("--dangerously-skip-permissions".into()),
        "plan" => a.extend(["--mode".into(), "plan".into()]),
        "auto" => a.extend(["--mode".into(), "auto".into()]),
        _ => a.extend(["--mode".into(), "accept-edits".into()]),
    }
    if let Some(id) = conversation {
        a.extend(["--conversation".into(), id.into()]);
    }
    if let Some(m) = model {
        a.extend(["--model".into(), m.into()]);
    }
    a
}

/// One-shot `agy -p` for the assistant model (summaries). Prints JSON with `response` and `conversation_id`.
pub fn ask(prompt: &str, model: &str) -> Result<String, String> {
    let mut cmd = std::process::Command::new("agy");
    cmd.args(["-p", prompt, "--output-format", "json", "--disable-slash-commands"]).current_dir(std::env::temp_dir());
    if !model.is_empty() {
        cmd.args(["--model", model]);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd.output().map_err(|e| format!("agy 실행 실패: {e}"))?;
    let v: Value = serde_json::from_slice(&out.stdout).map_err(|_| "agy 응답을 읽지 못했어요".to_string())?;
    // runs in the temp dir, so its conversation never shows up as a worktree's (conversation_for)
    match v["response"].as_str() {
        Some(r) if v["status"] == "SUCCESS" => Ok(r.trim().to_string()),
        _ => Err("agy 요약 실패".into()),
    }
}

/// `agy models` → (id, label) pairs; it prints one tab-separated model per line.
pub fn models() -> Result<Vec<(String, String)>, String> {
    let mut cmd = std::process::Command::new("agy");
    cmd.arg("models");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd.output().map_err(|e| format!("agy 실행 실패: {e}"))?;
    Ok(parse_models(&String::from_utf8_lossy(&out.stdout)))
}

fn parse_models(s: &str) -> Vec<(String, String)> {
    s.lines().filter_map(|l| l.split_once('\t')).map(|(id, label)| (id.trim().into(), label.trim().into())).collect()
}

fn between<'a>(s: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let start = s.find(open)? + open.len();
    Some(&s[start..start + s[start..].find(close)?])
}

/// One transcript entry → chat events. `pending` carries tool call ids across entries: agy logs a call in
/// the model's step and its output as later GENERIC steps, in order.
pub fn to_events(e: &Value, pending: &mut VecDeque<String>) -> Vec<Value> {
    let step = e["step_index"].as_i64().unwrap_or(0);
    match e["type"].as_str() {
        Some("USER_INPUT") => {
            let c = e["content"].as_str().unwrap_or("");
            let text = between(c, "<USER_REQUEST>", "</USER_REQUEST>").unwrap_or(c).trim();
            pending.clear();
            if text.is_empty() { vec![] } else { vec![json!({ "type": "user_input", "text": text })] }
        }
        Some("PLANNER_RESPONSE") => {
            let mut content = vec![];
            if let Some(t) = e["content"].as_str().filter(|t| !t.trim().is_empty()) {
                content.push(json!({ "type": "text", "text": t }));
            }
            for (i, call) in e["tool_calls"].as_array().into_iter().flatten().enumerate() {
                let id = format!("agy-{step}-{i}");
                pending.push_back(id.clone());
                content.push(json!({ "type": "tool_use", "id": id, "name": call["name"], "input": call["args"] }));
            }
            if content.is_empty() {
                return vec![]; // thinking only
            }
            // a reply with no tool calls ends the turn
            let stop = if e["tool_calls"].as_array().is_some_and(|c| !c.is_empty()) { "tool_use" } else { "end_turn" };
            vec![json!({ "type": "assistant", "message": { "content": content, "stop_reason": stop } })]
        }
        Some("GENERIC") => match pending.pop_front() {
            Some(id) => vec![json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "tool_use_id": id, "content": e["content"], "is_error": e["status"] == "ERROR" }] } })],
            None => vec![],
        },
        _ => vec![], // SYSTEM_MESSAGE etc.
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_transcript_steps() {
        let mut p = VecDeque::new();
        let user = json!({"step_index": 0, "type": "USER_INPUT", "content": "<USER_REQUEST>\n안녕\n</USER_REQUEST>\n<ADDITIONAL_METADATA>x</ADDITIONAL_METADATA>"});
        assert_eq!(to_events(&user, &mut p), [json!({"type": "user_input", "text": "안녕"})]);
        let call = json!({"step_index": 3, "type": "PLANNER_RESPONSE", "tool_calls": [{"name": "run_command", "args": {"CommandLine": "ls"}}]});
        let ev = to_events(&call, &mut p);
        assert_eq!(ev[0]["message"]["content"][0]["id"], "agy-3-0");
        assert_eq!(ev[0]["message"]["stop_reason"], "tool_use");
        let out = to_events(&json!({"step_index": 4, "type": "GENERIC", "status": "DONE", "content": "a.txt"}), &mut p);
        assert_eq!(out[0]["message"]["content"][0]["tool_use_id"], "agy-3-0");
        let done = to_events(&json!({"step_index": 5, "type": "PLANNER_RESPONSE", "content": "끝났어요"}), &mut p);
        assert_eq!(done[0]["message"]["stop_reason"], "end_turn");
        assert!(to_events(&json!({"step_index": 6, "type": "PLANNER_RESPONSE", "thinking": "hm"}), &mut p).is_empty());
        assert!(to_events(&json!({"type": "SYSTEM_MESSAGE", "content": "x"}), &mut p).is_empty());
    }

    #[test]
    fn maps_permission_modes() {
        assert_eq!(argv("acceptEdits", None, None), ["agy", "--mode", "accept-edits"]);
        assert_eq!(argv("bypassPermissions", Some("c1"), Some("m")), ["agy", "--dangerously-skip-permissions", "--conversation", "c1", "--model", "m"]);
    }

    #[test]
    fn finds_conversation_by_worktree() {
        let map = json!({ "C:\\Users\\u\\.maestro\\projects\\demo\\worktrees\\agent-2": "be10", "C:\\Users\\u\\AppData\\Local\\Temp": "d136" });
        assert_eq!(lookup(&map, "C:/Users/u/.maestro/projects/demo/worktrees/agent-2").as_deref(), Some("be10"));
        assert_eq!(lookup(&map, "c:/users/u/.maestro/projects/demo/worktrees/AGENT-2").as_deref(), Some("be10"));
        assert_eq!(lookup(&map, "C:/Users/u/.maestro/projects/demo/worktrees/agent-3"), None);
    }

    #[test]
    fn parses_model_list() {
        let got = parse_models("Fetching available models...\ngemini-4-argon-high\tGemini 4 Argon (High)\nclaude-opus-5-5-low\tClaude Opus 5.5 (Low)\n");
        assert_eq!(got, [("gemini-4-argon-high".into(), "Gemini 4 Argon (High)".into()), ("claude-opus-5-5-low".into(), "Claude Opus 5.5 (Low)".into())]);
    }
}
