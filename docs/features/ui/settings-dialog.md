---
title: 설정 창
area: ui
status: done
files: [src/SettingsDialog.tsx, src/settings.ts, src/App.tsx, src/Sidebar.tsx, src/Canvas.tsx]
related: [reference/settings-keys.md, features/agents/cli-install.md, features/agents/answer-summaries.md, features/agents/away-stop.md, features/ui/themes-and-motion.md]
updated: 2026-11-01
---

# 설정 창

## 요약

설정은 팝업 창으로 열려요. 탭은 에이전트 / 실행 / 스타일 세 개예요. 사이드바 아래 설정 버튼으로 열고, 사이드바를 숨겼을 때는 캔버스 줌 바의 톱니바퀴로 열어요. 에이전트 CLI가 하나도 없으면 앱을 켤 때 자동으로 열려요.

## 동작

**에이전트 탭**
- 기본값
  - 기본 에이전트: 자동 또는 쓸 수 있는 에이전트 칩(로고 포함). 자동은 쓸 수 있는 첫 에이전트예요.
  - 권한: 새 워크트리의 권한 모드
  - 보조 모델: 요약 같은 가벼운 일에 쓸 에이전트와 모델, 또는 끔 → [답변 요약](../agents/answer-summaries.md)
- 에이전트 목록: 설치된 것과 설치 가능한 것을 타일로 보여 줘요.
  - 타일마다 켜기/끄기, "기본으로", 펼치면 기본 모델과 설치·로그인 터미널이 있어요. → [CLI 설치](../agents/cli-install.md)
  - "↻ 다시 확인"으로 설치 상태를 다시 읽어요.

**실행 탭**
- 자리 비움: "자리 비운 프로젝트 정리" 드롭다운(5분 / 15분 / 1시간 / 끄지 않음) → [자리 비움](../agents/away-stop.md)

**스타일 탭**
- 테마 견본, 패널 구분(분리 / 통합 / 와이드), 모션 사용, 이징, 속도, 미리보기 → [테마와 모션](themes-and-motion.md)

## 구현

- `SettingsDialog`(SettingsDialog.tsx): `SECTIONS`(`agents`, `run`, `style`)로 탭을 나눠요.
- 구성 요소: `AgentTile`, `AssistantRow`, `InstalledDetails`, `SetupTerminal`, `InstallHelp`, `useModels`, `GearIcon`
- 값은 모두 `useSettings`(zustand persist, 키 `maestro.settings`)에 저장돼요. → [설정 키](../../reference/settings-keys.md)

## 결정 기록

- 테마 설정은 자주 쓰지 않아서 사이드바가 아니라 팝업에 넣었어요(Antigravity 앱의 설정 창 참고).
- 탭 이름 "일반"은 "에이전트"로 바꿨어요. 레이아웃은 Orca를 너무 닮지 않게 자체 스타일로 다듬었어요.
- 자리 비움 설정은 에이전트 설정과 성격이 달라서 새 "실행" 탭으로 뺐어요.
