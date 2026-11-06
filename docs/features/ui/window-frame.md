---
title: 창 프레임과 위쪽 막대
area: ui
status: done
files: [src/App.tsx, src/styles.css, src-tauri/tauri.conf.json, src-tauri/capabilities/default.json]
related: [features/ui/side-panels.md, features/ui/themes-and-motion.md]
updated: 2026-11-02
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
- 로고(`LogoMotion`, LogoMotion.tsx): 검은 공으로 만든 메타볼 M이에요. 양쪽 두 덩어리(오케스트라)는 위·아래 공이 목으로 이어져 있고, 가운데 아래 작은 공이 지휘자예요. 공들을 흐린 뒤 알파 경계로 다시 자르는 SVG 필터로 이음새를 매끄럽게 해요. 색은 테마의 글자색(`--mae-text`, 글자 옆에서는 그 글자색)을 따라서 타일 없이 그려요. 정사각형이에요(viewBox `-4 -6.5 56 56`). 위쪽 막대에서는 정지 상태예요. 움직이는 로딩 로고는 멈춰 있을 땐 정지 로고와 똑같고, 돌기 시작하면 색이 있는 빛 버전으로 서서히 바뀌었다가(`lit`) 제자리에 돌아오기 직전 다시 원래 색으로 돌아와요. 각 덩어리는 한 바퀴를 다 돌아 자기 자리로 돌아와요. 빛 버전은 공 다섯 개에 색(`BALL_COLORS`)을 주고 공마다 중심이 흰색이에요. 덩어리끼리 겹치는 곳은 `mix-blend-mode: plus-lighter`(가산 혼합)로 더해지고, 은은한 빛 번짐과 로고 중심의 흰빛이 있어요(시험 중).
- 앱 아이콘(앱 안 로고와 달리 옅은 타일 위 검은 로고): 같은 모양을 `src-tauri/icons/icon-source.svg`로 두고 `npx tauri icon src-tauri/icons/icon-source.svg`로 모든 크기를 만들어요(안드로이드·iOS 폴더는 지웠어요). 아이콘을 바꾼 뒤에는 앱을 다시 빌드해야 실행 파일에 들어가요(`build.rs`를 건드려 다시 빌드).
- 로딩 화면(`LogoLoading`): 같은 로고가 움직여요(한 단계 4.2초 루프).
  - 로고 모양으로 잠깐 멈춰요.
  - 지휘자가 먼저 출발하고 오케스트라가 조금 늦게 따라와요.
  - 셋이 가운데 쪽으로 모여(완전히 한 점이 되지 않고 세 갈래가 보이게, `GATHER` 0.62) 녹아 붙은 채 한 바퀴 더 돌아요. 그동안 공들이 각자 조금씩 엇갈려 퍼졌다 모였다를 세 번 반복해서 꼬물거려요(`WIGGLES`, `WIGGLE`). 공마다 크기도 제 박자로 커졌다 작아졌다 해요(`PULSES`, `PULSE`).
  - 다음 자리로 퍼지면서 각자 그 자리 모양이 돼요. 그래서 매 단계 끝에 정확히 로고 모양이에요.
  - 화면의 모든 로딩 로고는 시계 하나로 함께 움직여요(`LogoMotion.tsx`의 `moving` 집합 + `requestAnimationFrame` 하나). 로고가 화면에 붙는 순간 ref 콜백으로 등록되고 떨어지면 빠져서, 어느 컴포넌트에서 쓰든 따로 신경 쓸 게 없어요. 로딩 로고가 하나도 없으면 시계도 멈춰요.
  - 설정에서 모션을 끄면 멈춘 로고로 보여요. 운영체제의 동작 줄이기(Windows의 애니메이션 효과 끔)는 따르지 않아요. 로딩 표시까지 멈추면 로딩 중인지 알 수 없어서예요.
  - "저장소와 워크트리를 읽는 중…" 화면에 써요(`LogoLoading`). 글자 옆 작은 로딩 표시도 모두 같은 애니메이션이에요(`Spinner`, 16px). 예전 회전 원(`.spinner`)은 지웠어요.

## 결정 기록

- 참고 영상(Codex 앱)처럼 프레임을 두껍고 둥글게 하고, 위쪽 막대를 프레임과 합쳤어요.
