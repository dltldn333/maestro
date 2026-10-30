//! The canvas library (보관함): folders registered per project whose Markdown files can be dragged
//! onto a canvas as blocks. A block shows only the file's top `#` heading.

use serde::Serialize;
use std::path::Path;

/// Personas: one Markdown file per role, shared by every project (`~/.maestro/personas`). Linking one to a
/// worktree card on the canvas makes that agent take the role.
pub fn personas_dir(home: &Path) -> std::path::PathBuf {
    home.join(".maestro").join("personas")
}

pub fn is_persona(home: &Path, md: &str) -> bool {
    md.replace('\\', "/").to_lowercase().starts_with(&format!("{}/", personas_dir(home).to_string_lossy().replace('\\', "/").to_lowercase()))
}

const SEED: [(&str, &str); 4] = [
    ("planner.md", "# 기획자\n\n요청을 작고 검증 가능한 작업으로 나눈다. 코드를 쓰기 전에 목표, 범위, 하지 않을 것, 완료 기준을 먼저 정리한다.\n\n- 모호한 점은 가정으로 적고 확인을 요청한다\n- 작업마다 대상 파일, 바꿀 내용, 확인 방법을 적는다\n"),
    ("implementer.md", "# 구현 담당\n\n맡은 작업만 가장 작은 변경으로 끝까지 구현한다. 범위 밖 수정은 하지 않는다.\n\n- 기존 코드의 방식과 이름을 따른다\n- 바꾼 로직에는 작은 테스트를 남긴다\n- 끝나면 바꾼 파일과 확인 방법을 짧게 보고한다\n"),
    ("reviewer.md", "# 리뷰어\n\n코드를 고치지 않고 읽어서 문제를 찾는다. 버그, 보안, 빠진 경우, 불필요한 코드 순으로 본다.\n\n- 지적마다 파일:줄, 무엇이 왜 문제인지, 고치는 방향을 적는다\n- 확실하지 않은 것은 확실하지 않다고 표시한다\n"),
    ("tester.md", "# 테스터\n\n변경이 실제로 동작하는지 확인한다. 테스트를 실행하고, 빠진 경우를 찾아 테스트를 추가한다.\n\n- 실행한 명령과 결과를 그대로 보고한다\n- 실패는 재현 방법과 함께 적는다\n"),
];

/// Creates the persona folder with a few starter roles the first time.
pub fn seed_personas(home: &Path) {
    let dir = personas_dir(home);
    if dir.exists() {
        return;
    }
    if std::fs::create_dir_all(&dir).is_ok() {
        for (name, body) in SEED {
            let _ = std::fs::write(dir.join(name), body);
        }
    }
}

/// A new persona file `<name>.md` with a `# name` heading; returns its path.
pub fn create_persona(home: &Path, name: &str) -> Result<String, String> {
    let name = name.trim();
    let file: String = name.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect();
    if file.trim_matches('-').is_empty() {
        return Err("페르소나 이름을 적어 주세요".into());
    }
    let path = personas_dir(home).join(format!("{file}.md"));
    if path.exists() {
        return Err("같은 이름의 페르소나가 있어요".into());
    }
    std::fs::create_dir_all(personas_dir(home)).map_err(|e| e.to_string())?;
    std::fs::write(&path, format!("# {name}\n\n이 역할이 무엇을 하고, 무엇을 하지 않는지 적어 주세요.\n")).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().replace('\\', "/"))
}

const MAX_DEPTH: usize = 4;
const MAX_FILES: usize = 500;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdFile {
    pub path: String,
    pub title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibFolder {
    pub folder: String,
    pub files: Vec<MdFile>,
    /// the shared persona folder (always listed first, can't be unregistered)
    pub persona: bool,
}

/// First `# ` heading (frontmatter skipped), else the file name without `.md`.
pub fn title_of(path: &Path) -> String {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    heading(&text).unwrap_or_else(|| path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default())
}

fn heading(text: &str) -> Option<String> {
    let mut lines = text.lines();
    let mut in_front = false;
    let mut first = true;
    for l in lines.by_ref() {
        let t = l.trim();
        if first && t == "---" {
            in_front = true;
            first = false;
            continue;
        }
        first = false;
        if in_front {
            in_front = t != "---";
            continue;
        }
        if let Some(h) = t.strip_prefix("# ") {
            return Some(h.trim().to_string()).filter(|h| !h.is_empty());
        }
    }
    None
}

/// `.md` files under a folder (skipping .git / node_modules / target), titled.
pub fn scan(folder: &Path) -> Vec<MdFile> {
    let mut out = vec![];
    walk(folder, 0, &mut out);
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<MdFile>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        if out.len() >= MAX_FILES {
            return;
        }
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if p.is_dir() {
            if depth < MAX_DEPTH && !name.starts_with('.') && name != "node_modules" && name != "target" {
                walk(&p, depth + 1, out);
            }
        } else if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("md")) {
            out.push(MdFile { path: p.to_string_lossy().replace('\\', "/"), title: title_of(&p) });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heading_skips_frontmatter_and_needs_h1() {
        assert_eq!(heading("---\ntitle: x\n---\n\n# 리뷰어\n본문").as_deref(), Some("리뷰어"));
        assert_eq!(heading("intro\n## not h1\n# Real").as_deref(), Some("Real"));
        assert_eq!(heading("no heading"), None);
    }

    #[test]
    fn personas_seed_create_and_detect() {
        let home = std::env::temp_dir().join(format!("maestro-persona-{}", std::process::id()));
        seed_personas(&home);
        assert_eq!(scan(&personas_dir(&home)).len(), 4);
        let p = create_persona(&home, "보안 담당").unwrap();
        assert!(p.ends_with("/보안-담당.md"));
        assert_eq!(title_of(Path::new(&p)), "보안 담당");
        assert!(create_persona(&home, "보안 담당").is_err());
        assert!(create_persona(&home, "  ").is_err());
        assert!(is_persona(&home, &p));
        assert!(!is_persona(&home, "C:/elsewhere/x.md"));
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn scans_markdown_with_titles() {
        let root = std::env::temp_dir().join(format!("maestro-lib-{}", std::process::id()));
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join("a.md"), "# 기획자").unwrap();
        std::fs::write(root.join("sub/b.MD"), "plain").unwrap();
        std::fs::write(root.join(".git/c.md"), "# hidden").unwrap();
        std::fs::write(root.join("x.txt"), "# not md").unwrap();
        let got = scan(&root);
        assert_eq!(got.iter().map(|f| f.title.as_str()).collect::<Vec<_>>(), ["기획자", "b"]);
        let _ = std::fs::remove_dir_all(root);
    }
}
