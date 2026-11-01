---
title: 에이전트 종류 (Claude Code, Antigravity, Codex)
area: agents
status: partial
files: [src-tauri/src/agent.rs, src-tauri/src/antigravity.rs, src-tauri/src/cli.rs, src/NewAgentDialog.tsx, src/assets/agents]
related: [architecture/agent-runtime.md, features/agents/cli-install.md, features/agents/answer-summaries.md]
updated: 2026-11-01
---

# 에이전트 종류

## 요약

지금 쓸 수 있는 에이전트는 Claude Code(`claude`)와 Antigravity CLI(`agy`)예요. Codex(`codex`)는 설치·로그인까지만 되고, 워크트리 에이전트로는 "준비 중"이에요. Gemini CLI는 2026년 6월에 개인 계정용 서비스가 끝나서 Antigravity로 대체했어요.

## 동작

| 에이전트 | id | 실행 파일 | 상태 |
|---|---|---|---|
| Claude Code | `claude-code` | `claude` | 채팅, CLI, 승인, 슬래시 명령, 모델 선택 다 돼요 |
| Antigravity | `antigravity` | `agy` | 채팅, CLI 돼요. 승인 카드와 Claude 전용 명령은 안 돼요. 끝까지 확인 안 됨 |
| Codex | `codex` | `codex` | 설치·로그인 터미널만 돼요. 새 워크트리에서는 고를 수 없어요 |

- 에이전트 로고는 사이드바, 카드, 새 워크트리 창, 설정에 보여요(`src/assets/agents/`).
- 설정에서 설치돼 있어도 끌 수 있어요(`disabledAgents`). 꺼진 에이전트는 새 워크트리에서 안 보여요.

## 구현

**Claude Code** (agent.rs `argv`)
- `--permission-mode`, `--settings <승인 훅 파일>`, 시스템 브리프, `--model`을 넘겨요.
- 세션은 `--session-id` / `--resume`으로 정해요.

**Antigravity** (antigravity.rs)
- 데이터 폴더: `~/.gemini/antigravity-cli/`
- 권한 모드 매핑(`argv`):
  - `acceptEdits` → `--mode accept-edits`
  - `plan` → `--mode plan`
  - `auto` → `--mode auto`
  - `bypassPermissions` → `--dangerously-skip-permissions`
- 이어 하기는 `--conversation <id>`예요. agy는 대화 id를 미리 정할 수 없어요. 그래서 `cache/last_conversations.json`(작업 폴더 → 최근 대화)에서 워크트리 경로로 찾아요(`conversation_for`).
- `to_events()`가 `USER_INPUT` / `PLANNER_RESPONSE` / `GENERIC` / `SYSTEM_MESSAGE`를 Claude와 같은 채팅 이벤트로 바꿔요.
- 모델 목록은 `agy models`에서 읽어요(`models()` → `antigravity_models` 명령).
- 시스템 브리프: agy에는 시스템 프롬프트 옵션이 없어요. 그래서 Claude와 같은 브리프(`system_brief`)를 `<meta>.brief/AGENTS.md`로 쓰고, 그 폴더를 `--add-dir`로 넘겨요. agy는 작업 공간 폴더의 `AGENTS.md`/`GEMINI.md`를 규칙으로 읽어요(`agy -p`로 확인, 2026-11-01). 워크트리 안에는 아무 파일도 안 생겨요.
- 요약용 호출(`ask`)은 임시 폴더에서 실행해요. 그래야 그 대화가 워크트리 대화로 잡히지 않아요.

**설치 확인:** cli.rs `KNOWN`, `status()`
- PATH에서 `where`(Windows) 또는 `which`로 찾아요.

## 제약과 알려진 문제

- Codex 어댑터(트랜스크립트 읽기, argv)는 아직 없어요.
- Antigravity는 승인 훅이 없어서 권한 확인을 CLI 뷰에서 답해야 해요. `maestro` 명령 자동 허용 규칙도 넘기지 못해요.
- 브리프 규칙 폴더를 대화형 실행(TUI)에서 읽는지, 그 폴더에 신뢰 확인을 묻는지는 실제로 확인하지 않았어요. 확인한 건 `-p` 실행뿐이에요.

## 결정 기록

- Gemini CLI를 넣으려다 서비스 종료를 확인하고 Antigravity CLI로 바꿨어요.
