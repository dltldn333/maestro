---
title: 워커 완료 메모 (worker_done)
area: orchestration
status: done
files:
  - src-tauri/src/control.rs
  - src-tauri/src/agent.rs
related:
  - features/orchestration/worker-hierarchy.md
  - features/orchestration/maestro-agent.md
  - features/orchestration/maestro-cli.md
  - architecture/agent-runtime.md
updated: 2026-11-01
---

# 워커 완료 메모 (worker_done)

## 요약

워커 에이전트가 한 턴을 끝내면 Maestro가 그 워커의 마지막 답변을 상위 에이전트 입력창에 `[maestro] 워커 '<이름>' 완료. 마지막 답변:` 메모로 붙여 넣어요. 상위(보통 마에스트로)가 폴링하지 않아도 이어서 일할 수 있게 하는 기능이에요. 구현은 `control::worker_done`이고, `agent.rs`의 트랜스크립트 tail 스레드가 호출해요.

## 동작

- 워커가 답을 끝내고 대기 상태가 되면, 상위 에이전트의 프롬프트에 다음 형식의 메시지가 보내져요.
  - `[maestro] 워커 '<이름>' 완료. 마지막 답변:\n<답변>`
  - 답변이 1500자를 넘으면 잘리고 `… (잘림, 전체는 \`maestro read --to <이름>\`)`이 붙어요.
- 상위가 실행 중이 아니면(꺼짐) 아무것도 하지 않아요. 상위를 새로 띄우지 않아요.
- 상위가 폴더 신뢰 확인 화면에 있으면 보내지 않아요.
- 상위가 없는 워크트리(또는 마에스트로 자신)는 메모를 보내지 않아요.

## 구현

- 호출 지점: `Agent::spawn`의 tail 스레드(`agent.rs`). 새 이벤트마다 `state_after(&ev)`로 다음 상태를 구하고, 아래 조건이면 "끝난 턴"으로 봐요.
  - 다음 상태가 `AgentState::Idle`
  - 이벤트 `type == "assistant"`
  - 직전 상태가 `AgentState::Running`
  - Esc 중단이나 슬래시 명령으로 끝난 경우는 이 조건에 걸리지 않게 한 것이에요(주석).
  - 조건이 맞으면 `thread::spawn(move || control::worker_done(&app, &path))`. 전달이 상위 프롬프트가 뜰 때까지 막히므로 별도 스레드예요.
- `worker_done(app, path)` (`control.rs`):
  1. `locate()`로 프로젝트와 자기 `WorktreeInfo`를 찾아요.
  2. `worktree_infos()`에서 `parent_of()`로 상위를 찾아요(`workers`에 내 경로가 있는 에이전트).
  3. `state.get(parent).filter(alive)`로 실행 중인 상위만 골라요.
  4. `agent.wait_ready()`가 참(신뢰 확인 화면)이면 그만둬요.
  5. `agent.send(done_note(name, last_answer(...)), &[])`.
  - 모든 오류는 버려요(`let _ =`, `let Ok(..) else return`).
- `done_note(name, answer)`: `MAX = 1500`자(문자 단위, `char_indices`)에서 자르고 잘렸으면 안내를 붙여요. 이름은 `name`이 없으면 브랜치예요. 테스트: `done_note_truncates_long_answers`.
- `last_answer()`: 메타의 대화 id로 트랜스크립트 전체를 읽고(`Tail::read_all`), 뒤에서부터 텍스트 블록이 있는 첫 `assistant` 이벤트의 텍스트를 이어 붙여요.
- 마에스트로 브리프(`COORDINATOR_HINT`)에도 이 메모가 온다고 적혀 있어요.

## 제약과 알려진 문제

- 사용자가 직접 워커에게 시킨 턴이 끝나도 메모가 가요. 누가 시킨 턴인지 구분하지 않아요.
- 상위가 작업 중일 때 붙여 넣은 메모가 어떻게 처리되는지(대기열에 들어가는지)는 확인 안 됨이에요. `send()`는 상위 상태를 따로 확인하지 않아요.
- 상위가 꺼져 있던 동안 끝난 턴의 메모는 나중에도 전달되지 않아요.
- Antigravity 워커도 같은 tail 스레드를 쓰므로 조건이 맞으면 메모가 가요. Antigravity 이벤트에서 이 조건이 실제로 맞는지는 확인 안 됨이에요.

## 결정 기록

- 상위가 꺼져 있으면 깨우지 않아요. 메모 하나 때문에 에이전트를 다시 띄우지 않으려는 것이에요(`worker_done` 주석).
- 답변 전체 대신 1500자만 붙여요. 전체는 `maestro read --to`로 읽게 했어요.
