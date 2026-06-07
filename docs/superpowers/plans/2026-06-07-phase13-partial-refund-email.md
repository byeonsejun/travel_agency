# Phase 13 / B1 — 부분 환불 메일 파이프라인 (PARTIAL_REFUND_COMPLETED)

> 결제/환불 도메인의 마지막 미완성 루프. [ADR-0036] Notes 에서 미구현으로 박제됐던
> **부분 환불(TRAVELER_CANCEL not-last · DISCRETIONARY) 시 환불 완료 메일 미발송** 갭을 봉합한다.

## 배경 / 문제

현재 환불 완료 메일(`REFUND_COMPLETED`)은 **booking 상태전이**(`emailJobForTransition`)에만 묶여 있다.
즉 `transitionStatusTx` 가 PAID/READY → CANCELED 로 전이될 때만 아웃박스에 EmailJob 이 적재된다.

따라서 **부분 환불은 메일이 나가지 않는다**:
- `refundTraveler` (isLast=false, kind=`TRAVELER_CANCEL`) — booking 전이 없음 → 메일 없음
- `refundDiscretionary` (kind=`DISCRETIONARY`) — booking 전이 없음 → 메일 없음

`FULL_CANCEL`(전체 취소)만 booking 이 CANCELED 로 전이되어 기존 `REFUND_COMPLETED` 메일이 발송된다.

## 설계 결정 (요약)

- **D1 (적재 위치):** 환불 settle Tx(Phase 3) 안에서 트랜잭셔널 아웃박스로 EmailJob 적재. settle 이 2곳에 존재 → 둘 다 적재:
  1. `refund.ts` `runRefundSaga` Phase 3 (동기 happy-path)
  2. `refundRetry.ts` `retryRefundJob` Phase 3 (cron 재시도 경로)
- **D2 (중복 방지):** `kind === "FULL_CANCEL"` 은 기존 `REFUND_COMPLETED`(전이 아웃박스)가 담당 → **partial 메일 적재 안 함**. `DISCRETIONARY`·`TRAVELER_CANCEL` 만 `PARTIAL_REFUND_COMPLETED` 적재.
- **D3 (대상 식별):** 한 booking 에 부분 환불이 여러 번 → bookingId 만으로는 "어느 환불"인지 식별 불가. `EmailJob.refundJobId String?` nullable 컬럼 추가, dedupeKey = `partial-refund-completed:<refundJobId>`. 워커는 refundJobId 로 해당 RefundJob 을 hydrate.
- **D4 (메일 내용):** 원결제 금액(payment.amount) · 공제 위약금(refundJob.penaltyAmount) · 최종 환불 금액(refundJob.amount) · 결제수단. 위약금 0 이면 라인 숨김.
- **외부 IO 격리:** 메일 발송은 cron 워커가 Tx 밖에서(ADR-0003). 적재만 Tx 안(유실 0). 발송 실패가 환불 Tx 를 롤백시키지 않는다.

---

## Task 1 — 스키마: EmailType.PARTIAL_REFUND_COMPLETED + EmailJob.refundJobId

- [x] `prisma/schema.prisma`: `enum EmailType` 에 `PARTIAL_REFUND_COMPLETED` 추가 (주석: 부분 환불 완료 안내 — TRAVELER_CANCEL/DISCRETIONARY)
- [x] `model EmailJob` 에 `refundJobId String?` nullable 컬럼 추가 (주석: PARTIAL_REFUND_COMPLETED 일 때만 채움. 어느 RefundJob 의 환불인지 식별)
- [x] 마이그레이션: 메모리 워크어라운드 3-step (shadow DB pgvector 실패 회피) — `20260607000000_phase13_partial_refund_email`
  - `npx prisma db push --accept-data-loss` (실 DB 반영 + client 재생성)
  - `prisma/migrations/<ts>_phase13_partial_refund_email/migration.sql` 수동 작성 (AlterEnum ADD VALUE + AlterTable ADD COLUMN)
  - `npx prisma migrate resolve --applied <ts>_phase13_partial_refund_email`
- [x] 검증: `npx prisma generate` 성공 + `EmailType.PARTIAL_REFUND_COMPLETED` 가 생성된 client 타입에 존재 (grep: index.d.ts:291) + DB enum/컬럼 SELECT 확인

## Task 2 — 이메일 템플릿 + 타입 + render 배선

- [x] `src/shared/email/templates/types.ts`: `PartialRefundCompletedEmailProps` 추가 (customerName, bookingId, productTitle, originalAmount, penaltyAmount, refundAmount, paymentMethod)
- [x] `src/shared/email/templates/PartialRefundCompletedEmail.tsx` 작성 — 기존 `RefundCompletedEmail.tsx` 톤 재사용, "부분 환불" 배지/카피. 원결제·위약금·최종환불 3행. 위약금 0 이면 라인 숨김.
- [x] `src/shared/email/render.ts`: `EmailPropsByType` 에 `PARTIAL_REFUND_COMPLETED` 추가 + render 분기 (3개 타입 명시 분기로 재구성, subject: `[Nextour] 부분 환불이 완료되었습니다 — <productTitle>`)
- [x] `src/shared/email/index.ts`: `PartialRefundCompletedEmailProps` export
- [x] `src/shared/email/__tests__/render.test.ts`: PARTIAL_REFUND_COMPLETED 케이스 추가 (위약금 >0 세 금액 포함 / 위약금 0 라인 숨김) — 5 passed

## Task 3 — Hydration 로더 + 워커 분기

- [x] `src/entities/payment/api/getPartialRefundCompletedEmailData.ts`: `(refundJobId: string) => { recipientEmail, props } | null`. RefundJob → payment.amount/method, booking.user, product.title 단일 조회.
- [x] `src/entities/payment/index.ts` (barrel) export 추가
- [x] `src/shared/lib/email-job/worker.ts`: `findUniqueOrThrow` select 에 `refundJobId` 추가; `hydrate` 가 3개 타입 명시 분기 — PARTIAL_REFUND_COMPLETED → `getPartialRefundCompletedEmailData(job.refundJobId)` (refundJobId null 이면 hydration null 처리)
- [x] `src/entities/payment/api/__tests__/getPartialRefundCompletedEmailData.test.ts`: 정상/없음 케이스
- [x] `src/shared/lib/email-job/__tests__/worker.test.ts`: PARTIAL_REFUND_COMPLETED hydrate→send 케이스 추가 — 11 passed

## Task 4 — 양 settle 경로에 partial 메일 적재

- [x] `src/shared/lib/email-job/enqueue.ts`: `EnqueueEmailJobArgs` 에 `refundJobId?: string` 추가 → create data 에 반영
- [x] `src/entities/payment/api/refund.ts` `runRefundSaga` Phase 3 settle Tx: `core.kind !== "FULL_CANCEL"` 이면 partial 적재 (deep import `@/shared/lib/email-job/enqueue` — 순환 의존 회피)
- [x] `src/entities/payment/api/refundRetry.ts` Phase 3 settle Tx: `job.kind !== "FULL_CANCEL"` 이면 동일 적재 (refundJobId=jobId)
- [x] `src/entities/payment/api/__tests__/refund.test.ts`: DISCRETIONARY/TRAVELER_CANCEL → partial 적재 / FULL_CANCEL → 미적재 검증 (+ refundLedger.test mock 보정)
- [x] `src/entities/payment/api/__tests__/refundRetry.test.ts`: 재시도 경로 동일 검증

## 최종 검증 (종합)

- [ ] `npm run typecheck` 통과
- [ ] `npm run test` 통과 (신규 테스트 포함)
- [ ] `npm run lint` 통과
- [ ] `npm run build` 통과 (server-only/배럴/클라경계 회귀 차단 — 메모리 규칙)
- [ ] 런타임 증거: dev 환경에서 부분 환불 시 `📧 [DEV] Email to ...` 콘솔 폴백에 partial 메일 출력 확인 (또는 워커 단위 테스트로 페이로드 검증)
- [ ] ADR 후보 기록: PARTIAL_REFUND_COMPLETED 아웃박스 + refundJobId 식별 + FULL_CANCEL 중복 방지 결정
