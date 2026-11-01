---
title: 캔버스 구성 (프로젝트 캔버스, 마에스트로 캔버스, 워크트리 캔버스)
area: canvas
status: done
files: [src/App.tsx, src/ProjectMap.tsx, src/Canvas.tsx, src/AgentFull.tsx, src/nodes/WorktreeCard.tsx, src/nodes/AgentNode.tsx, src-tauri/src/main.rs]
related: [features/canvas/canvas-controls.md, features/canvas/minimap.md, features/canvas/prompt-blocks.md, features/canvas/markdown-blocks.md, features/orchestration/maestro-agent.md, features/orchestration/worker-hierarchy.md, features/agents/answer-summaries.md]
updated: 2026-11-01
---

# 캔버스 구성

## 요약

캔버스는 세 가지예요.
- **프로젝트 캔버스(`ProjectMap`):** 사이드바에서 프로젝트를 누르면 나와요. 구조만 보여 주고, 항상 트리 모양이에요.
- **마에스트로 캔버스:** 마에스트로 에이전트 블록 아래에 워크트리 카드들을 놓고 연결선과 참조를 편집해요.
- **워크트리 캔버스:** 워크트리 하나의 에이전트 블록과 프롬프트 블록을 놓아요.

워크트리에 들어가면 기본은 전체 화면 에이전트이고, 캔버스는 전환해서 봐요.

## 동작

**프로젝트 캔버스**
- 카드(`structure_card`)마다 이름, 상태, 외부 배지, 에이전트 로고, 설명, 참조 문서·페르소나 칩, 브랜치와 워커 수가 보여요.
- 카드를 더블클릭하면 그 워크트리로 들어가요.
- "+" 칩을 누르면 참조 문서 선택 창(`RefPicker`)이 열려요.
- 위쪽 버튼:
  - 마에스트로가 있으면 "♛ 마에스트로 캔버스"
  - 없으면 "♛ 마에스트로 만들기"
- 여기서는 연결을 바꾸지 않아요.

**마에스트로 캔버스**(`Canvas`, `scope` = 마에스트로)
- 맨 위에 마에스트로 에이전트 블록이 있고, 아래에 워크트리 카드(`worktree_card`)가 놓여요.
- 워크트리 카드에 보이는 것:
  - 상태와 변경된 파일 수
  - 최근 답변 요약 → [답변 요약](../agents/answer-summaries.md)
  - 바로 지시를 보내는 작은 입력창
- 연결:
  - 계층선(마에스트로 → 워커)과 참조선(마크다운 → 에이전트)을 이 캔버스에서 만들고 끊어요.
  - 선을 고르면 ×가 나와요. ×를 누르거나 Delete 키로 끊어요.
  - 카드에서 선을 끌어 빈 곳에 놓으면 그 카드의 워커로 새 워크트리를 만들어요. → [워커 계층](../orchestration/worker-hierarchy.md)
- 버튼: "+ 워커", "+ 프롬프트 블록", "보관함"(마크다운 끌어오기)
- 카드를 더블클릭하면 그 워크트리로 들어가요.

**워크트리 화면**
- 기본은 전체 화면(`AgentFull`)이에요. Claude Code 앱처럼 에이전트 하나가 화면을 채워요.
- "전체 화면 / 캔버스" 전환(`LayoutToggle`)으로 캔버스로 바꿔요. 이 선택은 설정 `agentLayout`에 저장돼요.
- 캔버스에서는 에이전트 블록(`pty_terminal_node`)과 프롬프트 블록을 자유롭게 놓아요. 블록 오른쪽 아래 모서리를 끌어 크기를 바꿔요.
- 뒤로 버튼으로 프로젝트로 돌아가요.

**공통**
- 블록 위치는 격자(`GRID`)에 맞춰져요.
- 캔버스마다 배치와 화면 위치가 저장돼요.
- 처음 열거나 트리 배치 전에 저장된 캔버스는 한 번 트리로 자동 배치돼요(`treeLayout`).
  - 마에스트로가 맨 위, 워커는 부모 아래, 형제는 옆으로 놓여요.
  - 상위가 없는 워크트리도 마에스트로 아래에 선 없이 놓여요.
- 연결점은 블록 네 변에 있어요. 선은 두 블록이 마주 보는 변에서 나가고 들어와요(`facingSides`).

## 구현

- 화면 고르기(App.tsx):
  - 선택 없음 → `ProjectMap`
  - 마에스트로 → `Canvas`
  - 워크트리 → `agentLayout`이 `full`이면 `AgentFull`, 아니면 `Canvas`
- 저장: `load_canvas_state` / `save_canvas_state(project_root, key)`
  - 저장 위치는 `~/.maestro/projects/<프로젝트>/canvases/<key>.json`이에요. → [저장 위치](../../reference/storage-layout.md)
  - 형식은 `CanvasStateSchema`(types.ts)예요. `tree: 1`이면 트리 배치를 한 번 했다는 뜻이에요.
- 노드 종류: `nodeTypes = { prompt_input_primitive, pty_terminal_node, worktree_card, markdown_block }`
- 선 종류: `CanvasEdge.data.kind`
  - `command_pipe`(프롬프트 → 에이전트, 캔버스에 저장)
  - `orchestrates`(계층), `reference`(참조) — 이 둘은 에이전트 메타에서 그려요
- 연결 모드는 `ConnectionMode.Loose`예요. 네 변의 연결점이 모두 `source` 타입이어도 서로 이어져요.
- 줌을 많이 줄이면(`LOD_ZOOM` 아래) 블록이 가벼운 모양으로 그려져요.

## 결정 기록

- 처음에는 캔버스가 하나였어요. "프로젝트 → 워크트리 블록 → 들어가기" 구조 요청으로 두 단계가 됐고, 이후 마에스트로 캔버스가 더해졌어요.
- 왼쪽에 하나 남아 있던 옛 입력 연결점은 네 변 연결점과 겹쳐서 지웠어요(2026-11-01).
