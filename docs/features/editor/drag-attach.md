---
title: 드래그로 파일 첨부
area: editor
status: done
files: [src/RightPanel.tsx, src/LibraryPanel.tsx, src/nodes/AgentNode.tsx, src/nodes/PromptNode.tsx, src/Canvas.tsx, src/styles.css]
related: [features/editor/file-explorer.md, features/agents/chat-view.md, features/canvas/prompt-blocks.md, features/canvas/markdown-blocks.md]
updated: 2026-11-01
---

# 드래그로 파일 첨부

## 요약

파일 탐색기에서 파일이나 폴더를 끌면, 놓을 수 있는 곳(채팅 입력창, 프롬프트 블록)마다 "파일 첨부"라고 쓰인 점선 박스가 나타나요. 그 위로 가져가면 실선과 진한 색의 "놓아서 첨부"로 바뀌어요. 마크다운 파일은 캔버스에 놓으면 마크다운 블록이 돼서, 캔버스 테두리도 함께 빛나요.

## 동작

- 끄는 동안 마우스를 따라다니는 모양은 아이콘과 이름이 든 둥근 칩이에요.
- 놓을 수 있는 곳에 놓을 자리가 부드럽게 나타나요(모션 설정을 따라요). 그 위로 가면 채워져요.
- 놓으면 첨부 칩이 생겨요. 채팅은 보낼 때 `@경로`로 붙여요.
- 툴팁에 "끌어서 첨부" 같은 안내 문구는 넣지 않았어요. 끄는 동안의 표시로 알 수 있게 했어요.

## 구현

- **끌기 시작:** `TreeItem` `onDragStart`
  - `dataTransfer`에 `DRAG_MIME`(`application/x-maestro-path`, 워크트리 기준 상대 경로)을 넣어요. 마크다운이면 `MD_MIME`도 넣어요.
  - `document.documentElement.dataset.dragging`을 `"file"`(마크다운이면 `"file md"`)로 두고, `onDragEnd`에서 지워요.
  - 문서 목록(DocsList)에서 끌면 `"md"`예요.
- **칩:** `.drag-chip` 요소를 잠깐 만들어 `setDragImage`로 넘기고, 다음 프레임에 지워요. 브라우저는 그 순간 모양을 찍어 두기 때문이에요.
- **놓을 자리**(styles.css)
  - `:root[data-dragging~="file"] :is(.composer, .node-prompt)::after`가 박스예요.
  - 그 위에 있으면 대상이 `data-over`를 붙여요. 그러면 "놓아서 첨부"로 바뀌어요.
  - `:root[data-dragging~="md"] .stage:has(.react-flow)::after`가 캔버스 테두리예요.
- **깜빡임 방지:** `onDragLeave`는 관련 요소가 자기 안이면 무시해요(`currentTarget.contains(relatedTarget)`). 안 그러면 안쪽 입력창을 지날 때마다 표시가 꺼졌다 켜져요.
- **받는 쪽:** Composer(AgentNode.tsx)와 PromptNode가 `DRAG_MIME`만 받고, Canvas는 `MD_MIME`만 받아요.

## 결정 기록

- 처음에는 툴팁 문구("눌러서 편집, 끌어서 첨부")와 얇은 테두리로 표시했는데, 문구 대신 상호작용으로 알려 주자는 요청에 따라 지금처럼 바꿨어요.
