---
title: Tauri 명령 목록
area: reference
status: done
files: [src-tauri/src/main.rs, src/ipc.ts, src-tauri/src/worktree.rs, src-tauri/src/agent.rs, src-tauri/src/approval.rs, src-tauri/src/cli.rs, src-tauri/src/commands.rs, src-tauri/src/library.rs, src-tauri/src/antigravity.rs]
related: [architecture/overview.md, reference/events.md, reference/storage-layout.md]
updated: 2026-11-01
---

# Tauri 명령 목록

## 요약

`src-tauri/src/main.rs`의 `generate_handler!`에 등록된 `#[tauri::command]` 42개 전체 목록이에요. 프런트엔드는 모두 `src/ipc.ts`의 `ipc.*` 래퍼를 거쳐서 `invoke`로 불러요. 인자 이름은 Tauri v2 규칙대로 Rust의 snake_case가 JS에서 camelCase로 바뀌어요(`project_root` → `projectRoot`). 아래 표의 인자는 JS 쪽 이름이에요.

실패는 모두 `Result<_, String>`의 `Err(문자열)`로 돌아오고, JS에서는 `invoke`가 그 문자열로 reject돼요. 아래 "반환"은 성공 값만 적었어요.

## 저장소·워크트리

| Rust 명령 | `ipc.*` | 인자 | 반환 | 용도 |
|---|---|---|---|---|
| `list_repos` | `listRepos` | 없음 | `RepoInfo[]` (`{ root, name, defaultBranch }`) | `~/.maestro/repos.json`에 등록된 저장소 목록 |
| `add_repo` | `addRepo` | `path` | `RepoInfo` | `git rev-parse --show-toplevel`로 저장소 루트를 찾아 `repos.json`에 추가(이미 있으면 그대로) |
| `remove_repo` | `removeRepo` | `root` | 없음 | `repos.json`에서만 빼요. 디스크의 워크트리는 건드리지 않아요 |
| `list_worktrees` | `listWorktrees` | `projectRoot` | `WorktreeInfo[]` | 마에스트로(있으면 맨 앞) + 저장소의 모든 연결 워크트리(외부 포함) |
| `list_branches` | `listBranches` | `projectRoot` | `Branch[]` (`{ name, remote, inUse }`) | 로컬 브랜치, 그다음 원격에만 있는 브랜치(짧은 이름) |
| `create_agent` | `createAgent` | `req: { projectRoot, adapterId, permissionMode, branchName, baseBranch, existingBranch, name, description, model }` | `WorktreeInfo` | 새 워크트리 + 에이전트 meta를 만들고 바로 실행. 시작 실패 시 워크트리와 meta를 지워요 |
| `create_maestro` | `createMaestro` | `req: { projectRoot, adapterId, permissionMode, model, baseBranch }` | `WorktreeInfo` | 프로젝트 폴더 자체에서 도는 마에스트로(role `maestro`)를 만들고 실행. 이미 있으면 에러 |
| `attach_agent` | `attachAgent` | `req: { projectRoot, worktreePath, adapterId, permissionMode, model }` | 없음 | 에이전트가 없는 워크트리(Maestro 밖에서 만든 것)에 에이전트를 붙이고 실행 |
| `discard_worktree` | `discardWorktree` | `projectRoot`, `worktreePath`, `branch` | 없음 | 에이전트 종료 → `git worktree remove --force`, 브랜치 삭제(`keepBranch`면 유지), 다른 에이전트의 `workers`에서 제거, meta와 `.settings.json` 삭제. 마에스트로·외부 워크트리는 meta만 지워요 |
| `link_worktrees` | `linkWorktrees` | `projectRoot`, `parent`, `child` | 없음 | `child`를 `parent`의 워커로. 트리라서 이전 부모에서 빠지고, 고리가 생기거나 마에스트로를 자식으로 두면 거절 |
| `unlink_worktrees` | `unlinkWorktrees` | `projectRoot`, `parent`, `child` | 없음 | `parent` meta의 `workers`에서 `child`를 빼요 |

`WorktreeInfo` 필드(camelCase): `path`, `branch`, `adapterId?`, `permissionMode?`, `name?`, `description?`, `state` (`{ kind }`), `isMaestro`, `workers`, `refs`, `external`, `personas`(제목), `baseBranch?`, `docs`(제목).

## 에이전트 실행

| Rust 명령 | `ipc.*` | 인자 | 반환 | 용도 |
|---|---|---|---|---|
| `send_message` | `send` | `projectRoot`, `worktreePath`, `text`, `filesAttached` (기본 `[]`) | 없음 | 채팅 입력을 에이전트 터미널에 붙여 넣어요. 필요하면 먼저 시작/이어서 실행(`ensure`). 신뢰 확인 창이 떠 있으면 에러 |
| `ensure_agent` | `ensureAgent` | `projectRoot`, `worktreePath` | 없음 | CLI 뷰가 붙을 터미널이 있게 에이전트를 시작/재개 |
| `agent_ready` | `agentReady` | `projectRoot`, `worktreePath` | `{ trustPrompt: boolean }` | TUI가 뜰 때까지 기다려요. 폴더 신뢰 확인 창이면 `trustPrompt: true` |
| `accept_trust` | `acceptTrust` | `worktreePath` | 없음 | 실행 중인 에이전트의 신뢰 확인 창을 수락 |
| `stop_agent` | `stop` | `worktreePath` | 없음 | 현재 턴만 중단(TUI에 Esc). 에이전트 프로세스는 계속 돌아요 |
| `get_transcript` | `transcript` | `projectRoot`, `worktreePath` | `{ events: ChatEvent[], seq }` | 에이전트 CLI의 대화 기록 파일을 처음부터 읽어 채팅 이벤트로 변환 |
| `list_slash_commands` | `slashCommands` | `worktreePath` | `{ name, description, source }[]` | `/` 메뉴용 사용자 명령·스킬(`.claude/commands`, `.claude/skills`; 워크트리와 홈). 내장 명령은 프런트엔드에 있어요 |

## 터미널(PTY)

| Rust 명령 | `ipc.*` | 인자 | 반환 | 용도 |
|---|---|---|---|---|
| `pty_snapshot` | `ptySnapshot` | `worktreePath` | `{ dataB64, seq }` | 스크롤백(최대 1MB)을 base64로. 에이전트가 없으면 빈 값 |
| `pty_write` | `ptyWrite` | `worktreePath`, `data` | 없음 | 키 입력을 PTY에 써요. 에이전트가 없으면 아무것도 안 해요 |
| `pty_resize` | `ptyResize` | `worktreePath`, `cols`, `rows` | 없음 | PTY 크기 변경 |

`worktreePath` 자리에 `setup:<id>` 키를 넣으면 설정 창의 설치 터미널에도 똑같이 동작해요.

## 승인

| Rust 명령 | `ipc.*` | 인자 | 반환 | 용도 |
|---|---|---|---|---|
| `list_approvals` | `listApprovals` | 없음 | `Approval[]` | 지금 대기 중인 권한 요청(이벤트를 놓친 블록용) |
| `answer_approval` | `answerApproval` | `id`, `choice` (`"allow"` / `"always"` / `"deny"` / `"cli"`) | 없음 | 권한 요청에 답해요. `cli`는 터미널 프롬프트로 되돌려요 |

## 요약·모델

| Rust 명령 | `ipc.*` | 인자 | 반환 | 용도 |
|---|---|---|---|---|
| `summarize_agent` | `summarize` | `projectRoot`, `worktreePath`, `assistantAgent`, `assistantModel` | `string \| null` | 최근 답변의 짧은 요약(프로젝트 캔버스 카드용). meta의 `summary`/`summaryKey`에 캐시. 한 번에 하나씩만 실행 |
| `antigravity_models` | `antigravityModels` | 없음 | `[string, string][]` | `agy models`로 받은 Antigravity 모델 목록 |

## CLI 설치

| Rust 명령 | `ipc.*` | 인자 | 반환 | 용도 |
|---|---|---|---|---|
| `cli_status` | `cliStatus` | 없음 | `{ agents: { id, installed, installCmd }[], npm }` | `claude-code`, `codex`, `antigravity` CLI가 PATH에 있는지, npm이 있는지 |
| `setup_start` | `setupStart` | `id` | `string` (`setup:<id>`) | 설치(필요하면) 후 로그인용으로 CLI를 띄우는 설정 창 터미널. 이미 살아 있으면 그 키를 돌려줘요 |
| `setup_stop` | `setupStop` | `id` | 없음 | 설치 터미널 종료 |

## 캔버스 상태

| Rust 명령 | `ipc.*` | 인자 | 반환 | 용도 |
|---|---|---|---|---|
| `load_canvas_state` | `loadCanvas` | `projectRoot`, `key` | `string \| null` | `canvases/<key>.json` 원문. 없으면 `null` |
| `save_canvas_state` | `saveCanvas` | `projectRoot`, `key`, `stateJson` | 없음 | 캔버스 JSON을 원자적으로(.tmp 후 rename) 저장 |

`key`는 마에스트로 캔버스면 `overview`, 워크트리 캔버스면 워크트리 폴더 이름이에요(`Canvas.tsx`). 영숫자·`-`·`_` 밖의 문자는 `_`로 바뀌어요.

## 보관함·참조

| Rust 명령 | `ipc.*` | 인자 | 반환 | 용도 |
|---|---|---|---|---|
| `library_list` | `libraryList` | `projectRoot` | `{ folder, persona, files: { path, title }[] }[]` | 페르소나 폴더(맨 앞, `persona: true`) + 프로젝트에 등록된 Markdown 폴더 |
| `library_set` | `librarySet` | `projectRoot`, `folders` | 없음 | 등록 폴더 목록을 `library.json`에 저장 |
| `persona_create` | `personaCreate` | `name` | `string` (파일 경로) | `~/.maestro/personas/<name>.md` 새로 만들기. 같은 이름이 있으면 에러 |
| `md_title` | `mdTitle` | `path` | `string` | Markdown 파일의 맨 위 `#` 제목(파일 트리에서 끌어 놓을 때) |
| `set_ref` | `setRef` | `projectRoot`, `worktree`, `md`, `on` | 없음 | 에이전트 meta의 `refs`에 Markdown 참조 추가/제거. `worktree`가 `""`이고 `on=false`면 모든 에이전트에서 제거. 페르소나면 실행 중인 에이전트에 바로 안내 메시지를 보내요 |

## 파일 편집기

| Rust 명령 | `ipc.*` | 인자 | 반환 | 용도 |
|---|---|---|---|---|
| `read_text_file` | `readTextFile` | `base`, `rel` | `{ text, mtime }` | 편집기용 텍스트 읽기. 5MB 초과·NUL 바이트(바이너리)는 거절 |
| `write_text_file` | `writeTextFile` | `base`, `rel`, `text`, `expected`, `force` (기본 `false`) | `number` (새 mtime) | 읽었을 때의 mtime(`expected`)과 다르면 `"CHANGED"`로 거절(`force`면 덮어씀) |
| `file_mtime` | `fileMtime` | `base`, `rel` | `number` | 파일 mtime(ms). 없으면 `0`. 편집기가 폴링해요 |
| `file_at_head` | `fileAtHead` | `base`, `rel` | `string` | HEAD 시점의 파일 내용(diff용). 새 파일이면 `""` |

`read_text_file`, `write_text_file`, `file_mtime`은 `inside()`로 `rel`이 `base` 밖(`..`, 절대 경로, 밖으로 나가는 링크)이면 거절해요. `file_at_head`는 철자만 검사해요(절대 경로나 `..` 거절).

## 오른쪽 패널·git

| Rust 명령 | `ipc.*` | 인자 | 반환 | 용도 |
|---|---|---|---|---|
| `list_dir` | `listDir` | `path` | `{ name, isDir }[]` | 폴더 목록(`.git` 제외, 폴더 먼저, 이름순) |
| `git_status` | `gitStatus` | `worktreePath` | `{ code, path }[]` | 변경된 파일 목록 |

## 자리 비움

| Rust 명령 | `ipc.*` | 인자 | 반환 | 용도 |
|---|---|---|---|---|
| `set_away` | `setAway` | `activeRoot` (`string \| null`), `minutes` | 없음 | 화면에 있는 프로젝트와 자리 비움 기준(분, `0`=끔)을 알려요. 30초마다 도는 `reap_away`가 이 값으로 다른 프로젝트의 쉬는 에이전트를 멈춰요 |

## 제약과 알려진 문제

- `ipc.ts`에 래퍼가 없는 명령은 없어요(42개 모두 래퍼가 있어요).
- `ensure()`를 거치는 명령(`send_message`, `ensure_agent`, `agent_ready`)은 meta가 없는 워크트리면 "이 워크트리에는 에이전트 설정이 없습니다"로 실패해요.
- `argv()`(agent.rs)는 `claude-code`와 Antigravity만 실행해요. `codex`는 `cli_status`에는 나오지만 에이전트로 시작하면 "지원하지 않는 에이전트" 에러예요.
