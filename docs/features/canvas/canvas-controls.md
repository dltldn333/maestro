---
title: 캔버스 조작 (줌 바, Ctrl+휠, 사용법)
area: canvas
status: done
files: [src/Canvas.tsx, src/ProjectMap.tsx, src/SettingsDialog.tsx]
related: [features/canvas/minimap.md, features/ui/side-panels.md, features/canvas/two-level-canvas.md]
updated: 2026-11-01
---

# 캔버스 조작

## 요약

캔버스 왼쪽 아래에 줌 바가 있어요(− / 배율 / + / 전체 보기). 줌은 Ctrl+휠로 해요. 블록 위에서도 Ctrl+휠은 항상 줌이고, 그냥 휠은 블록 안을 스크롤하거나 캔버스를 움직여요. 왼쪽 사이드바를 숨기면 설정 톱니바퀴가 줌 바 왼쪽에 나타나요.

## 동작

- **줌 바**(`CanvasControls`)
  - −, + 버튼으로 줄이고 키워요.
  - 배율(%)을 누르면 100%로 돌아가요.
  - 전체 보기는 모든 블록이 보이게 맞춰요(최대 100%).
  - 움직임은 설정의 모션 속도를 따라요.
- **Ctrl+휠:** 어디서든 줌이에요. 트랙패드 핀치도 Ctrl+휠로 들어와서 똑같이 동작해요.
- **설정 버튼:** 왼쪽 사이드바가 숨겨져 있을 때만 줌 바에 톱니바퀴가 보여요. 사이드바의 설정 버튼에 손이 닿지 않기 때문이에요.
- **?(사용법):** 그 캔버스에서 할 수 있는 일을 짧게 보여 줘요.

## 구현

- `CanvasControls({ onOpenSettings })`(Canvas.tsx). 프로젝트 캔버스도 같은 컴포넌트를 써요.
- Ctrl+휠: 캔버스 요소에 캡처 단계 `wheel` 리스너(`passive: false`)를 달아요. 블록 안의 스크롤보다 먼저 잡아서 줌으로 바꿔요.
- 설정 버튼: App.tsx의 `openSettingsHere`는 왼쪽 패널이 숨겨졌을 때만 함수예요.
- 톱니바퀴 아이콘은 `GearIcon`(SettingsDialog.tsx, Lucide 경로)이에요.

## 결정 기록

- 그냥 휠이 줌이면 블록 안 채팅을 스크롤할 때 캔버스가 같이 줌돼서, 줌을 Ctrl+휠로 옮겼어요.
- 처음 쓴 톱니바퀴 아이콘이 해처럼 보여서 Lucide의 gear 모양으로 바꿨어요.
