---
name: booking-transaction-safety
description: 예약·결제 모듈의 동시성 제어, 트랜잭션 무결성, 멱등성, 상태머신을 강제하는 스킬. Phase 2 booking/payment 도메인 코드 작성·리뷰 시 항상 적용한다.
---

# Booking Transaction Safety

## Objective
Nextour Phase 2 예약·결제 플로우는 **돈과 좌석**을 다룬다. 다음 4가지 위험을 코드 레벨에서 차단한다:

1. **Race condition** — 두 사용자가 마지막 좌석을 동시 예약 → 오버부킹
2. **Partial failure** — 결제 성공·예약 실패(또는 반대) → 정합성 파괴
3. **Webhook 재전송** — PG사가 같은 이벤트를 여러 번 발송 → 중복 처리
4. **잘못된 상태 전이** — `CANCELED → CONFIRMED` 같은 비논리적 전이

## Rules

### R1. 좌석 차감은 원자적으로
좌석 점유는 반드시 **단일 트랜잭션 + 조건부 update**. 읽고-쓰는 두 단계로 나누면 race condition 발생.

```ts
// ✅ compare-and-set
const result = await db.departure.updateMany({
  where: {
    id: departureId,
    capacity: { gt: db.departure.fields.bookedSeats },
    status: { in: ["SCHEDULED", "CONFIRMED"] },
  },
  data: { bookedSeats: { increment: requestedSeats } },
});
if (result.count === 0) throw new InsufficientCapacityError();
```

```ts
// ❌ TOCTOU 안티패턴
const dep = await db.departure.findUnique({ where: { id } });
if (dep.capacity - dep.bookedSeats >= requested) {
  await db.departure.update({ where: { id }, data: { bookedSeats: { increment: requested } } });
}
```

### R2. 예약·결제는 트랜잭션 또는 Saga로
- DB 내 완결 작업은 `db.$transaction([...])` 또는 `db.$transaction(async tx => {...})`.
- 외부 PG 호출 포함 시 **2-phase 패턴**: ① DB에 `PENDING_PAYMENT` + 좌석 hold → ② PG 호출 → ③ 성공 시 `CONFIRMED`, 실패 시 좌석 복구 + `FAILED`.
- 가예약(hold)에는 **TTL**(예: 10분). 만료된 hold는 배치 잡으로 좌석 환원.

### R3. 결제 웹훅은 멱등하게
모든 PG 웹훅은 `providerEventId`(PG 고유 ID)를 멱등성 키로 사용. 동일 ID 재호출 시 no-op.

```ts
await db.$transaction(async (tx) => {
  const existing = await tx.paymentEvent.findUnique({ where: { providerEventId } });
  if (existing) return existing.result; // 이미 처리됨

  // ... 실제 결제 반영 ...

  await tx.paymentEvent.create({
    data: { providerEventId, result: "PROCESSED" },
  });
});
```

### R4. 상태 전이는 명시적으로
booking 상태 전이는 화이트리스트 기반. 이외 전이는 거부.

```ts
const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING_PAYMENT: ["CONFIRMED", "PAYMENT_FAILED", "EXPIRED"],
  CONFIRMED:       ["CANCELED", "COMPLETED"],
  CANCELED:        [],  // terminal
  COMPLETED:       [],  // terminal
  PAYMENT_FAILED:  ["PENDING_PAYMENT"],
  EXPIRED:         [],  // terminal
};

function assertTransition(from: BookingStatus, to: BookingStatus) {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}
```

### R5. 돈은 정수(원 단위) 또는 Decimal
- 가격은 **원 단위 정수** 또는 Prisma `Decimal`. **float 금지**.
- 통화가 혼재하면 `currency: "KRW"` 컬럼 명시.
- 합계·할인 계산은 raw 정수로, 표시용 포맷팅은 마지막에.

### R6. 보상 트랜잭션
- 환불은 결제 취소와 좌석 환원이 한 묶음. 둘 중 하나만 성공 불가.
- PG 환불 실패 시 booking은 `CANCELLATION_PENDING` 유지 → 재시도 큐.

### R7. 관측 가능성
- 모든 상태 전이는 `BookingEvent` 테이블에 append-only로 기록(`bookingId, fromStatus, toStatus, actor, payload, createdAt`).
- 결제 실패·오버부킹 시도·만료된 hold는 구조화 로그(WARN/ERROR)로 기록.

## Anti-patterns

| 패턴 | 위험 | 해결 |
|------|------|------|
| `findUnique` → 메모리 검사 → `update` | TOCTOU race | `updateMany` with WHERE 조건부 |
| `await pg.charge()` 후 `db.booking.create()` 비-트랜잭션 | 결제 성공·DB 실패 시 유령 결제 | hold + 2-phase + 보상 |
| 웹훅 핸들러가 `bookingId`만 사용 | 중복 발송 시 이중 차감 | `providerEventId` 멱등 키 |
| `booking.status = newStatus` 직접 할당 | 잘못된 전이 허용 | `assertTransition` 통과 후 update |
| `priceTotal: number`(JS float) | 부동소수 오차 | 정수(원) 또는 `Decimal` |
| 좌석 hold에 TTL 없음 | 결제 중단 시 영구 점유 | 만료 컬럼 + 배치 환원 |
| 환불에 보상 로직 없음 | PG 환불 실패 시 좌석 미환원 | `CANCELLATION_PENDING` + 재시도 |

## Action (Output Format)

```
## Booking Safety Review

### [Critical] R1 - 좌석 차감 race condition
- file: src/features/checkout/api/reserveSeats.ts:34
- problem: findUnique → 비교 → update 패턴 (TOCTOU)
- impact: 동시 예약 시 오버부킹 가능
- fix: db.departure.updateMany({ where: { id, capacity: { gt: ... } }, data: { bookedSeats: { increment } } }) 후 result.count === 0 검사

### [Critical] R3 - 웹훅 멱등성 누락
- file: src/app/api/payment/webhook/route.ts:18
- problem: 같은 providerEventId 재호출 시 이중 처리
- fix: paymentEvent.findUnique({ providerEventId }) 사전 검사

### [Major] R4 - 상태 전이 검증 누락
- file: src/features/booking/api/cancel.ts:21
- problem: status를 직접 "CANCELED"로 set, COMPLETED → CANCELED도 허용
- fix: assertTransition(booking.status, "CANCELED") 호출 후 update
```

위반 없으면 `✅ Booking Safety 통과`.

## 부록: 추천 도메인 모델

```prisma
model Booking {
  id              String         @id @default(cuid())
  userId          String
  departureId     String
  seats           Int
  totalPrice      Int            // 원 단위 정수
  currency        String         @default("KRW")
  status          BookingStatus
  holdExpiresAt   DateTime?      // PENDING_PAYMENT일 때만 의미
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
  events          BookingEvent[]
  payments        Payment[]
}

model BookingEvent {
  id         String         @id @default(cuid())
  bookingId  String
  booking    Booking        @relation(fields: [bookingId], references: [id])
  fromStatus BookingStatus?
  toStatus   BookingStatus
  actor      String         // "user:123" | "system" | "webhook:stripe"
  payload    Json?
  createdAt  DateTime       @default(now())
  @@index([bookingId, createdAt])
}

model PaymentEvent {
  id               String   @id @default(cuid())
  providerEventId  String   @unique  // 멱등 키
  bookingId        String
  type             String   // "charge.succeeded" | "charge.failed" | "refund.created"
  payload          Json
  result           String
  createdAt        DateTime @default(now())
}
```
