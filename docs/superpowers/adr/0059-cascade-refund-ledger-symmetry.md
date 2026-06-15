# ADR-0059: 출발취소 cascade 환불의 원장 비대칭 해소 (saga Phase 1 reserve 미러)

- **상태**: Accepted
- **결정일**: 2026-06-14
- **영향 범위**: `src/entities/payment/api/enqueueRefundJob.ts`
- **관련 commit**: `6e33bbb` (fix), `d61d8de` (merge)

## Context (배경)

출발취소 cascade(`startDepartureCancellation`)는 **사업자 귀책** 취소라 고객 **전액환불**이 옳다. 위약금 인프라(`computePenalty`, `RefundJob.penaltyAmount/baseAmount`)를 의도적으로 우회하는 것은 올바른 설계다 — 이 부분은 바꾸지 않는다.

문제는 **원장 기록의 비대칭**이었다.

- saga 환불 경로(`refund.ts`)는 enqueue Phase 1에서 `reserveRefund`를 호출해 `Payment.refundedAmount`를 환불액만큼 미리 예약한다 (`refund.ts:65`).
- 그러나 cascade의 `enqueueRefundJob`은 `reserveRefund`를 **건너뛰고** `RefundJob` 행만 생성했다 → 전액환불이 끝나도 `Payment.refundedAmount`가 **0에 머물렀다**.
- **잠복 버그**: cron 영구실패 경로(`refundRetry.ts:185`)는 `releaseRefund(amount: job.amount)`로 예약을 되돌린다. 그런데 cascade는 reserve를 한 적이 없으므로, 영구실패가 나면 `refundedAmount`가 `0 → 음수`로 떨어져 불변식 `0 ≤ refundedAmount ≤ amount`를 위반했다.

즉 reserve↔release가 **복식부기의 차변/대변처럼 짝을 이뤄야** 하는데, cascade는 release(대변)만 있고 reserve(차변)가 없는 한쪽 장부였다.

## Decision (결정)

`enqueueRefundJob`의 enqueue Tx 안(PG 호출 전)에 **`reserveRefund` 한 곳만** 추가해 saga `refund.ts:65` Phase 1을 그대로 미러했다.

```ts
// src/entities/payment/api/enqueueRefundJob.ts (요지)
const payment = await tx.payment.findUniqueOrThrow({
  where: { id: args.paymentId },
  select: { refundedAmount: true },
});
const requestedRefund = args.amount - payment.refundedAmount; // 잔여 환불가능액

const reserved = await reserveRefund(tx, {
  paymentId: args.paymentId,
  amount: args.amount,        // payment 총액
  requestedRefund,            // 잔여만 예약
});
if (!reserved) {
  throw new PaymentError("REFUND_EXCEEDS_REFUNDABLE", { requestedRefund });
}

await tx.refundJob.create({
  data: { /* ... */ amount: requestedRefund /* = cron Toss cancelAmount */ },
});
```

- **예약/환불액 = 잔여 환불가능액**(payment 총액 − `refundedAmount`):
  - 정상 케이스(`refundedAmount=0`)는 전액과 동일 → **환불 결과 불변**(전액환불·Payment CANCELED·좌석 환원).
  - 부분환불 잔액이 있으면 잔여만 → **과환불 차단**.
- **settle·좌석 환원(`releaseSeats`)·전이(`transitionStatusTx`/`assertTransition`)·`releaseRefund`는 0줄 변경** — reserve가 생겨 release와 비로소 짝이 맞는다.
- reserve 실패(경합/한도초과 `count=0`) 시 `PaymentError` throw → 배치 fan-out 단일 Tx 전체 롤백 (saga 동일 정책).
- **`idempotencyKey`는 추가하지 않음** — cascade는 active-job 게이트(`bookingId` + status PENDING/IN_PROGRESS/SUCCEEDED 존재 검사)로 멱등을 유지한다. `fullCancelKey`를 부여하면 user 자가취소가 이미 쓴 동일 키와 P2002 충돌 위험이 생긴다.

## Consequences (결과)

**얻은 것:**
- 경로 무관 `refundedAmount` 정합 — saga와 cascade가 동형이 됐다.
- 음수 잠복 버그 봉합 — reserve↔release가 짝을 이뤄 영구실패 후에도 `refundedAmount`가 cascade 이전 값으로 정확히 원복(음수 불가).
- 부분환불 잔액 안전 — 이미 일부 환불된 payment가 cascade에 걸려도 잔여만 환불.

**포기한 것 / 미해결:**
- `idempotencyKey` 통일은 의도적 보류 — active-job 게이트로 충분하고, 통일은 P2002 충돌 위험을 새로 들인다.
- 기존 cascade가 남긴 `refundedAmount=0` 행의 데이터 백필은 범위 밖 — 데모 환경이라 무영향(미래에 운영 데이터가 쌓이면 별도 백필 검토).

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: 출발취소에 위약금 옵션 추가 (기각)
- 사전 조사의 최초 출발점은 "cascade에 위약금 적용 옵션"이었다.
- 그러나 출발취소는 **사업자 귀책**이다 — 고객에게 위약금을 물리는 것은 도메인적으로 틀렸다. 조사 단계에서 기각하고, 진짜 결함(원장 비대칭)만 분리해 고쳤다.

### 옵션 B: settle 시점에 reserve (기각)
- cron settle(`refundRetry.ts` Phase 3)에서 `reserveRefund`를 호출하는 방식.
- saga의 phasing(reserve는 PG 호출 *전* Phase 1)과 어긋난다. enqueue 시점 예약이라야 "PG 실패해도 예약은 유지, 영구실패에만 release"라는 reserve↔release 대칭이 성립한다. → enqueue(Phase 1)가 정답.

### 옵션 C: idempotencyKey 부여로 saga와 완전 통일 (보류)
- cascade에도 `fullCancelKey(bookingId)`를 부여해 멱등 게이트를 saga와 일치시키는 방식.
- user 자가취소가 동일 `fullCancelKey`를 이미 쓴 경우 `@unique` P2002 충돌 위험. 북극성(refundedAmount 정합)에는 불필요. active-job 게이트가 이미 이중 enqueue를 막으므로 보류.

## Notes

- TDD red→green으로 구현. 회귀 가드 `src/entities/payment/api/__tests__/cascadeRefundLedgerSymmetry.test.ts`가 "reserve 없는 release = 음수"를 명시적으로 박제하고, reserve(전액)→release(전액)=0(음수 아님) 대칭을 고정한다.
- 핵심 직관: **reserve=차변 / release=대변, 둘은 반드시 짝을 이뤄야 한다** — 한쪽만 있으면 장부(refundedAmount)가 음수로 내려간다.
- 검증: typecheck 0 / lint 0 errors / vitest 1303 green (merge `d61d8de` 기준).
- 연계: [ADR-0003](./0003-refund-saga-3-phase.md)(refund saga 3-phase 격리 — 미러 대상), [ADR-0036](./0036-ledger-multiple-partial-refunds.md)(refundedAmount 물질화 카운터 + 조건부 차감 — 이 불변식의 원천).
