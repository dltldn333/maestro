---
title: 에이전트 실행 방식 (PTY + 트랜스크립트)
area: architecture
status: done
files: [src-tauri/src/agent.rs, src-tauri/src/antigravity.rs, src-tauri/src/main.rs, src/nodes/XTerm.tsx, src/nodes/AgentNode.tsx]
related: [architecture/overview.md, features/agents/chat-view.md, features/agents/cli-view.md, features/agents/agent-adapters.md, reference/storage-layout.md]
updated: 2026-11-01
---

# 에이전트 실행 방식

## 요약

에이전트마다 실제 CLI(TUI)를 PTY 하나에 띄워요. CLI 뷰는 그 PTY 화면을 그대로 보여 주고, 채팅 뷰는 CLI가 디스크에 쓰는 대화 기록(트랜스크립트)을 따라 읽어서 말풍선으로 바꿔요. 채팅에서 보낸 메시지는 PTY에 붙여넣기로 입력돼요. 그래서 두 뷰는 같은 프로세스를 다르게 보여 줄 뿐이에요.

## 동작

- 에이전트 블록을 열면 CLI가 먼저 떠요. 채팅 입력은 CLI가 입력을 받을 준비가 된 뒤에야 보여요. 그 전에는 "준비 중…" 로딩이 보여요.
- 처음 여는 폴더면 Claude가 "이 폴더를 신뢰할까요?"를 물어요. 채팅 뷰에 "신뢰하고 시작" 카드가 떠요.
- 앱을 다시 켜도 같은 세션으로 이어서 실행돼요.

## 구현

**띄우기:** `Agent::spawn` → `Agent::run`(agent.rs)
- 세션 id를 메타 파일에 저장해요.
  - Claude: 새 세션이면 `--session-id <uuid>`, 트랜스크립트가 이미 있으면 `--resume <uuid>`로 띄워요.
  - Antigravity: `--conversation <id>`로 이어요. → [에이전트 종류](../features/agents/agent-adapters.md)
- `argv()`가 명령을 만들어요. 권한 모드, 에이전트별 `--settings`(승인 훅), 시스템 브리프, 모델이 들어가요. Windows에서는 `cmd.exe /c`로 감싸요.
- 환경 변수:
  - `TERM=xterm-256color`, `COLORTERM=truecolor`
  - `maestro_env()`가 `MAESTRO_URL`, `MAESTRO_TOKEN`, `MAESTRO_WORKTREE`를 넣고 `~/.maestro/bin`을 PATH 앞에 붙여요.
  - `host_session_env()`가 Maestro를 Claude Code 안에서 실행했을 때 물려받는 `CLAUDECODE`, `CLAUDE_CODE_*`, `NO_COLOR` 등을 지워요. 이게 남으면 색이 안 나오거나 세션이 꼬여요.

**PTY 출력**
- 읽기 스레드가 블로킹으로 읽어요. 배처가 16ms(`BATCH_WINDOW`) 단위로 묶어서 `pty://data` 이벤트 하나로 보내요. `seq`는 지금까지의 총 바이트 수예요.
- 최근 출력은 `Scrollback`에 보관해요. 새로 열린 터미널은 `pty_snapshot`으로 이걸 받고, 이미 받은 범위의 실시간 조각은 `seq`로 걸러요.

**ConPTY 커서 위치 질의**
- ConPTY는 시작할 때 커서 위치 질의(`ESC[6n`)를 보내고 답이 올 때까지 멈춰요.
- 백엔드가 `ESC[1;1R`로 대신 답해요. CLI 뷰의 xterm도 답하므로, XTerm.tsx가 자기 답을 버려서 답이 하나만 가게 해요.

**준비 판정:** `wait_ready()`
- 붙여넣기 모드 켜짐(`ESC[?2004h`)이 보이고, 출력이 800ms 동안 조용하면 준비된 것으로 봐요.
- 45초가 지나면 그냥 준비된 것으로 쳐요.
- 그 시점 출력에 "trust"가 있으면 신뢰 확인 화면으로 판단해요. `accept_trust`가 Enter를 보내요.

**메시지 보내기:** `Agent::send`
- 브래킷 붙여넣기(`ESC[200~ … ESC[201~`) 후 Enter를 보내요.
- `!`로 시작하면 `!`를 먼저 키로 입력해요. 그래야 TUI가 bash 모드로 바뀌어요.
- `/명령`만 있으면 뒤에 공백을 붙여요. 안 그러면 TUI 자동완성이 한 번 더 완성해서 `/model/model`처럼 돼요.
- 첨부 파일은 `@경로`로 붙여요.

**트랜스크립트 따라 읽기:** `Tail`
- 위치:
  - Claude: `~/.claude/projects/<경로 슬러그>/<세션>.jsonl`
  - Antigravity: `~/.gemini/antigravity-cli/brain/<대화>/.system_generated/logs/transcript.jsonl` (IDE 앱의 `antigravity/` 폴더가 아니에요)
- `to_events()`가 줄을 채팅 이벤트(`user_input`, `assistant`, `user`(도구 결과), `interrupted`, `local_command`)로 바꿔요.
- 이벤트는 `agent://event`로 보내요. 상태(`Running`/`Idle`/`Terminated`)는 `state_after()`로 계산해서 `agent://state`로 보내요.
- 턴이 끝나면 `control::worker_done`이 상위 에이전트에 알려요. → [워커 완료 알림](../features/orchestration/worker-done-notes.md)

**종료**
- 프로세스 감시 스레드가 0.5초마다 `try_wait()`로 종료를 확인해요. ConPTY는 종료 뒤에도 파이프가 열려 있을 수 있어서 이렇게 해요.
- `kill()`은 Windows에서 `taskkill /T /F`로 프로세스 트리 전체를 끝내요.
- `Esc`(`interrupt`)는 현재 턴만 멈추고 프로세스는 살려 둬요.
- 앱이 끝나면(`RunEvent::Exit`) 모든 에이전트를 끝내요.

## 제약과 알려진 문제

- 준비 판정은 TUI 출력 모양에 기대요. CLI가 화면 구성을 바꾸면 45초 대기로 떨어질 수 있어요.
- 트랜스크립트 형식은 각 CLI의 내부 형식이라 버전이 바뀌면 깨질 수 있어요.

## 결정 기록

- **stream-json 방식을 버린 이유:** 처음에는 `claude -p --output-format stream-json`으로 채팅만 만들었어요(커밋 48c3399). 실제 CLI와 슬래시 명령, 권한, 화면이 달라서 지금 구조로 바꿨어요.
- **채팅 데이터를 트랜스크립트에서 읽는 이유:** 화면 출력(ANSI)을 파싱하는 것보다 안정적이에요.
