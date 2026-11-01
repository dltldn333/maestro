---
title: 보관함과 페르소나, 참조 문서
area: orchestration
status: done
files:
  - src-tauri/src/library.rs
  - src-tauri/src/main.rs
  - src-tauri/src/agent.rs
  - src-tauri/src/control.rs
  - src/LibraryPanel.tsx
  - src/ProjectMap.tsx
  - src/Canvas.tsx
  - src/nodes/WorktreeCard.tsx
related:
  - features/canvas/markdown-blocks.md
  - features/orchestration/maestro-cli.md
  - features/orchestration/maestro-agent.md
  - architecture/agent-runtime.md
  - reference/tauri-commands.md
  - reference/storage-layout.md
updated: 2026-11-01
---

# 보관함과 페르소나, 참조 문서

## 요약

보관함(`LibraryPanel`)은 프로젝트마다 등록한 폴더의 마크다운 파일 목록이에요. 맨 위에는 모든 프로젝트가 같이 쓰는 페르소나 폴더(`~/.maestro/personas`)가 항상 나와요. 마크다운을 에이전트에 "참조"로 연결하면 에이전트 메타의 `refs`에 경로가 저장되고, 에이전트는 다음 시작 때 시스템 브리프로 페르소나 지침과 참조 문서 목록을 받아요.

## 동작

- 에이전트 캔버스 도구 막대의 `보관함` 버튼으로 오른쪽 위에 패널을 열어요.
  - `+`: 폴더 등록. `×`: 등록 해제(파일은 그대로). `↻`: 다시 읽기.
  - 파일은 제목(첫 `# ` 제목)과 폴더 기준 상대 경로로 보여요. 끌어서 캔버스에 놓으면 마크다운 블록이 돼요.
  - 페르소나 폴더 줄에는 `♟ 페르소나 · 블록을 워크트리에 이으면 그 역할을 맡아요`라고 보이고, `+`로 새 페르소나를 이름만 넣어 만들어요(Enter 확정, Esc 취소).
- 처음 실행 때 페르소나 4개가 생겨요: `planner.md`(기획자), `implementer.md`(구현 담당), `reviewer.md`(리뷰어), `tester.md`(테스터).
- 참조 연결 방법은 세 가지예요.
  - 캔버스에서 마크다운 블록과 에이전트를 선으로 잇기
  - 프로젝트 캔버스 카드의 `+`/`+N` 버튼 → `RefPicker`에서 체크
  - `maestro ref add --path … [--to …]`
- 카드에는 연결된 페르소나가 `♟ <제목>`, 다른 문서가 `≡ <제목>` 칩으로 보여요(프로젝트 캔버스는 3개까지 보이고 나머지는 `+N`).
- 실행 중인 에이전트에 페르소나를 연결하거나 해제하면 바로 `[Maestro] 이 워크트리의 페르소나가 '<제목>'(으)로 정해졌어요…` 또는 `…해제됐어요…` 메시지가 입력창으로 보내져요.

## 구현

- 페르소나(`library.rs`):
  - `personas_dir(home)` = `~/.maestro/personas`.
  - `seed_personas(home)`: 폴더가 없을 때만 만들고 `SEED` 4개 파일을 써요. 앱 시작 때 `main()`의 `setup`에서 불러요.
  - `create_persona(home, name)`: 영숫자·`-`·`_` 외 문자는 `-`로 바꾼 `<file>.md`를 만들고 `# <name>` 제목과 안내 한 줄을 써요. 이름이 비면 `"페르소나 이름을 적어 주세요"`, 같은 파일이 있으면 `"같은 이름의 페르소나가 있어요"`. 명령 `persona_create`.
  - `is_persona(home, md)`: 경로가 페르소나 폴더 아래인지(대소문자·구분자 무시).
- 마크다운 목록:
  - `title_of(path)`: frontmatter를 건너뛴 첫 `# ` 제목, 없으면 파일 이름. 명령 `md_title`.
  - `scan(folder)`: 깊이 4, 최대 500개, `.`으로 시작하는 폴더·`node_modules`·`target` 제외, 경로순 정렬.
- 등록 폴더 저장: `<project_dir>/library.json`(문자열 배열). `library_set(project_root, folders)`가 원자적으로 써요. 프론트는 페르소나 폴더를 뺀 자기 폴더만 저장해요.
- `library_list(project_root)` → `library_folders()`: 페르소나 폴더(`persona: true`)를 먼저, 그다음 등록 폴더를 `LibFolder { folder, files, persona }`로 돌려줘요. `maestro library list`도 같은 함수예요.
- 참조 저장: `AgentMeta.refs: Vec<String>`.
  - `set_ref(project_root, worktree, md, on)` → `set_reference()` → `set_ref_meta()`. 대소문자 무시로 중복을 막고 `/` 경로로 저장해요.
  - `worktree`가 빈 문자열이고 `on=false`면 프로젝트의 모든 에이전트에서 그 경로를 빼요(캔버스에서 마지막 블록을 지웠을 때).
  - 페르소나이고 대상 에이전트가 실행 중이면 별도 스레드에서 `wait_ready()` 후 페르소나 본문을 포함한 메시지를 `send()`해요.
- `WorktreeInfo`: `worktree_infos()`가 `refs`를 `is_persona`로 나눠 `personas`(제목 목록)와 `docs`(제목 목록)를 채워요. `refs`(경로)도 그대로 나가요.
- 에이전트에 전달: `agent::system_brief(home, meta)`가 `refs`를 나눠
  - 페르소나마다 `## Your persona (assigned in Maestro; follow it)` 아래 파일 본문 전체
  - 나머지는 `## Reference documents linked to you (read them before starting work)` 아래 `- <제목> (<경로>)` 목록
  - 을 붙여요. 이 브리프는 `Agent::spawn`에서 Claude는 `<meta>.brief.md`로 써서 `--append-system-prompt-file`로, Antigravity는 `<meta>.brief/AGENTS.md`로 써서 `--add-dir`로 넘겨요. 테스트: `brief_carries_persona_and_references`.
- `maestro whoami`도 `references`를 보여 줘요.

## 제약과 알려진 문제

- 문서 본문(페르소나 제외)은 브리프에 넣지 않고 경로만 줘요. 에이전트가 직접 읽어야 해요.
- 브리프는 에이전트가 시작할 때만 만들어져요. 실행 중에 문서 참조를 바꾸면 페르소나만 즉시 메시지로 알리고, 일반 문서는 다음 시작 때 반영돼요.
- 브리프와 시스템 프롬프트 전달은 Claude Code에만 있어요. Antigravity는 `argv`에 브리프가 없어서 시작 시 페르소나·참조를 받지 않아요. 실행 중 페르소나 메시지는 어댑터와 상관없이 보내져요.
- `scan` 한도(깊이 4, 500개)를 넘는 파일은 목록에 안 나와요.
- 페르소나 파일을 지우는 UI는 없어요.

## 결정 기록

- 페르소나는 프로젝트가 아니라 사용자 홈에 두어 모든 프로젝트가 같이 써요(`library.rs` 주석).
- 페르소나 폴더는 항상 첫 번째로 나오고 등록 해제할 수 없어요(`LibFolder.persona` 주석).
