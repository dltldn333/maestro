---
title: 에이전트 CLI 설치와 로그인
area: agents
status: partial
files: [src-tauri/src/cli.rs, src-tauri/src/main.rs, src/SettingsDialog.tsx, src/App.tsx]
related: [features/agents/agent-adapters.md, features/ui/settings-dialog.md, features/agents/cli-view.md]
updated: 2026-11-01
---

# 에이전트 CLI 설치와 로그인

## 요약

설정 → 에이전트 탭에서 설치되지 않은 CLI를 앱 안의 터미널로 바로 설치하고 로그인까지 마칠 수 있어요. 에이전트 CLI가 하나도 없으면 앱을 켤 때 설정 창이 자동으로 열려요.

## 동작

- 에이전트마다 접을 수 있는 타일이 있어요.
  - 설치됐으면: 켜기/끄기 스위치, "기본으로" 버튼, 기본 모델 선택
  - 안 됐으면: 설치 명령과 설치 버튼
- 설치 버튼을 누르면 타일 안에 터미널이 열려요.
  - npm 설치(`npm install -g …`)가 끝나면 바로 CLI를 실행해요.
  - 테마, 로그인, 신뢰 같은 첫 실행 화면을 그 자리에서 진행할 수 있어요.
  - Codex는 `codex login`을 실행해요.
- 이미 설치된 CLI도 같은 터미널로 로그인할 수 있어요.
- Antigravity는 npm 패키지가 없어서 앱(antigravity.google)을 먼저 설치하라고 안내해요.
- "↻ 다시 확인"으로 설치 상태를 다시 읽어요.

## 구현

- `cli::status()` → `cli_status`: 에이전트별 설치 여부와 npm 유무를 돌려줘요.
- `cli::setup_argv(id)`: 설치돼 있으면 CLI(또는 로그인) 명령만, 없으면 `npm install -g <pkg> && <CLI>`를 만들어요. Windows는 `cmd.exe /c`로 감싸요.
- `setup_start(id)`: `Agent::run`으로 PTY를 띄워요. 키는 `setup:<id>`예요. `setup_stop`으로 끝내요.
- `SetupTerminal`(SettingsDialog.tsx): `XTerm`을 그 키로 붙여요.
- App.tsx: 시작할 때 `loadCli()` 결과에 설치된 게 하나도 없으면 설정 창을 열어요.

## 제약과 알려진 문제

- 설치 터미널로 실제 설치와 로그인을 끝까지 해 보지 않았어요.
- npm(Node.js)이 없으면 설치 버튼이 동작하지 않아요.
