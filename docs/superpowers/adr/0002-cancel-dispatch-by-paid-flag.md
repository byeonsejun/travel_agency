# ADR-0002: Booking cancel action dispatch — PAID payment 유무로 refund/cancel 분기

- **상태**: Accepted
- **결정일**: 2026-05-20
- **영향 범위**: `src/features/booking-cancel/server/actions.ts`, `src/entities/booking`, `src/entities/payment`
- **관련 commit**: `9b05cd7`

## Context (배경)

기존 `cancelBookingByUser`(entities/booking)는 booking 상태머신 전이만 수행 — Payment 레코드에는 손대지 않았다. 그 결과 사용자가 결제 완료(PAID) 상태에서 취소 버튼을 눌러도 booking은 `CANCELED_BY_USER`로 전이되지만 **Payment는 여전히 PAID 상태로 남는 데이터 정합성 결함**이 발생했다(실제로 한 건 발생, ADR-0010 reconcile로 정리).

한편 entities/payment에는 이미 `refundBooking`이라는 풀 환불 흐름이 구현돼 있었다 — Phase 1/2/3 saga로 PG cancel + Payment CANCELED + booking 전이 + RefundJob 멱등성까지 다룸.

문제는 둘을 **언제 어느 쪽을 호출할지**의 정책이 어디에도 없었다는 것.

## Decision (결정)

`features/booking-cancel/server/actions.ts`에 **dispatch 로직**을 둔다. 소유권 가드와 함께 PAID payment 유무를 단일 round-trip으로 조회 후 분기:

```ts
const owned = await db.booking.findUnique({
  where: { id: bookingId, userId },
  select: {
    id: true,
    departure: { select: { productId: true } },
    payments: { where: { status: "PAID" }, select: { id: true }, take: 1 },
  },
});
if (!owned) return { type: "error", message: "본인의 예약만 취소할 수 있습니다" };

if (owned.payments.length > 0) {
  await refundBooking({ bookingId, actor: `user:${userId}`, reason });   // PG 취소 포함
} else {
  await cancelBookingByUser({ bookingId, userId, reason });              // 단순 전이
}
```

## Consequences (결과)

**얻은 것:**
- PAID booking 취소 = 환불까지 자동 — Payment.status가 CANCELED로 정확히 흐른다
- 결제 전 booking(RECEIVED / DEPARTURE_CONFIRMED) 취소는 PG 호출 0회 — 불필요한 외부 IO 회피
- dispatch 정책이 features 레이어에 명확히 노출 → 향후 admin cancel (CANCELED_BY_AGENCY)도 같은 패턴 재사용 가능
- PaymentError의 4가지 code (REFUND_DEFERRED / REFUND_ALREADY_REQUESTED / BOOKING_NOT_REFUNDABLE / PAID_PAYMENT_NOT_FOUND)를 사용자 친화 메시지로 매핑

**포기한 것 / 미해결:**
- circular dependency 위험 회피를 위해 dispatch를 entities가 아닌 features에 둠 → 같은 dispatch가 다른 진입점(예: admin)에서 재사용되려면 위치 재검토 필요
- 소유권 검증이 features와 entities에서 이중 (`findUnique({where:userId}})` + `cancelBookingByUser` 내부 재검증) — defense in depth로 의도적 허용

## Alternatives Considered

### 옵션 A: `cancelBookingByUser` 내부에 dispatch 추가
- entities/booking이 entities/payment(`refundBooking`)을 호출
- **거부 이유**: payment.refund.ts는 이미 booking.transitionStatus를 호출하므로 booking → payment → booking 의 **순환 의존**이 발생. 모듈 로드 순서·테스트 mocking이 복잡해진다.

### 옵션 B: 새 도메인 함수 `cancelOrRefundForUser`를 entities/payment에 추가
- payment 레이어가 booking 도메인의 cancel을 흡수
- **거부 이유**: dispatch는 "사용자 인터랙션을 도메인에 어떻게 흘려보낼지"의 책임이라 features 레이어가 더 자연스러움. payment에 두면 payment 도메인의 의미가 흐려진다.

### 옵션 C: cancelBookingByUser를 먼저 호출하고 사후에 refund 추가 호출
- 단순 순차 호출
- **거부 이유**: refundBooking은 booking이 PAID/READY 상태일 때만 받아들이도록 사전 검증(`REFUNDABLE_STATUSES`). cancelByUser가 먼저 전이를 일으키면 두 번째 호출의 refundBooking은 `BOOKING_NOT_REFUNDABLE`로 거부 — 순서가 잘못된 구조.

## Notes

- 향후 admin cancel(CANCELED_BY_AGENCY)도 같은 actions.ts 패턴 재사용 — `actor`만 `admin:${adminId}`로 변경
- ownership 가드 1회 + 도메인 함수 내부 재검증 1회 = defense in depth 의도. ownership 누락 회귀를 features 레이어에서 1차 차단.
