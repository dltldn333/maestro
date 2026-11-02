---
title: 테마와 모션
area: ui
status: done
files: [src/settings.ts, src/styles.css, src/SettingsDialog.tsx, src/nodes/AgentNode.tsx]
related: [features/ui/settings-dialog.md, reference/settings-keys.md]
updated: 2026-11-02
---

# 테마와 모션

## 요약

테마는 6가지예요: 블루 다크, 그래파이트, 모카, 라이트, 아이보리, 네온. 모든 색은 `--mae-*` CSS 변수로 정하고, `<html data-theme>`에 따라 바꿔요. 패널 접기, 미니맵 확대, 창 열기, 캔버스 이동 같은 움직임은 이징 하나와 속도 하나로 맞춰요.

## 동작

**테마**(설정 → 스타일)
| id | 이름 | 느낌 |
|---|---|---|
| `dark` | 블루 다크 | 기본. 푸른빛이 도는 어두운 색 |
| `graphite` | 그래파이트 | 푸른빛 없는 회색. 테두리는 밝고, 캔버스와 안쪽은 더 어두워요 |
| `mocha` | 모카 | 따뜻한 갈색 계열 어두운 색 |
| `light` | 라이트 | 밝은 테마 |
| `ivory` | 아이보리 | 따뜻한 밝은 테마 |
| `neon` | 네온 | 검은 바탕에 반투명한 어두운 파랑 요소, 은은한 파란 번짐(glow) |

- 밝은 테마(`light: true`)에서는 캔버스(React Flow)와 터미널, 편집기도 밝은 색 구성을 써요.
- 저장된 테마가 지금 목록에 없으면(예: 지운 `forest`) `dark`로 돌아가요.

**캔버스 배경**(설정 → 스타일 → 캔버스 배경)
- 점(기본) / 격자 / 십자 / 없음 중에서 골라요. 프로젝트 캔버스와 에이전트 캔버스 모두에 적용되고, 무늬 간격은 블록이 붙는 격자(24px)와 같아요.
- 격자와 십자는 테마의 테두리 색(`--mae-border`)으로 그려서 어느 테마에서도 튀지 않아요.
- **간격**: 촘촘(12px) / 보통(24px, 기본) / 넓게(48px) / 아주 넓게(96px). 블록이 붙는 24px 격자의 절반이나 배수라 무늬가 블록 정렬과 어긋나지 않아요.
- **진하기**: 10–100% 슬라이더(기본 100%). 무늬 색을 그만큼 투명하게 섞어요.
- "없음"이면 간격과 진하기는 꺼져요.

**패널 구분**(설정 → 스타일 → 패널 구분)
| 단계 | id | 패널 사이 | 좌우·아래 여백 |
|---|---|---|---|
| 분리(기본) | `cards` | 10px 틈, 패널마다 둥근 테두리 | 있음 |
| 통합 | `lines` | 선 하나, 세 패널이 둥근 상자 하나 | 있음 |
| 와이드 | `full` | 선 하나 | 없음. 창 끝까지 채우고 둥근 모서리도 없어요 |
- 위쪽 막대는 세 단계 모두 같아요.
- 통합/와이드에서 패널을 숨기면 스테이지가 그쪽 테두리(와 모서리)를 이어받아요. 너비 조절 손잡이는 선 위에 걸쳐 있어요.

**모션**(설정 → 스타일 → 모션)
- 모션 사용: 끄면 모든 움직임이 0ms가 돼요. 운영체제의 "동작 줄이기"가 켜져 있어도 0ms예요.
- 이징: 표준 / 부드럽게(기본) / 탄력 / 일정하게
- 속도: 빠르게 120ms / 보통 220ms(기본) / 느리게 360ms
- 미리보기 버튼으로 바로 느낌을 볼 수 있어요.

## 구현

- 목록과 값: `THEMES`, `EASINGS`, `SPEEDS`, `isLightTheme`, `motionMs`(settings.ts)
- 캔버스 배경: `CANVAS_BGS`(`dots`, `lines`, `cross`, `none`), 설정 `canvasBg`, `canvasGap`(`CANVAS_GAPS`), `canvasAlpha`. 색은 `color-mix(… alpha%, transparent)`로 흐리게 해요. `CanvasBackground`(nodes/AgentNode.tsx)가 React Flow `Background`의 무늬로 그리고, Canvas와 ProjectMap이 같이 써요.
- 패널 구분: `PANEL_STYLES`(`cards`, `lines`, `full`), 설정 `panelStyle`. `applySettings`가 `<html data-panels>`로 넣어요. styles.css에서 `lines`와 `full`이 같은 규칙으로 틈을 없애고, `full`만 여백·바깥 테두리·모서리를 더 없애요. id는 처음 두 단계 버전 그대로라 저장된 값이 그대로 이어져요.
- `applySettings`가 `data-theme`, `--mae-ease`, `--mae-dur`를 `<html>`에 넣어요. 첫 화면을 그리기 전에 한 번 불러서 기본 테마가 깜빡이지 않게 해요.
- CSS 변수(styles.css): `--mae-frame`, `--mae-panel`, `--mae-panel-2`, `--mae-bg`, `--mae-canvas`, `--mae-node`, `--mae-border`, `--mae-text`, `--mae-muted`, `--mae-accent`, `--mae-hover`, `--mae-selected`, `--mae-shadow` 등
  - `--mae-canvas`(캔버스)와 `--mae-node`(블록)는 기본이 `var(--mae-panel)`이에요. 테마마다 따로 정할 수 있어요.
- 네온:
  - 요소는 반투명(rgba)이고 `backdrop-filter: blur(11px)`를 써요.
  - 강조색은 `#6cc4e6`이에요. 프레임에는 은은한 radial gradient가 깔려요.
  - 기본 버튼과 실행 중 상태 점에 glow가 있어요.
- 로딩 원(`.spinner`): `display: inline-block`이어야 글자 사이에서도 크기가 유지돼요. 동작 줄이기 상태에서는 3배 느리게 돌아요.

## 결정 기록

- 네온은 여러 번 조정했어요.
  - 너무 파랗다 → 검정과 섞음
  - 번짐 줄임 → 다시 조금 늘림
  - 캔버스와 사이드바를 검정 계열로, 파랑 채도를 낮춤
  - 알파 20% 더 투명하게, 번짐 알파는 덜 빼서 잘 보이게
- 포레스트 테마는 빼고 네온을 맨 끝에 넣었어요.
- 패널 구분 이름: "프레임"은 바깥 창 프레임과 헷갈리고 "경계"는 뜻이 넓어서 "패널 구분"으로 정했어요. 단계 이름은 "블록"(캔버스 블록)이나 "카드"(워크트리 카드)와 겹치지 않게 놓이는 방식으로 붙였어요.
- 여백 켜기/끄기를 따로 두지 않고 단계에 묶었어요. "분리 + 여백 없음"은 틈은 있는데 가장자리만 붙어 어색해서, 쓸 만한 세 조합만 남겼어요.
