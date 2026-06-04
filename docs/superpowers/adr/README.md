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
| 0006  | [PPR-ready layout — Suspense + UserNav 격리](./0006-ppr-ready-layout-suspense-usernav.md) | Accepted | 2026-05-20   |
| 0007  | [좌석 실시간성 — SSE/WebSocket 대신 20초 폴링](./0007-polling-20s-vs-sse-flash-sale.md) | Accepted | 2026-05-20   |
| 0008  | [`listDepartureSeats` uncached — 폴링 채널 분리 원칙](./0008-listdepartureseats-uncached.md) | Accepted | 2026-05-20   |
| 0009  | [NO-REAL-MONEY 경계의 코드 강제 — env Zod superRefine](./0009-no-real-money-env-invariant.md) | Accepted | 2026-05-20   |
| 0010  | [`isCancelableByUser` = `ALLOWED_TRANSITIONS` SSOT](./0010-iscancelablebyuser-allowed-transitions-ssot.md) | Accepted | 2026-05-20   |
| 0011  | [dev_mock 키 reconcile 스크립트 — backoff 무한 실패 잔재 처리](./0011-dev-mock-reconcile-script.md) | Accepted | 2026-05-20   |
| 0012  | [PDP — `searchParams` 의존 client-fetch hoist 로 ISR 복귀 준비](./0012-pdp-searchparams-client-fetch-isr-return.md) | Accepted | 2026-05-23   |
| 0013  | [Toss Webhook v2024-06-01 마이그레이션 — envelope-first + transmission-id 멱등 + verification 분리](./0013-toss-webhook-v2-envelope-first.md) | Accepted | 2026-05-26   |
| 0014  | [NO-REAL-MONEY env 강제 — `test_` 화이트리스트 격상 (블랙리스트 → 화이트리스트)](./0014-no-real-money-env-enforcement.md) | Accepted | 2026-05-26   |
| 0015  | [PDP wishlist 의존을 client-fetch island 로 분리해 ISR 활성화 (A6)](./0015-wishlist-island-isr.md) | Accepted | 2026-05-26   |
| 0016  | [Toss Webhook 진위 검증 — 결제 조회 API cross-check 채택 + HMAC 헬퍼 제거](./0016-toss-webhook-verification.md) | Accepted | 2026-05-26   |
| 0017  | [`useSearchParams` 클라이언트 컴포넌트의 Suspense 박제(內) 패턴](./0017-usesearchparams-internal-suspense.md) | Accepted | 2026-05-26   |
| 0018  | [`(site)/layout.tsx` 의 `auth()` 의존을 client island 로 격리 + PDP `generateStaticParams`](./0018-layout-auth-client-island.md) | Accepted | 2026-05-26   |
| 0019  | [Wishlist 토글 — `useOptimistic` 폐기 + CustomEvent 기반 cross-island 동기화](./0019-wishlist-toggle-no-flicker-event-bus.md) | Accepted | 2026-05-27   |
| 0020  | [캐시 무효화 컨트랙트 + force-dynamic audit (Phase 3 B1)](./0020-cache-tag-contracts-and-force-dynamic-audit.md) | Accepted | 2026-05-27   |
| 0021  | [Sentry SDK 채택 + sourcemap upload policy](./0021-sentry-sdk-adoption.md) | Accepted | 2026-05-27   |
| 0022  | [Rate Limit 4-tier sliding window + Hybrid 통합 (middleware + route/action wrapper)](./0022-rate-limit-hybrid-integration.md) | Accepted | 2026-05-28   |
| 0023  | [Rate Limit Fail-Open 강등 정책 (Upstash 부재/장애 시)](./0023-rate-limit-fail-open-policy.md) | Accepted | 2026-05-28   |
| 0024  | [SENTRY_AUTH_TOKEN runtime 차단 invariant — Vercel 예외 분기](./0024-sentry-auth-token-vercel-runtime-relaxation.md) | Accepted | 2026-05-29   |
| 0025  | [CSP nonce 경로별 분기 — ISR 캐시-nonce 미스매치 차단](./0025-csp-route-scoped-nonce.md) | Accepted | 2026-05-29   |
| 0026  | [임베딩 파이프라인 — 비동기 EmbeddingJob 큐 + contentHash 멱등 + Cron Worker](./0026-async-embedding-job-pipeline.md) | Accepted | 2026-06-01   |
| 0027  | [Departure CMS — 취소 cascade 범위 제외 + 가격 스냅샷 무결성 + admin 리터럴 CAS](./0027-departure-cancel-scope-and-literal-cas.md) | Accepted | 2026-06-02   |
| 0028  | [출발 취소 Cascade — 부모 배치 오케스트레이션 + 부분 실패 복구](./0028-departure-cancel-cascade-batch.md) | Accepted | 2026-06-02   |
| 0029  | [리뷰 시스템 경계 — client-safe URL 빌더 + 모더레이션 무효화 SSOT 재사용](./0029-review-system-boundaries.md) | Accepted | 2026-06-03   |
| 0030  | [트랜잭셔널 아웃박스 단일 훅 + Resend 멱등키 effectively-once](./0030-email-outbox-and-idempotency.md) | Accepted | 2026-06-03   |
| 0031  | [위약금 동결 스냅샷 + 부분취소 상태 모델 (Phase 5-B)](./0031-penalty-snapshot-partial-cancel.md) | Accepted | 2026-06-04   |
| 0032  | [대시보드 집계 `entities/analytics` 통합 read-model 슬라이스 (Phase 6)](./0032-analytics-readmodel-slice.md) | Accepted | 2026-06-04   |
| 0033  | [Recharts 채택 + `'use client'` 리프 격리 (Phase 6)](./0033-recharts-chart-library.md) | Accepted | 2026-06-04   |
| 0034  | [단일 Cron Dispatcher + Vercel daily + 외부 트리거로 실시간성 분리](./0034-cron-dispatcher-consolidation.md) | Accepted | 2026-06-04   |

## 향후 후보 (작성 대기)

_(현재 대기 항목 없음)_
