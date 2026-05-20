# ADR-0003: Refund Saga 3-Phase 격리 — 외부 IO를 DB 트랜잭션 바깥으로

- **상태**: Accepted
- **결정일**: 2026-05-14 (Phase 2 payment 모듈 설계 시)
- **영향 범위**: `src/entities/payment/api/refund.ts`
- **관련 commit**: M-PAYMENT 모듈 (기존), Phase 3에서 booking-cancel과 연결됨 (`9b05cd7`)
- **관련 spec**: `../specs/2026-05-14-payment-design.md`

> 이 결정은 phase 2에 이미 구현돼 있었으나, phase 3에서 booking-cancel과 연결되며 다시 검증됐다. ADR로 박제하는 이유: phase 3 이후로도 이 invariant를 깨려는 PR이 들어올 위험을 영구 방어하기 위함.

## Context (배경)

환불은 본질적으로 두 시스템(우리 DB + Toss PG)에 걸친 분산 트랜잭션이다. 단순 구현은:

```ts
await db.$transaction(async (tx) => {
  await tx.payment.update({ where: {...}, data: { status: "CANCELED" } });
  await tossClient.cancel({ paymentKey, cancelAmount });  // 외부 HTTP 호출
  await tx.booking.update({ ... });
});
```

이 구조는 두 가지 시한폭탄을 안고 있다:

1. **DB row lock이 외부 HTTP 응답시간 동안 잡힌다** — Toss가 느려지면 같은 Payment row를 보는 다른 트랜잭션이 줄줄이 차단됨. 100rps 트래픽에서 30초 timeout 한 번이면 connection pool 고갈.

2. **partial failure의 상태 분기** — Toss가 cancel을 성공시켰는데 우리 측 commit이 실패하면, **Toss에선 환불이 일어났지만 DB에선 PAID로 남는 진정한 데이터 분기**가 발생한다. 환불은 멱등성 키로 재시도해도 같은 결과 → 사용자는 돈을 받았는데 우리 시스템은 모름.

## Decision (결정)

3-phase saga로 분해. **외부 IO는 DB 트랜잭션 바깥에서만**:

```ts
// Phase 1 (DB Tx) — RefundJob을 IN_PROGRESS로 enqueue (중복 검사 + 멱등성 게이트)
const refundJob = await db.$transaction(async (tx) => {
  const existing = await tx.refundJob.findFirst({
    where: { bookingId, status: { in: ["PENDING", "IN_PROGRESS", "SUCCEEDED"] } },
  });
  if (existing) throw new PaymentError("REFUND_ALREADY_REQUESTED");
  return tx.refundJob.create({ data: { ..., status: "IN_PROGRESS" } });
});

// Phase 2 (외부 IO, Tx 바깥) — Toss cancel API 호출
try {
  await tossClient.cancel({ paymentKey, cancelAmount });
} catch (cancelErr) {
  // PG 실패 → RefundJob PENDING + 지수 백오프 → cron worker 자가 치유
  await db.refundJob.update({
    where: { id: refundJob.id },
    data: { status: "PENDING", attempts: { increment: 1 }, nextRunAt: backoff(...), lastError: ... },
  });
  throw new PaymentError("REFUND_DEFERRED");
}

// Phase 3 (DB Tx) — Payment CANCELED + RefundJob SUCCEEDED + PaymentEvent
await db.$transaction(async (tx) => {
  await tx.payment.update({ where: {...}, data: { status: "CANCELED", canceledAt: now } });
  await tx.refundJob.update({ where: {...}, data: { status: "SUCCEEDED" } });
  await tx.paymentEvent.create({ data: { providerEventId: `refund:${paymentId}:${ts}`, ... } });
});
```

추가로 `Idempotency-Key: cancel:${paymentKey}` HTTP 헤더 + RefundJob 멱등성 게이트 + PaymentEvent providerEventId 3중 멱등성.

## Consequences (결과)

**얻은 것:**
- DB lock 윈도우가 마이크로초 단위 (Phase 1·3) — 외부 HTTP가 느려도 다른 트랜잭션 영향 0
- PG 실패는 RefundJob PENDING으로 적재 → cron worker가 backoff로 재시도. **booking 상태는 PAID 그대로 유지** → 사용자 의도와 DB 상태가 영원히 어긋나지 않음
- 3중 멱등성으로 이중 환불 수학적으로 불가능

**포기한 것 / 미해결:**
- 순간 partial commit 가능성: Phase 2 성공 후 Phase 3 실패 시 — Toss는 환불됐지만 DB는 PAID. 매우 짧은 윈도우지만 0은 아님. 보완책으로 PaymentEvent를 reconciler가 nightly로 cross-check (별도 모듈, 미구현).
- cron worker(RefundJob retry) 실 구현은 별 PR — 현재는 manual reconcile script(`scripts/qa/refund_reconcile.ts`)로 dev 환경 대응 (ADR-0010 후보)

## Alternatives Considered

### 옵션 A: 단일 트랜잭션 + 외부 호출 포함
- **거부 이유**: DB row lock이 외부 HTTP 응답시간만큼 잡힘. 100rps에서 30s timeout 한 번이면 connection pool 마비. partial failure도 처리 불가.

### 옵션 B: 외부 호출을 먼저, 성공 시 DB 업데이트
- **거부 이유**: Toss에서 환불 성공했는데 우리 측 DB가 down/crash → "이미 환불됐지만 우리는 모름" 상태가 영구. 재시도해도 Toss 멱등성으로 같은 결과 반환. 진정한 데이터 분기.

### 옵션 C: Outbox 패턴 (DB에 outbox 레코드 commit → 별도 worker가 PG 호출)
- 분산 시스템 표준 패턴, 강한 일관성
- **거부 이유**: 동기 응답(사용자가 "취소 완료" 메시지를 즉시 받아야 함) UX와 충돌. 현재 saga는 동기 happy path + 비동기 retry queue로 양쪽 모두 챙김. 트래픽이 더 커지면 옵션 C로 evolve 고려.

## Notes

- 이 패턴은 NextAuth Resend 매직링크·결제 confirm 등 모든 외부 IO 도메인에 같은 원칙 적용 — Tx 안에 fetch/axios/외부 SDK 호출 금지
- CLAUDE.md §5 Domain Booking 절대 규칙으로 명문화돼 있음: `❌ 단일 DB 트랜잭션에 외부 PG 호출 포함`
- 후속 ADR 후보: cron worker(retry 자동화) 도입 시 ADR-0011
