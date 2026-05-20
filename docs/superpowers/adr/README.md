# ADR — Architecture Decision Records

> 이 폴더는 Nextour 프로젝트의 **누적적 아키텍처 의사결정 기록**이다.
> 모듈 단위 큰 설계는 `../specs/` 에, 작업 단위 실행 계획은 `../plans/` 에 둔다.

## ADR 이란

코드와 commit log에는 *무엇을* 했는지가 남지만, **왜 그렇게 했는지** — 특히 *고려했지만 거부한 대안과 그 근거* — 는 시간이 지나면 휘발된다. ADR은 단일 의사결정 = 단일 파일로 박제해 "6개월 뒤 누가 같은 옵션을 다시 고민하지 않게" 한다.

## 언제 ADR을 쓰는가

다음 중 하나라도 해당하면 발행:

- **여러 대안을 고민하고 한 쪽을 채택**한 경우 (가장 흔한 트리거)
- 도메인 invariant·보안 경계·데이터 무결성에 영향을 주는 결정
- 차선책(workaround) 채택 — 상위 옵션이 제약 때문에 막혔을 때
- 기존 결정을 *뒤집을* 때 (이전 ADR을 `Superseded by ADR-XXXX` 로 마킹)

다음 경우는 ADR 없이 commit log로 충분:

- 단순 버그 수정 / 리팩토링 / 의존성 업그레이드
- 코드 스타일·네이밍 변경
- 명확한 baseline path (대안 검토가 의미 없는 경우)

## 작성 절차

1. 다음 번호로 파일 생성: `NNNN-kebab-case-short-title.md` (`template.md` 복사 후 채움)
2. 본 README 의 인덱스에 한 줄 추가
3. 변경한 코드와 함께 commit (Conventional Commits: `docs(adr): 0007 ...`)

## 형식 (MADR 약식 — 한 페이지 1결정)

`template.md` 참조. 4섹션 고정:

- **Context** — 무엇이 문제였는지, 우회·임시조치로 안 풀리는 이유
- **Decision** — 채택한 방식 (코드 인용 1~3줄)
- **Consequences** — 얻은 것(+), 포기/미해결(−)
- **Alternatives Considered** — 거부한 옵션 + 거부 이유 ⭐ 가장 가치 있는 칸

## 상태(Status) 값

- `Proposed` — 토의 중, 아직 채택 전
- `Accepted` — 채택, 코드에 반영
- `Superseded by ADR-XXXX` — 더 이상 유효하지 않음, 후속 ADR로 대체
- `Deprecated` — 의도적으로 폐기, 후속 대체 없음

## 인덱스

| #     | 제목                                                                      | 상태     | 결정일       |
| ----- | ------------------------------------------------------------------------- | -------- | ------------ |
| 0001  | [Middleware callbackUrl 절대→상대 경로](./0001-middleware-relative-callback.md) | Accepted | 2026-05-20   |
| 0002  | [Booking cancel dispatch: PAID 여부로 refund/cancel 분기](./0002-cancel-dispatch-by-paid-flag.md) | Accepted | 2026-05-20   |
| 0003  | [Refund Saga 3-phase 격리 (외부 IO를 DB Tx 바깥)](./0003-refund-saga-3-phase.md) | Accepted | 2026-05-14   |
| 0004  | [캐시 2-layer: 페이지 hint + unstable_cache + revalidateTag](./0004-cache-2-layer-strategy.md) | Accepted | 2026-05-20   |
| 0005  | [Cron Worker 3중 멱등성: CAS Claim / Short-circuit / Silent transition](./0005-cron-worker-3-layer-idempotency.md) | Accepted | 2026-05-20   |
| 0009  | [NO-REAL-MONEY 경계의 코드 강제 — env Zod superRefine](./0009-no-real-money-env-invariant.md) | Accepted | 2026-05-20   |

## 향후 후보 (작성 대기)

- 0006: layout PPR-ready 구조 — Suspense + UserNav 분리
- 0007: 폴링 20s vs SSE/SeatHold — flash sale 대응의 비용-효과 절충
- 0008: `listDepartureSeats` 의도적 uncached — 폴링 채널 분리 원칙
- 0010: `isCancelableByUser` = `ALLOWED_TRANSITIONS` 단일 source of truth
- 0011: dev_mock 키 reconcile 스크립트 — backoff 무한 실패 잔재 처리
- 0012(가칭): production 환경에서도 `test_` 키만 허용 — 운영 배포 시점 검토
