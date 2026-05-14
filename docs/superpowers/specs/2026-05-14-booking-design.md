# 예약 모듈 설계 (M-BOOKING)

> **버전**: v1.0
> **작성일**: 2026-05-14
> **상위 문서**: [Phase 2 Roadmap](./2026-05-13-phase2-roadmap.md)
> **마일스톤**: M2 (Phase 2 — 예약/결제/체크아웃 묶음 중 첫 모듈)
> **선행 모듈**: M-AUTH (사용자 컨텍스트 필요)
> **적용 스킬**: `booking-transaction-safety` ⭐, `enforce-fsd`, `clean-code-react`

## 0. 범위 및 비범위

### 범위 (이 spec)
- `entities/booking` slice 신설 — 도메인 모델, 상태머신, 쿼리, 뮤테이션, 좌석 lock
- **8단계 상태머신**(`RECEIVED → AWAITING_GROUP → DEPARTURE_CONFIRMED → PAID → READY → COMPLETED` + `CANCELED_BY_USER`, `CANCELED_BY_AGENCY`) — schema 기반
- **`assertTransition` 화이트리스트** + 위반 시 `InvalidTransitionError` throw
- **원자적 좌석 차감/환원** — `db.departure.updateMany` compare-and-set 패턴 (booking-transaction-safety R1)
- **booking 생성 트랜잭션** — 좌석 차감 + Booking insert + Traveler insert + BookingEvent 1건을 단일 `$transaction`으로 묶음 (R2)
- **자가 취소(RECEIVED 단계만)** — 상태 전이 + 좌석 환원 + BookingEvent를 단일 트랜잭션 (R6)
- **`BookingEvent` append-only 기록** — 모든 상태 전이에 actor/reason 포함 (R7)
- 가격은 **정수(원 단위)** 유지, 서버 측 재계산으로 클라이언트 입력값 검증 (R5)
- RSC용 헬퍼 — `getBookingById`, `listMyBookings`, `getBookingDetail`
- Booking 조회는 **본인 booking만** 접근 가능 (admin 제외)

### 비범위 (별도 작업)
- **토스페이먼츠 SDK 연동**(결제창, 승인 API, 웹훅) — **M-PAYMENT spec**
- **체크아웃 UX**(`/products/[id]/checkout`, `/bookings/[id]` 페이지) — **M-CHECKOUT spec**
- **모객 자동 전환 cron** — `RECEIVED → AWAITING_GROUP` / `AWAITING_GROUP → DEPARTURE_CONFIRMED` / `AWAITING_GROUP → CANCELED_BY_AGENCY` 일괄 처리 — M-OBS/admin spec
- **결제 만료 자동 취소 cron** — admin spec
- **어드민 booking 관리 UI** — admin spec
- **E-ticket 발급(PAID → READY)** — operations spec (외부 항공권 시스템 연동)
- **부분 환불·다중 통화**(KRW 단일)
- **Booking 변경**(인원·날짜) — Phase 3

## 1. 도메인 모델 인벤토리

### 이미 존재 (prisma/schema.prisma)
| 모델 | 핵심 컬럼 | 비고 |
|------|----------|------|
| `Booking` | `userId`, `departureId`, `adultCount/childCount/infantCount`, `totalPrice`, `status`, `notes`, `canceledAt/cancelReason` | status 기본값 `RECEIVED` |
| `Traveler` | `bookingId`, `role(BOOKER/TRAVELER)`, `lastNameEn/firstNameEn`, `gender`, `birthDate`, `passportNo?` | Booking onDelete Cascade |
| `BookingTerms` | `bookingId`, `termKey`, `termVersion`, `agreedAt` | `@@unique([bookingId, termKey])` |
| `BookingEvent` | `bookingId`, `fromState?`, `toState`, `actor`, `reason?`, `createdAt` | append-only |
| `Payment` | `bookingId`, `method`, `amount`, `status`, `tossOrderId @unique`, `tossPaymentKey?` | 본 spec에서는 모델만 인지, 호출은 M-PAYMENT |
| `Departure` | `capacity`, `bookedSeats`, `version`, `status` | bookedSeats는 비관적 락, version은 낙관적 락 보조 |

### 변경 사항
**없음** — schema가 이미 충분히 정교화되어 있어 본 spec에서는 컬럼 추가 없음. 비즈니스 흐름을 코드로 구현하는 단계.

> **결제 마감 시각**: schema에 `paymentDueAt` 같은 컬럼이 없으나 본 spec MVP에서는 cron 기반 자동 취소를 다루지 않으므로 영향 없음. 후속 admin spec에서 필요 시 마이그레이션으로 추가.

## 2. 상태머신

### 2.1 허용 전이 매트릭스

```ts
const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  RECEIVED: [
    "AWAITING_GROUP",       // 모객 마감일 도래, 인원 미달
    "DEPARTURE_CONFIRMED",  // 인원 달성, 결제 요청
    "CANCELED_BY_USER",     // 사용자 자가 취소 (결제 전이라 자유 취소)
    "CANCELED_BY_AGENCY",   // 어드민 취소
  ],
  AWAITING_GROUP: [
    "DEPARTURE_CONFIRMED",  // 인원 달성
    "CANCELED_BY_USER",
    "CANCELED_BY_AGENCY",   // 모객 실패 자동 취소
  ],
  DEPARTURE_CONFIRMED: [
    "PAID",                 // 결제 완료
    "CANCELED_BY_USER",     // 결제 거부
    "CANCELED_BY_AGENCY",   // 결제 만료
  ],
  PAID: [
    "READY",                // E-ticket 발급
    "CANCELED_BY_USER",     // 결제 후 환불 요청
    "CANCELED_BY_AGENCY",   // 출발 취소
  ],
  READY: [
    "COMPLETED",            // 여행 완료
    "CANCELED_BY_USER",     // 출발 직전 취소 (위약금 적용)
    "CANCELED_BY_AGENCY",
  ],
  COMPLETED: [],            // terminal
  CANCELED_BY_USER: [],     // terminal
  CANCELED_BY_AGENCY: [],   // terminal
};
```

### 2.2 좌석 환원 정책 (취소 상태별)
좌석을 환원해야 하는 상태로의 전이만 해당.

| from → to | 좌석 환원 여부 | 비고 |
|-----------|--------------|------|
| `RECEIVED → CANCELED_*` | ✅ 즉시 환원 | 결제 전, 자유 환원 |
| `AWAITING_GROUP → CANCELED_*` | ✅ 즉시 환원 | 결제 전 |
| `DEPARTURE_CONFIRMED → CANCELED_*` | ✅ 즉시 환원 | 결제 거부/만료 |
| `PAID → CANCELED_BY_USER` | ✅ 환원 + 환불 트리거 | 위약금은 M-PAYMENT 환불 로직에서 처리 |
| `PAID → CANCELED_BY_AGENCY` | ✅ 환원 + 전액 환불 |  |
| `READY → CANCELED_*` | ✅ 환원 + 환불 |  |
| 그 외 정방향(`* → PAID/READY/COMPLETED`) | ❌ 환원 없음 | 좌석은 booking 생성 시 차감 |

### 2.3 `assertTransition` 헬퍼

```ts
// entities/booking/model/transitions.ts
export class InvalidTransitionError extends Error {
  constructor(from: BookingStatus, to: BookingStatus) {
    super(`Invalid booking transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(
  from: BookingStatus,
  to: BookingStatus,
): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function shouldReturnSeats(
  from: BookingStatus,
  to: BookingStatus,
): boolean {
  const cancelStates: BookingStatus[] = [
    "CANCELED_BY_USER",
    "CANCELED_BY_AGENCY",
  ];
  const seatHeldStates: BookingStatus[] = [
    "RECEIVED",
    "AWAITING_GROUP",
    "DEPARTURE_CONFIRMED",
    "PAID",
    "READY",
  ];
  return seatHeldStates.includes(from) && cancelStates.includes(to);
}
```

순수 함수 → TDD 단위 테스트 대상.

## 3. 좌석 lock 패턴

### 3.1 차감 (booking 생성 시)

```ts
// entities/booking/api/seatLock.ts
export class InsufficientCapacityError extends Error {
  constructor(public readonly departureId: string) {
    super(`Departure ${departureId} has insufficient capacity`);
    this.name = "InsufficientCapacityError";
  }
}

export async function reserveSeats(
  tx: Prisma.TransactionClient,
  departureId: string,
  totalSeats: number,
): Promise<void> {
  const result = await tx.departure.updateMany({
    where: {
      id: departureId,
      status: { in: ["SCHEDULED", "CONFIRMED"] },
      capacity: { gte: { increment: totalSeats } }, // raw SQL로 표현
    },
    data: {
      bookedSeats: { increment: totalSeats },
      version: { increment: 1 },
    },
  });
  if (result.count === 0) {
    throw new InsufficientCapacityError(departureId);
  }
}
```

> **주의**: Prisma는 `where`에 `capacity >= bookedSeats + n` 같은 raw 비교를 직접 지원하지 않으므로 실제 구현은 **`db.$queryRaw`** 또는 **`tx.$executeRaw`**로 다음 SQL을 발행한다:
>
> ```sql
> UPDATE "Departure"
> SET "bookedSeats" = "bookedSeats" + ${totalSeats},
>     "version" = "version" + 1,
>     "updatedAt" = NOW()
> WHERE id = ${departureId}
>   AND status IN ('SCHEDULED', 'CONFIRMED')
>   AND capacity >= "bookedSeats" + ${totalSeats}
> ```
> 영향받은 row 수가 0이면 `InsufficientCapacityError`.

### 3.2 환원 (취소 시)

```ts
export async function releaseSeats(
  tx: Prisma.TransactionClient,
  departureId: string,
  totalSeats: number,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "Departure"
    SET "bookedSeats" = GREATEST("bookedSeats" - ${totalSeats}, 0),
        "version" = "version" + 1,
        "updatedAt" = NOW()
    WHERE id = ${departureId}
  `;
}
```

`GREATEST(... , 0)`로 음수 방지. 환원은 booking이 이미 생성된 상태에서 실행되므로 조건 검사 없이 진행.

## 4. 핵심 트랜잭션 패턴

### 4.1 createBooking

```ts
async function createBooking(input: CreateBookingInput): Promise<Booking> {
  // 0. 입력 검증 (zod)
  const data = CreateBookingSchema.parse(input);

  // 1. 가격 서버 재계산 (R5 - 클라이언트 totalPrice 신뢰 금지)
  const departure = await db.departure.findUniqueOrThrow({
    where: { id: data.departureId },
  });
  const totalPrice =
    departure.priceAdult * data.adultCount +
    departure.priceChild * data.childCount +
    departure.priceInfant * data.infantCount;
  if (totalPrice !== data.expectedTotalPrice) {
    throw new PriceMismatchError(totalPrice, data.expectedTotalPrice);
  }

  // 2. 좌석 차감 + booking + traveler + event를 단일 트랜잭션
  const totalSeats = data.adultCount + data.childCount;  // infant는 좌석 차지 안함
  return db.$transaction(async (tx) => {
    await reserveSeats(tx, data.departureId, totalSeats);
    const booking = await tx.booking.create({
      data: {
        userId: data.userId,
        departureId: data.departureId,
        adultCount: data.adultCount,
        childCount: data.childCount,
        infantCount: data.infantCount,
        totalPrice,
        status: "RECEIVED",
        notes: data.notes,
        travelers: { create: data.travelers },
      },
    });
    await tx.bookingEvent.create({
      data: {
        bookingId: booking.id,
        fromState: null,
        toState: "RECEIVED",
        actor: `user:${data.userId}`,
        reason: "booking created",
      },
    });
    return booking;
  });
}
```

### 4.2 transitionStatus (범용)

```ts
async function transitionStatus(input: {
  bookingId: string;
  to: BookingStatus;
  actor: string;
  reason?: string;
}): Promise<Booking> {
  return db.$transaction(async (tx) => {
    const current = await tx.booking.findUniqueOrThrow({
      where: { id: input.bookingId },
    });
    assertTransition(current.status, input.to);

    const seatReturn = shouldReturnSeats(current.status, input.to);
    if (seatReturn) {
      const totalSeats = current.adultCount + current.childCount;
      await releaseSeats(tx, current.departureId, totalSeats);
    }

    const updated = await tx.booking.update({
      where: { id: input.bookingId },
      data: {
        status: input.to,
        canceledAt: input.to.startsWith("CANCELED") ? new Date() : undefined,
        cancelReason: input.to.startsWith("CANCELED") ? input.reason : undefined,
      },
    });

    await tx.bookingEvent.create({
      data: {
        bookingId: input.bookingId,
        fromState: current.status,
        toState: input.to,
        actor: input.actor,
        reason: input.reason,
      },
    });

    return updated;
  });
}
```

이 함수가 모든 상태 전이의 **단일 진입점**. 외부 호출자는 항상 이 함수를 통해서만 status를 바꾸어 `assertTransition` + 좌석 환원 + 이벤트 기록을 보장.

### 4.3 cancelBookingByUser (편의 함수)

```ts
async function cancelBookingByUser(input: {
  bookingId: string;
  userId: string;       // 본인 확인용
  reason?: string;
}): Promise<Booking> {
  const booking = await db.booking.findUniqueOrThrow({
    where: { id: input.bookingId },
  });
  if (booking.userId !== input.userId) {
    throw new ForbiddenError();
  }
  return transitionStatus({
    bookingId: input.bookingId,
    to: "CANCELED_BY_USER",
    actor: `user:${input.userId}`,
    reason: input.reason ?? "user requested cancellation",
  });
}
```

## 5. FSD 매핑

### 5.1 entities/booking 구조 (신규)

```
src/entities/booking/
├── model/
│   ├── types.ts           ← SafeBooking, BookingDetail, ...
│   ├── constants.ts       ← BOOKING_STATUS_LABEL, CANCEL_REASON_PRESETS
│   ├── transitions.ts     ← ALLOWED_TRANSITIONS, assertTransition, shouldReturnSeats, InvalidTransitionError
│   └── schemas.ts         ← Zod: CreateBookingSchema, TravelerSchema
├── api/
│   ├── queries.ts         ← getBookingById, listMyBookings, getBookingDetail
│   ├── mutations.ts       ← createBooking, transitionStatus, cancelBookingByUser
│   ├── seatLock.ts        ← reserveSeats, releaseSeats, InsufficientCapacityError
│   ├── pricing.ts         ← computeTotalPrice (순수 함수)
│   ├── errors.ts          ← ForbiddenError, PriceMismatchError
│   └── __tests__/
│       ├── transitions.test.ts    ← 화이트리스트 케이스 + 거부 케이스
│       ├── shouldReturnSeats.test.ts
│       ├── pricing.test.ts
│       └── schemas.test.ts
└── index.ts               ← barrel
```

### 5.2 의존성 방향 (enforce-fsd R1 준수)
- `entities/booking` → `entities/departure` 직접 import 금지. departure 정보는 Prisma include로 가져옴 (cross-entity 호출 X)
- `features/checkout` → `entities/booking` 호출 (다음 spec 범위)
- `app/(site)/bookings/*` → `features/checkout` 또는 `entities/booking` 호출 (다음 spec)

### 5.3 barrel export
```ts
// entities/booking/index.ts
export type { BookingStatus, TravelerRole, PaymentStatus, PaymentMethod } from "@prisma/client";
export type { SafeBooking, BookingDetail, BookingListItem } from "./model/types";
export { BOOKING_STATUS_LABEL } from "./model/constants";
export {
  ALLOWED_TRANSITIONS,
  assertTransition,
  shouldReturnSeats,
  InvalidTransitionError,
} from "./model/transitions";
export {
  CreateBookingSchema,
  TravelerSchema,
} from "./model/schemas";
export type {
  CreateBookingInput,
  TravelerInput,
} from "./model/schemas";
export {
  createBooking,
  transitionStatus,
  cancelBookingByUser,
} from "./api/mutations";
export {
  getBookingById,
  listMyBookings,
  getBookingDetail,
} from "./api/queries";
export {
  InsufficientCapacityError,
  reserveSeats,    // 내부지만 M-PAYMENT가 직접 호출 가능하도록
  releaseSeats,
} from "./api/seatLock";
export {
  ForbiddenError,
  PriceMismatchError,
} from "./api/errors";
```

## 6. Payment 인터페이스 (본 spec에서는 hand-off만)

본 spec은 booking 도메인 코어만 다룬다. M-PAYMENT가 호출할 hand-off 지점은 다음 함수들:

```ts
// M-PAYMENT가 booking을 결제 후 PAID로 전환할 때
await transitionStatus({
  bookingId,
  to: "PAID",
  actor: `system:webhook:toss`,
  reason: `tossPaymentKey=${paymentKey}`,
});

// 환불 시
await transitionStatus({
  bookingId,
  to: "CANCELED_BY_USER",   // 또는 CANCELED_BY_AGENCY
  actor: `user:${userId}`,
  reason: "refund requested",
});
// transitionStatus가 좌석 환원까지 함께 처리
```

M-PAYMENT spec에서 토스 SDK / 웹훅 멱등성 / 환불 보상 트랜잭션을 다룬다.

## 7. 보안·검증

### 7.1 본인 booking만 조회
- `getBookingById(id, userId)` 시 `WHERE id = ? AND userId = ?` 강제
- admin role은 별도 함수(`getBookingByIdAsAdmin`)로 분리 — admin spec에서 구현

### 7.2 입력 검증 (zod)
- 인원 수: `adultCount >= 1`, `infantCount <= adultCount` (영아는 보호자 수 이하)
- `expectedTotalPrice`: 클라이언트가 보낸 가격을 서버가 재계산하여 일치 검증 (변조 방지)
- traveler 정보: 여권번호 형식, 생년월일 과거 검사 (zod refinements)

### 7.3 동시성 방어
- 좌석 차감은 R1 패턴(원자적 `UPDATE ... WHERE capacity >= bookedSeats + n`)으로 강제
- 단순 `findUnique` → 검증 → `update` 패턴 **절대 금지** (`booking-transaction-safety` 스킬 R1)
- Departure `version` 컬럼은 추후 낙관적 락 도입 시 활용 — 본 spec에서는 활용 안 함 (compare-and-set으로 충분)

### 7.4 가격 정수
- 모든 금액은 `Int` (원 단위). `totalPrice`, `priceAdult/Child/Infant`, `amount`(Payment)
- JS float 연산 금지 (R5)

## 8. 테스트 전략

| 대상 | 종류 | 위치 |
|------|------|------|
| `assertTransition` 화이트리스트/거부 | 단위 (TDD) | `entities/booking/api/__tests__/transitions.test.ts` |
| `shouldReturnSeats` | 단위 (TDD) | 동일 파일 |
| `computeTotalPrice` | 단위 (TDD) | `entities/booking/api/__tests__/pricing.test.ts` |
| `CreateBookingSchema` 검증 | 단위 (TDD) | `entities/booking/api/__tests__/schemas.test.ts` |
| `reserveSeats` 동시성 | 통합 (DB) | 별도 integration test — Phase 2 후반 정비 |
| `createBooking` 트랜잭션 | 통합 (DB) | 별도 integration test |
| `transitionStatus` end-to-end | 통합 (DB) | 별도 integration test |

**MVP 자동화 범위는 순수 함수 단위 테스트**. DB 통합 테스트는 별도 vitest 환경(테스트 DB)이 필요하며 본 spec의 후속 plan에서 다루지 않음 (Phase 2 후반 또는 별도 PR).

## 9. 환경 변수
변경 없음. M-AUTH에서 정의된 DB·세션 관련 env로 충분.

## 10. 미결정 / 가정

- **infant 좌석 정책**: schema의 `Departure.bookedSeats`는 좌석 수 카운트. infant는 일반적으로 무릎석이라 좌석 안 차지. **가정**: `totalSeats = adultCount + childCount` (infant 제외). 다른 정책이면 spec 보강.
- **booking 1개 = departure 1개**: 한 booking에서 여러 출발일을 묶지 않음.
- **booking 변경 흐름**: 인원/날짜 변경은 MVP 비범위. 변경 필요 시 취소 + 재예약.
- **위약금 산정**: PAID/READY 상태에서 사용자 취소 시 위약금 계산은 본 spec 비범위. M-PAYMENT 환불 로직에서 처리.
- **booking 1건 최대 인원**: 제한 없음 (admin이 별도로 관리). zod 검증에서 `adultCount + childCount + infantCount <= 9` 정도의 sanity check 추가 권장.

## 11. 후속 plan 구성 (예상)

`plans/2026-05-14-booking.md`로 약 **14~16개 태스크**:

1. `entities/booking/model/types.ts` — `SafeBooking`, `BookingDetail`, `BookingListItem`
2. `entities/booking/model/constants.ts` — `BOOKING_STATUS_LABEL`
3. **`transitions.ts` + 테스트 (TDD)** — `ALLOWED_TRANSITIONS`, `assertTransition`, `shouldReturnSeats`, `InvalidTransitionError`
4. **`pricing.ts` + 테스트 (TDD)** — `computeTotalPrice`
5. **`schemas.ts` + 테스트 (TDD)** — `CreateBookingSchema`, `TravelerSchema` (인원 제약, infant ≤ adult, 여권번호 형식)
6. `errors.ts` — `ForbiddenError`, `PriceMismatchError`
7. `seatLock.ts` — `reserveSeats` (raw SQL), `releaseSeats`, `InsufficientCapacityError`
8. `queries.ts` — `getBookingById(id, userId)`, `listMyBookings(userId)`, `getBookingDetail(id, userId)` (include traveler/payments/events)
9. `mutations.ts` — `createBooking`, `transitionStatus`, `cancelBookingByUser`
10. `entities/booking/index.ts` — barrel export
11. `npm run typecheck` + `npm run test` 통과
12. (선택) booking 시드 1~2건 — 검증용
13. spec의 §7 보안 항목 자가 점검
14. 수동 검증 체크리스트(시드 booking 생성 → 좌석 차감 확인 → 자가 취소 → 좌석 환원 확인)

## 12. booking-transaction-safety 스킬 적용 체크리스트

| 규칙 | 본 spec 적용 |
|------|------------|
| R1 좌석 원자적 차감 | §3.1 `reserveSeats` raw SQL compare-and-set |
| R2 트랜잭션/Saga | §4.1 `createBooking`이 단일 `$transaction` |
| R3 결제 멱등성 | M-PAYMENT spec — 본 spec은 hand-off만 |
| R4 상태 전이 화이트리스트 | §2.1 `ALLOWED_TRANSITIONS` + `assertTransition` |
| R5 금액 정수 | `Int` 컬럼 일관 사용, `computeTotalPrice` 순수 함수 |
| R6 보상 트랜잭션 | §4.2 `transitionStatus`가 취소 전이 시 자동 좌석 환원 |
| R7 관측 가능성 | 모든 전이에 `BookingEvent` append-only 기록 |
