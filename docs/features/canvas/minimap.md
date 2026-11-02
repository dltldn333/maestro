---
title: 미니맵 (ViewMap)
area: canvas
status: done
files: [src/ViewMap.tsx, src/styles.css]
related: [features/canvas/canvas-controls.md, features/canvas/two-level-canvas.md]
updated: 2026-11-02
---

# 미니맵

## 요약

캔버스 오른쪽 아래의 미니맵은 전체 캔버스가 아니라 지금 보고 있는 화면 주변을 보여 줘요. 화면 범위의 가로·세로 2배를 보여 주고, 가운데에 지금 화면을 테두리로 표시해요. 평소에는 작고 흐리다가 마우스를 올리면 커져요. 롤(LoL) 미니맵처럼 누르거나 끌어서 카메라를 옮길 수 있어요.

## 동작

- 캔버스 모양(가로세로 비율)을 따르되, 평소 최대 140×100px, 커졌을 때 최대 300×214px 안에 들어가요. 분할로 캔버스가 아주 길쭉해져도 미니맵이 커지지 않아요.
- 평소에는 작고 반투명해요. 마우스를 올리거나 누르고 있으면 커지고 진해져요. 커지는 속도와 느낌은 설정의 모션을 따라요.
- 누르면 그 지점으로 카메라가 옮겨 가요. 누른 채로 끌면 계속 따라 움직여요.
- 누르고 있는 동안은 미니맵이 고정돼서 손 밑에서 미끄러지지 않아요.
- 프롬프트 블록과 에이전트 블록은 다른 색으로 그려져요(`vm-prompt`, `vm-term`).

## 구현

- `ViewMap({ nodes })`(ViewMap.tsx): `SPAN = 2`(보이는 영역의 2배)
- 스타일: styles.css의 "view-locked minimap" 구역

## 결정 기록

- React Flow 기본 미니맵은 캔버스 전체를 줄여 보여 줘서, 블록이 멀리 흩어지면 너무 작아졌어요. 그래서 지금 화면 기준으로 바꿨어요.
