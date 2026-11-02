# 구현 → 리뷰 반복

구현 워커가 만든 것을 리뷰어 워커가 읽고 지적하면, 구현 워커가 고치는 것을 지적이 없어질 때까지 반복하는 절차예요.

## 구성

| 역할 | 페르소나 | 인원 | 맡는 일 |
|---|---|---|---|
| 구현 | `~/.maestro/personas/implementer.md` | 1 | 명세대로 구현하고 지적을 고침 |
| 리뷰 | `~/.maestro/personas/reviewer.md` | 1 | 고치지 않고 지적만 |

## 언제

- 실수하면 비싼 변경(보안, 데이터, 공개 API)
- 사람이 리뷰하기 전에 한 번 걸러 두고 싶을 때

## 절차

1. 구현 워커를 만들고 구현 담당 페르소나를 잇는다
   ```
   maestro worktree create --name impl --prompt "<명세>"
   maestro ref add --to impl --path ~/.maestro/personas/implementer.md
   ```
2. 구현이 끝나면 리뷰어 워커를 만들고 리뷰어 페르소나를 잇는다. 리뷰 대상 브랜치를 알려 준다
   ```
   maestro worktree create --name review --prompt "impl 브랜치의 변경을 리뷰해 줘. 코드는 고치지 말고 지적만. 파일:줄, 문제, 고칠 방향"
   maestro ref add --to review --path ~/.maestro/personas/reviewer.md
   ```
3. 리뷰 결과를 `maestro read --to review`로 받아, 꼭 고칠 것만 골라 구현 워커에게 보낸다
   ```
   maestro send --to impl --text "리뷰 지적 중 이것만 고쳐 줘: …"
   ```
4. 고친 뒤 리뷰어에게 다시 보게 한다. 꼭 고칠 지적이 없어질 때까지, 최대 3번
5. 사용자에게 남은 지적(고치지 않기로 한 것과 이유)과 함께 보고한다

## 주의

- 리뷰어 지적을 그대로 다 넘기지 않는다. 범위 밖 제안은 후속 작업으로 모은다
- 3번 돌아도 안 끝나면 멈추고 사용자에게 판단을 묻는다
