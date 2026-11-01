---
title: CLI 뷰
area: agents
status: done
files: [src/nodes/XTerm.tsx, src/nodes/AgentNode.tsx, src-tauri/src/agent.rs, src-tauri/src/main.rs]
related: [architecture/agent-runtime.md, features/agents/chat-view.md]
updated: 2026-11-01
---

# CLI 뷰

## 요약

CLI 뷰는 에이전트의 실제 터미널 화면을 xterm.js로 그대로 보여 줘요. 채팅 뷰와 같은 프로세스예요. 키 입력은 PTY로 바로 가요. 색은 트루컬러로 나와요.

## 동작

- 실제 Claude Code/Antigravity TUI가 그대로 보이고, 직접 타이핑할 수 있어요.
- 블록이나 창 크기를 바꾸면 터미널 크기도 맞춰 바뀌어요.
- 스크롤바는 앱 테마에 맞춰 얇게 다듬었어요.

## 구현

- `XTerm({ root?, path, start? })`(XTerm.tsx)
  - 처음에는 `pty_snapshot`으로 지금까지의 출력을 그려요.
  - 그 뒤로는 `pty://data` 이벤트를 `seq`로 걸러서 이어 그려요.
- 입력은 `pty_write`로, 크기 변경은 `@xterm/addon-fit` 뒤 `pty_resize`로 보내요.
- xterm이 내는 커서 위치 응답(CPR)은 버려요. 백엔드가 이미 답하기 때문이에요. → [에이전트 실행 방식](../../architecture/agent-runtime.md)
- 글꼴은 `Cascadia Mono, Consolas, monospace`예요.
- 설정 창의 설치·로그인 터미널도 같은 컴포넌트를 써요. 이때 키는 `setup:<id>`예요. → [CLI 설치](cli-install.md)

## 결정 기록

- **색이 안 나오던 문제:** Maestro를 Claude Code 안에서 실행하면 `NO_COLOR`와 `CLAUDE_CODE_*` 환경 변수를 물려받아 흰 글자만 나왔어요. 이 변수들을 지우고 `COLORTERM=truecolor`를 넣어 고쳤어요.
