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
        Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// One path spelling everywhere (git prints forward slashes, PathBuf::join adds backslashes on Windows).
pub fn norm(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

/// Repo root of any path inside a git working tree.
pub fn toplevel(path: &str) -> Result<String, String> {
    git(Path::new(path), &["rev-parse", "--show-toplevel"]).map_err(|e| format!("Git 저장소가 아닙니다: {e}"))
}

/// origin's default branch, else the current branch, else HEAD.
pub fn default_branch(root: &str) -> String {
    let root = Path::new(root);
    git(root, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
        .map(|s| s.trim_start_matches("origin/").to_string())
        .or_else(|_| git(root, &["symbolic-ref", "--short", "HEAD"]))
        .unwrap_or_else(|_| "HEAD".into())
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

/// The branch the project folder has checked out.
pub fn current_branch(root: &str) -> String {
    git(Path::new(root), &["symbolic-ref", "--short", "HEAD"]).unwrap_or_else(|_| "HEAD".into())
}

/// A branch a worktree can start from or check out.
#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    /// only on a remote: checking it out makes a local tracking branch
    pub remote: bool,
    /// checked out in the project folder or a worktree: git won't check it out a second time
    pub in_use: bool,
}

/// Local branches, then remote-only ones by their short name (`origin/feat` → `feat`).
pub fn branches(root: &str) -> Result<Vec<Branch>, String> {
    let dir = Path::new(root);
    let local = git(dir, &["for-each-ref", "--format=%(refname:short)", "refs/heads"])?;
    let remote = git(dir, &["for-each-ref", "--format=%(refname:short)", "refs/remotes"])?;
    let in_use: Vec<String> = parse_worktree_list(&git(dir, &["worktree", "list", "--porcelain"])?).into_iter().map(|(_, b)| b).collect();
    Ok(merge_branches(&local, &remote, &in_use))
}

fn merge_branches(local: &str, remote: &str, in_use: &[String]) -> Vec<Branch> {
    let mut out: Vec<Branch> = local.lines().filter(|l| !l.is_empty()).map(|n| Branch { name: n.into(), remote: false, in_use: false }).collect();
    for r in remote.lines() {
        // `origin/HEAD` (shown as `origin` by newer git) is a pointer, not a branch
        let Some((_, name)) = r.split_once('/') else { continue };
        if name != "HEAD" && !out.iter().any(|b| b.name == name) {
            out.push(Branch { name: name.into(), remote: true, in_use: false });
        }
    }
    for b in &mut out {
        b.in_use = in_use.contains(&b.name);
    }
    out
}

/// A worktree in Maestro's project dir. `existing`: check out that branch (a remote-only one becomes a
/// local tracking branch, git's default). Otherwise a new `branch` from `base`, adding -2, -3 … when taken.
pub fn create(root: &str, project_dir: &Path, branch: &str, base: &str, existing: bool) -> Result<(PathBuf, String), String> {
    let root = Path::new(root);
    for n in 1..100 {
        let cand = if n == 1 { branch.to_string() } else { format!("{branch}-{n}") };
        let path = project_dir.join("worktrees").join(sanitize(&cand));
        let taken = !existing && git(root, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{cand}")]).is_ok();
        if taken || path.exists() {
            continue;
        }
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        if existing {
            git(root, &["worktree", "add", &path.to_string_lossy(), branch])?;
            return Ok((path, branch.to_string()));
        }
        git(root, &["worktree", "add", "-b", &cand, &path.to_string_lossy(), base])?;
        return Ok((path, cand));
    }
    Err(format!("사용 가능한 브랜치 이름이 없습니다: {branch}"))
}

/// Maestro-managed worktrees of `root` as (path, branch).
/// Every linked worktree of the repo (path, branch): Maestro's own and any made elsewhere (git, other
/// tools). The main checkout is left out (it's the project folder, where the Maestro runs), and so are
/// entries whose folder is gone (`prunable`).
pub fn list(root: &str) -> Result<Vec<(String, String)>, String> {
    let out = git(Path::new(root), &["worktree", "list", "--porcelain"])?;
    let root = norm(Path::new(root)).to_lowercase();
    Ok(parse_worktree_list(&out).into_iter().filter(|(p, _)| p.to_lowercase() != root).collect())
}

/// The main checkout a worktree (or the main checkout itself) belongs to: the parent of the shared `.git`.
pub fn main_checkout(path: &str) -> Option<String> {
    let common = git(Path::new(path), &["rev-parse", "--path-format=absolute", "--git-common-dir"]).ok()?;
    Path::new(common.trim()).parent().map(norm)
}

/// Made by Maestro (under its project dir) rather than found in the repo.
pub fn is_managed(path: &str, project_dir: &Path) -> bool {
    path.replace('\\', "/").to_lowercase().starts_with(&norm(&project_dir.join("worktrees")).to_lowercase())
}

/// Stable short id for a path (meta file names for worktrees Maestro didn't create).
pub fn path_id(path: &str) -> String {
    format!("{:08x}", fnv1a(&path.replace('\\', "/").to_lowercase()) as u32)
}

fn parse_worktree_list(out: &str) -> Vec<(String, String)> {
    out.replace("\r\n", "\n")
        .split("\n\n")
        .filter_map(|block| {
            let mut path = None;
            let mut branch = None;
            let mut head = "";
            for line in block.lines() {
                if let Some(p) = line.strip_prefix("worktree ") {
                    path = Some(p.replace('\\', "/"));
                } else if let Some(b) = line.strip_prefix("branch refs/heads/") {
                    branch = Some(b.to_string());
                } else if let Some(h) = line.strip_prefix("HEAD ") {
                    head = h;
                } else if line.starts_with("prunable") {
                    return None; // its folder was deleted outside git
                }
            }
            let branch = branch.unwrap_or_else(|| format!("(detached {})", &head[..head.len().min(7)]));
            path.map(|p| (p, branch))
        })
        .collect()
}

/// Removes the worktree folder and, unless `keep_branch` (it checked out a branch that existed before),
/// deletes its branch (the agent's commits are lost).
pub fn discard(root: &str, path: &str, branch: &str, keep_branch: bool) -> Result<(), String> {
    let root = Path::new(root);
    git(root, &["worktree", "remove", "--force", path])?;
    if keep_branch {
        return Ok(());
    }
    git(root, &["branch", "-D", branch]).map(|_| ())
}

/// `git status --porcelain` as (XY code, path).
pub fn status(path: &str) -> Result<Vec<(String, String)>, String> {
    let out = git(Path::new(path), &["status", "--porcelain=v1", "-uall"])?;
    Ok(out
        .lines()
        .filter(|l| l.len() > 3)
        .map(|l| {
            let file = l[3..].rsplit(" -> ").next().unwrap_or(&l[3..]).trim_matches('"');
            (l[..2].to_string(), file.to_string())
        })
        .collect())
}

/// Unified diff of one file against HEAD; untracked files show as all-added.
pub fn diff(path: &str, file: &str) -> Result<String, String> {
    let d = git(Path::new(path), &["diff", "HEAD", "--", file])?;
    if !d.is_empty() {
        return Ok(d);
    }
    match std::fs::read_to_string(Path::new(path).join(file)) {
        Ok(text) => Ok(format!("+++ {file} (새 파일)\n{}", text.lines().map(|l| format!("+{l}\n")).collect::<String>())),
        Err(_) => Ok(String::new()),
    }
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

    #[test]
    fn merges_local_and_remote_branches() {
        let b = merge_branches("main\ndev\n", "origin\norigin/HEAD\norigin/dev\norigin/feat/x\nupstream/fix", &["main".into()]);
        let names: Vec<(&str, bool, bool)> = b.iter().map(|b| (b.name.as_str(), b.remote, b.in_use)).collect();
        assert_eq!(names, [("main", false, true), ("dev", false, false), ("feat/x", true, false), ("fix", true, false)]);
    }

    #[test]
    fn parses_porcelain_worktree_list() {
        let out = "worktree C:/dev/app\nHEAD abc\nbranch refs/heads/main\n\nworktree C:/h/.maestro/wt/a\nHEAD def\nbranch refs/heads/feat/x\n\nworktree C:/h/d\nHEAD 1352154abc\ndetached\n\nworktree C:/gone\nHEAD 999\nbranch refs/heads/old\nprunable gitdir file points to non-existent location\n";
        assert_eq!(
            parse_worktree_list(out),
            vec![
                ("C:/dev/app".into(), "main".into()),
                ("C:/h/.maestro/wt/a".into(), "feat/x".into()),
                ("C:/h/d".into(), "(detached 1352154)".into()),
            ]
        );
        assert!(is_managed("C:\\h\\.maestro\\projects\\p_1\\worktrees\\agent-1", Path::new("C:/h/.maestro/projects/p_1")));
        assert!(!is_managed("C:/Users/u/Desktop/claude-1-1", Path::new("C:/h/.maestro/projects/p_1")));
        assert_eq!(path_id("C:\\A\\b"), path_id("c:/a/B"));
        // this crate's own checkout resolves to itself
        let here = env!("CARGO_MANIFEST_DIR");
        let main = main_checkout(here).unwrap();
        assert!(norm(Path::new(here)).to_lowercase().starts_with(&main.to_lowercase()));
    }
}
