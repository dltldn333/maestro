---
title: 슬래시 명령, bash 모드, 모델 선택
area: agents
status: done
files: [src/slashCommands.ts, src/nodes/AgentNode.tsx, src-tauri/src/commands.rs, src-tauri/src/agent.rs]
related: [features/agents/chat-view.md, architecture/agent-runtime.md]
updated: 2026-11-01
---

# 슬래시 명령, bash 모드, 모델 선택

## 요약

채팅 입력창에서 `/`를 치면 Claude Code의 기본 명령과 프로젝트·사용자의 사용자 정의 명령, 스킬 목록이 떠요. `!`로 시작하면 bash 모드가 돼요. `/model`은 TUI에만 있는 선택 화면 대신 채팅용 모델 목록을 보여 줘요.

## 동작

- **`/` 메뉴**
  - 이름으로 걸러지고, 방향키와 Enter로 골라요.
  - 터미널에서만 열리는 명령(`/config`, `/mcp`, `/permissions` 등)에는 "CLI 보기에서 열려요" 안내가 붙어요.
  - `/clear`는 새 세션이 시작돼서 채팅 뷰가 이어지지 않는다고 알려 줘요.
- **사용자 정의 명령**
  - 대상: `.claude/commands/**` 명령과 `.claude/skills/*/SKILL.md` 스킬
  - 프로젝트(워크트리)와 사용자(`~/.claude`) 둘 다 읽어요.
- **`/model`**
  - 고를 수 있는 모델: `default`, `best`, `opus`, `sonnet`, `haiku`, `fable`, `opusplan`, `opus[1m]`, `sonnet[1m]` 등
  - 고르면 `/model <이름>`으로 보내요. 입력창 옆 모델 선택기도 같은 목록을 써요(Claude만).
- **bash 모드:** `!`로 시작하면 입력창이 bash 모양(테두리 색, 고정폭 글꼴)으로 바뀌고, 명령이 셸에서 실행돼요.

## 구현

- 기본 명령과 모델 목록: `BUILTIN_COMMANDS`, `MODEL_CHOICES`, `matchCommands`(slashCommands.ts)
- 사용자 정의 명령: `list_slash_commands`(commands.rs) → `ipc.slashCommands(worktreePath)`
- 보낼 때의 처리는 `Agent::send`가 해요.
  - `/명령`만 있으면 뒤에 공백을 붙여요. TUI 자동완성 때문에 `/model/model`이 되던 문제를 막아요.
  - `!`는 먼저 키로 입력해요. 붙여넣은 `!`로는 bash 모드가 켜지지 않아요.
- 명령 결과(`<local-command-stdout>`)와 bash 입출력(`<bash-input>`, `<bash-stdout>`)은 `to_events()`가 `local_command` 이벤트로 바꿔서 채팅에 보여 줘요.

## 제약과 알려진 문제

- 선택 화면이나 대화상자를 여는 명령은 채팅에서 결과가 안 보여요. CLI 뷰로 가야 해요.
- Antigravity 전용 명령 목록은 따로 만들지 않았어요.
