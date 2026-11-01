---
title: 이벤트 목록
area: reference
status: done
files: [src-tauri/src/agent.rs, src-tauri/src/approval.rs, src-tauri/src/control.rs, src/App.tsx, src/SettingsDialog.tsx, src/nodes/AgentNode.tsx, src/nodes/XTerm.tsx, src/types.ts]
related: [reference/tauri-commands.md, architecture/overview.md]
updated: 2026-11-01
---

# 이벤트 목록

## 요약

Rust 백엔드가 `app.emit(...)`으로 보내고 프런트엔드가 `listen<...>`으로 받는 Tauri 이벤트 전체 목록이에요. 이벤트는 6개이고 모두 앱 전체(전역)로 보내요. 페이로드 필드는 `#[serde(rename_all = "camelCase")]`라서 JS에서 camelCase로 받아요.

## 이벤트

| 이름 | 페이로드 | 보내는 곳 | 받는 곳 |
|---|---|---|---|
| `agent://state` | `{ worktreePath, state: { kind: "RUNNING" \| "IDLE" \| "TERMINATED" } }` (`AgentStatePayload`) | agent.rs `emit_state()`: 채팅 전송 시 `Agent::send` → `RUNNING`, 대화 기록 tail에서 턴 시작/끝(`state_after`), 프로세스 종료 감시 스레드 → `TERMINATED`. 그리고 `Agent::spawn` 직후 `IDLE`을 직접 보내요 | `App.tsx` → `useStore.onAgentState`(상태·읽지 않음 표시). `SettingsDialog.tsx` → 설치 터미널(`setup:<id>`)이 `TERMINATED`면 `loadCli()`로 설치 상태 재확인 |
| `agent://event` | `{ worktreePath, seq, event: ChatEvent }` (`AgentEventPayload`) | agent.rs `Agent::spawn`의 tail 스레드(250ms마다 대화 기록 파일의 새 줄을 채팅 이벤트로 변환) | `nodes/AgentNode.tsx`: 경로가 같고 `seq`가 더 크면 채팅 목록에 추가. 구독 직후 `ipc.transcript()`로 받은 기록과 `seq`로 이어 붙여요 |
| `pty://data` | `{ worktreePath, dataB64, seq }` (`PtyDataPayload`). `seq`는 지금까지의 총 바이트 수 | agent.rs `Agent::run`의 출력 스레드(16ms 또는 64KB 단위로 묶어서) | `nodes/XTerm.tsx`: 경로가 같으면 xterm에 씀. `ptySnapshot` 이후 `seq` 기준으로 중복을 버려요 |
| `agent://approval` | `Approval`: `{ id, worktreePath, toolName, toolInput, canAlways }` | approval.rs `Approvals::handle`: 에이전트의 `PermissionRequest` 훅이 로컬 서버 `/permission/<session>`으로 요청했을 때 | `App.tsx` → `useStore.addApproval` |
| `agent://approval-done` | `{ id, worktreePath }` | approval.rs `Approvals::handle`: 사용자가 답했거나, 시간 초과(590초)거나, 훅 쪽 연결이 끊겼을 때 | `App.tsx` → `useStore.dropApproval(id)` (`id`만 써요) |
| `maestro://worktrees` | `string` (프로젝트 루트) | control.rs: `maestro worktree create`(`worktree/create`)와 `maestro ref add/remove`(`ref/add`, `ref/remove`) 처리 후 | `App.tsx` → `useStore.refreshWorktrees(root)` |

## 제약과 알려진 문제

- `emit_state()`는 상태가 같거나 이미 `TERMINATED`면 보내지 않아요. 다만 `Agent::spawn` 직후의 `IDLE`은 `emit_state()`를 거치지 않고 바로 보내요.
- `agent://approval-done` 리스너 타입은 `{ id: number }`라서 `worktreePath`는 프런트엔드에서 쓰지 않아요.
- 이벤트를 놓친 승인 대기는 `list_approvals` 명령으로 다시 받아요(`App.tsx` 시작 시).
