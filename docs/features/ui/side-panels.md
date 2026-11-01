---
title: 사이드바와 양쪽 패널 (숨기기, 너비 조절)
area: ui
status: done
files: [src/App.tsx, src/Sidebar.tsx, src/RightPanel.tsx, src/styles.css]
related: [features/ui/window-frame.md, features/editor/file-explorer.md, features/canvas/canvas-controls.md]
updated: 2026-11-01
---

# 사이드바와 양쪽 패널

## 요약

왼쪽 사이드바(저장소·워크트리)와 오른쪽 패널(파일·변경사항)은 위쪽 막대 버튼으로 숨기거나 보일 수 있고, 가운데 화면과의 경계를 끌어 너비를 바꿀 수 있어요. 보임 상태와 너비는 저장돼요.

## 동작

**숨기기**
- 위쪽 막대의 패널 아이콘으로 숨기고 보여요. 접히는 움직임은 모션 설정을 따라요.
- 숨긴 패널의 내용은 그대로 살아 있어서, 다시 열면 펼친 폴더 같은 상태가 남아 있어요.

**너비 조절**
- 경계(10px 틈)에 마우스를 올리면 커서가 바뀌고 얇은 강조색 선이 보여요.
- 끌어서 바꿔요. 왼쪽은 180~480px(기본 260), 오른쪽은 220~560px(기본 300)이에요.
- 경계를 더블클릭하면 기본 너비로 돌아가요.
- 패널을 숨기면 그쪽 손잡이도 사라져요.

**왼쪽 사이드바 내용**
- 저장소마다 이름과 기본 브랜치, 그 아래 워크트리가 계층 순서로 나와요. 마에스트로가 먼저, 워커는 들여쓰기돼요. → [워커 계층](../orchestration/worker-hierarchy.md)
- 워크트리 줄에 보이는 것:
  - 상태 점과 에이전트 로고
  - 마에스트로면 ♛와 굵은 이름(배경 강조는 없어요. 선택처럼 보여서 뺐어요)
  - 상태 글자: "작업 중", "승인 대기"만 보여요. 대기와 꺼짐은 글자 없이 상태 점으로만 보여요(꺼짐은 대개 자리 비움으로 잠시 꺼진 것이라, 열면 다시 켜져요).
- 아래쪽에 설정 버튼이 있어요.

## 구현

- 보임: `usePanelPref("maestro.showLeft" | "maestro.showRight")`, `.app[data-hide-left|right]`
- 너비: `usePanelWidth(key, def, min, max)`(localStorage `maestro.leftWidth`, `maestro.rightWidth`)
  - `.app`의 인라인 스타일로 `--mae-sidebar-w`, `--mae-right-w`를 바꿔요.
- 손잡이: `Resizer`(App.tsx)
  - pointer capture로 끌기를 처리해요.
  - 끄는 동안 `.app[data-resizing]`이 켜져서 다음이 바뀌어요.
    - 너비 애니메이션을 꺼서 패널이 늦게 따라오지 않게 해요.
    - 스테이지의 포인터를 막아서 캔버스나 터미널이 움직임을 가로채지 않게 해요.
- 손잡이는 shell 틈(10px)에 놓인 flex 항목이에요. 음수 margin으로 늘어나는 틈을 상쇄해요.
- 사이드바 상태 글자: `STATUS_LABEL`(Sidebar.tsx). `IDLE`과 `TERMINATED`는 일부러 없어요.

## 제약과 알려진 문제

- 창이 아주 좁을 때 양쪽을 최대로 늘리면 가운데가 매우 좁아질 수 있어요. 창 크기에 맞춘 제한은 없어요.
