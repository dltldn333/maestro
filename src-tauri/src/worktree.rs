use std::path::{Path, PathBuf};
use std::process::Command;

fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(dir).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flash from a GUI app
    }
    let out = cmd.output().map_err(|e| format!("git 실행 실패: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Repo root of any path inside a git working tree.
pub fn toplevel(path: &str) -> Result<String, String> {
    git(Path::new(path), &["rev-parse", "--show-toplevel"])
        .map_err(|e| format!("Git 저장소가 아닙니다: {e}"))
}

/// FNV-1a: stable across Rust versions, unlike DefaultHasher, so the project dir never moves.
fn fnv1a(s: &str) -> u32 {
    s.bytes().fold(0x811c_9dc5u32, |h, b| (h ^ b as u32).wrapping_mul(0x0100_0193))
}

fn sanitize(s: &str) -> String {
    s.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect()
}

/// ~/.maestro/projects/<name>_<hash>
pub fn project_dir(home: &Path, root: &str) -> PathBuf {
    let name = Path::new(root).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    home.join(".maestro").join("projects").join(format!("{}_{:08x}", sanitize(&name), fnv1a(root)))
}

/// `git worktree add -b`, adding -2, -3 … when the branch or folder already exists.
pub fn create(root: &str, project_dir: &Path, branch: &str, base: &str) -> Result<(PathBuf, String), String> {
    let root = Path::new(root);
    for n in 1..100 {
        let cand = if n == 1 { branch.to_string() } else { format!("{branch}-{n}") };
        let path = project_dir.join("worktrees").join(sanitize(&cand));
        let taken = git(root, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{cand}")]).is_ok();
        if taken || path.exists() {
            continue;
        }
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        git(root, &["worktree", "add", "-b", &cand, &path.to_string_lossy(), base])?;
        return Ok((path, cand));
    }
    Err(format!("사용 가능한 브랜치 이름이 없습니다: {branch}"))
}

/// Removes the worktree folder and deletes its branch (the agent's commits are lost).
pub fn discard(root: &str, path: &Path, branch: &str) -> Result<(), String> {
    let root = Path::new(root);
    git(root, &["worktree", "remove", "--force", &path.to_string_lossy()])?;
    git(root, &["branch", "-D", branch]).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_dir_is_stable_and_safe() {
        let a = project_dir(Path::new("/h"), "C:/dev/my app");
        assert_eq!(a, project_dir(Path::new("/h"), "C:/dev/my app"));
        assert!(a.to_string_lossy().contains("my_app_"));
        assert_ne!(a, project_dir(Path::new("/h"), "D:/dev/my app"));
    }
}
