//! Which agent CLIs are installed, and the command that installs + first-runs one in a setup terminal.

use serde::Serialize;
use std::process::Command;

/// (adapter id, executable, npm package or "" when it isn't on npm). The only packages the setup terminal installs.
const KNOWN: [(&str, &str, &str); 3] = [
    ("claude-code", "claude", "@anthropic-ai/claude-code"),
    ("codex", "codex", "@openai/codex"),
    // ships with the Antigravity app (antigravity.google), replaced Gemini CLI for personal accounts in June 2026
    ("antigravity", "agy", ""),
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCli {
    id: &'static str,
    installed: bool,
    install_cmd: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    agents: Vec<AgentCli>,
    /// npm (Node.js) present, so the install button can work
    npm: bool,
}

fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// On PATH? (`where` on Windows finds .cmd shims too)
fn on_path(bin: &str) -> bool {
    let finder = if cfg!(windows) { "where" } else { "which" };
    quiet(Command::new(finder).arg(bin)).output().is_ok_and(|o| o.status.success())
}

pub fn status() -> CliStatus {
    CliStatus {
        agents: KNOWN
            .iter()
            .map(|&(id, bin, pkg)| AgentCli { id, installed: on_path(bin), install_cmd: if pkg.is_empty() { String::new() } else { format!("npm install -g {pkg}") } })
            .collect(),
        npm: on_path("npm"),
    }
}

/// The command the settings' setup terminal runs: install (if missing), then the CLI itself so its
/// first-run screens — theme, login, trust — happen right there.
pub fn setup_argv(id: &str) -> Result<Vec<String>, String> {
    let &(_, bin, pkg) = KNOWN.iter().find(|k| k.0 == id).ok_or(format!("알 수 없는 에이전트: {id}"))?;
    let login = match id {
        "codex" => "codex login".to_string(),
        _ => bin.to_string(),
    };
    let line = match (on_path(bin), pkg.is_empty()) {
        (true, _) => login,
        (false, false) => format!("npm install -g {pkg} && {login}"),
        (false, true) => return Err("npm으로 설치할 수 없어요. 앱을 먼저 설치해 주세요.".into()),
    };
    Ok(if cfg!(windows) { vec!["cmd.exe".into(), "/c".into(), line] } else { vec!["sh".into(), "-c".into(), line] })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_lists_known_agents() {
        let s = status();
        assert_eq!(s.agents.iter().map(|a| a.id).collect::<Vec<_>>(), ["claude-code", "codex", "antigravity"]);
        assert_eq!(s.agents[0].install_cmd, "npm install -g @anthropic-ai/claude-code");
        assert_eq!(s.agents[2].install_cmd, "");
        let argv = setup_argv("codex").unwrap();
        assert!(argv.last().unwrap().ends_with("codex login"));
        assert!(setup_argv("nope").is_err());
    }
}
