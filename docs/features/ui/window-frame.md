---
title: 창 프레임과 위쪽 막대
area: ui
status: done
files: [src/App.tsx, src/styles.css, src-tauri/tauri.conf.json, src-tauri/capabilities/default.json]
related: [features/ui/side-panels.md, features/ui/themes-and-motion.md]
updated: 2026-11-01
---

# 창 프레임과 위쪽 막대

## 요약

Maestro는 운영체제의 기본 제목 표시줄을 끄고(`decorations: false`), 직접 그린 두껍고 둥근 프레임을 써요. 위쪽 막대에는 왼쪽에 Maestro 로고와 이름, 양쪽 패널 토글, 오른쪽에 창 버튼(최소화/최대화/닫기)이 있어요.

## 동작

- 위쪽 막대의 빈 곳을 끌면 창이 움직여요. 더블클릭은 운영체제 기본 동작을 따라요.
- 왼쪽부터 로고, "Maestro", 왼쪽 패널 토글이 있고, 오른쪽에 오른쪽 패널 토글과 창 버튼이 있어요.
- 선택한 프로젝트 이름은 위쪽 막대에 보이지 않아요(사이드바에 있어요).
- 사이드바, 스테이지, 오른쪽 패널은 프레임 안에 둥근 카드처럼 떨어져 놓여요. 가장자리에 붙지 않아요.

## 구현

- `<header className="topbar" data-tauri-drag-region>`(App.tsx). 드래그 영역은 자식에게 이어지지 않아서, 빈 칸(`.brand`, `.spacer`)에도 따로 달아요.
- 창 버튼: `getCurrentWindow().minimize()` / `toggleMaximize()` / `close()`
- 권한(capabilities/default.json): start-dragging, minimize, toggle-maximize, close
- 로고는 강조색 둥근 사각형 안의 "M" SVG예요(`--mae-accent`, `--mae-on-accent`).

## 결정 기록

- 참고 영상(Codex 앱)처럼 프레임을 두껍고 둥글게 하고, 위쪽 막대를 프레임과 합쳤어요.
