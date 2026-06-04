# Multiple Partial Refunds (Phase 8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 하나의 `Payment`에 다회 부분 환불(여행자별 구조적 취소 + 관리자 재량 금액 환불)을 race-free·멱등으로 누적하는 Ledger 시스템 구축.

**Architecture:** `Payment.refundedAmount` 물질화 카운터 + `RefundJob` 원장화 + `Traveler.unitPrice` 스냅샷. 동시성은 좌석과 동일한 `updateMany` 조건부 차감(원자적 CAS). 위약금은 `computePenalty`에 부분 base 주입(순수함수 불변). 부분취소는 booking을 terminal로 보내지 않고, 활성 여행자 0일 때만 terminal.

**Tech Stack:** Next.js 15 App Router, Prisma 5 + PostgreSQL, Zod 3, Vitest 2, TypeScript strict. 마이그레이션은 `db push` + 수동 SQL + `migrate resolve` 3-step 우회(pgvector shadow DB 이슈).

**Spec:** `docs/superpowers/specs/2026-06-04-multiple-partial-refunds-design.md`

---

## File Structure

**Schema:**
- `prisma/schema.prisma` — Payment.refundedAmount, RefundKind enum, RefundJob 4필드, Traveler 4필드, PaxType enum.
- `prisma/migrations/` — 수동 SQL(ALTER) + backfill.
- `prisma/seed.ts` — traveler paxType/unitPrice 반영.
- `scripts/backfill-phase8.ts` — 멱등 backfill 스크립트(신규).

**Pure model (TDD 우선):**
- `src/entities/booking/model/paxAssignment.ts` (신규) — `assignPaxTypes` 그리디+잔차보정.
- `src/entities/payment/model/refundKeys.ts` (신규) — idempotencyKey 생성기.
- `src/entities/payment/model/refundable.ts` (신규) — 잔여액 헬퍼.

**Domain api:**
- `src/entities/payment/api/ledger.ts` (신규) — `reserveRefund`/`releaseRefund` 조건부 차감.
- `src/entities/payment/api/refund.ts` (대수술) — 종류별 사가 분기.
- `src/entities/payment/api/refundRetry.ts` (수정) — 보상/예약해제 반영.
- `src/entities/booking/api/mutations.ts` (수정) — createBooking unitPrice/paxType, transitionStatusTx skipSeatReturn 옵션.
- `src/entities/booking/api/travelerCancel.ts` (신규) — 활성 여행자 도출/표식 헬퍼.

**Features / widgets:**
- `src/features/admin-traveler-cancel/server/actions.ts` (신규)
- `src/features/admin-discretionary-refund/server/actions.ts` (신규)
- `src/widgets/booking-detail/ui/*` (수정) — 여행자 취소 + 재량환불 + 잔여액 표시.

**ADR:**
- `docs/superpowers/adr/0036-ledger-multiple-partial-refunds.md` (신규)

---

## Task 1: Prisma 스키마 — Ledger 컬럼/enum 추가

**Files:**
- Modify: `prisma/schema.prisma` (Payment, RefundJob, Traveler models; new enums)

- [ ] **Step 1: PaxType / RefundKind enum 추가**

`prisma/schema.prisma`에 enum 2개 추가(기존 enum 블록 근처):

```prisma
enum PaxType {
  ADULT
  CHILD
  INFANT
}

enum RefundKind {
  FULL_CANCEL
  TRAVELER_CANCEL
  DISCRETIONARY
}
```

- [ ] **Step 2: Payment.refundedAmount 추가**

`model Payment`에 추가:

```prisma
  refundedAmount Int @default(0) // 예약된 환불 총액. 불변식: 0 ≤ refundedAmount ≤ amount
```

- [ ] **Step 3: RefundJob 4필드 추가**

`model RefundJob`에 추가:

```prisma
  kind           RefundKind @default(FULL_CANCEL)
  baseAmount     Int        @default(0)
  seatsReleased  Int        @default(0)
  idempotencyKey String?    @unique
```

- [ ] **Step 4: Traveler 4필드 추가**

`model Traveler`에 추가:

```prisma
  paxType               PaxType?
  unitPrice             Int       @default(0)
  canceledAt            DateTime?
  canceledByRefundJobId String?
```

- [ ] **Step 5: 스키마 포맷 검증**

Run: `npx prisma format && npx prisma validate`
Expected: `The schema ... is valid 🚀`

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(payment): add Ledger schema for multiple partial refunds"
```

---

## Task 2: 마이그레이션 적용 (db push 우회)

**Files:**
- Create: `prisma/migrations/<timestamp>_phase8_ledger/migration.sql` (수동)

- [ ] **Step 1: DB에 스키마 push**

Run: `npx prisma db push`
Expected: `Your database is now in sync with your Prisma schema.` (신규 컬럼 전부 nullable/default라 데이터 손실 경고 없음)

- [ ] **Step 2: Prisma Client 재생성 확인**

Run: `npx prisma generate && npm run typecheck`
Expected: typecheck PASS (신규 필드가 Client 타입에 반영, 기존 코드 미사용이라 에러 0)

- [ ] **Step 3: 수동 마이그레이션 SQL 기록 (migrate resolve용)**

Create `prisma/migrations/20260604000000_phase8_ledger/migration.sql`:

```sql
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PARTIAL_CANCELED'; -- 이미 존재 시 no-op
DO $$ BEGIN CREATE TYPE "PaxType" AS ENUM ('ADULT','CHILD','INFANT'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "RefundKind" AS ENUM ('FULL_CANCEL','TRAVELER_CANCEL','DISCRETIONARY'); EXCEPTION WHEN duplicate_object THEN null; END $$;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "refundedAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RefundJob" ADD COLUMN IF NOT EXISTS "kind" "RefundKind" NOT NULL DEFAULT 'FULL_CANCEL';
ALTER TABLE "RefundJob" ADD COLUMN IF NOT EXISTS "baseAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RefundJob" ADD COLUMN IF NOT EXISTS "seatsReleased" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RefundJob" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "RefundJob_idempotencyKey_key" ON "RefundJob"("idempotencyKey");
ALTER TABLE "Traveler" ADD COLUMN IF NOT EXISTS "paxType" "PaxType";
ALTER TABLE "Traveler" ADD COLUMN IF NOT EXISTS "unitPrice" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Traveler" ADD COLUMN IF NOT EXISTS "canceledAt" TIMESTAMP(3);
ALTER TABLE "Traveler" ADD COLUMN IF NOT EXISTS "canceledByRefundJobId" TEXT;
```

- [ ] **Step 4: migrate resolve로 적용 처리**

Run: `npx prisma migrate resolve --applied 20260604000000_phase8_ledger`
Expected: `Migration ... marked as applied.`

- [ ] **Step 5: Commit**

```bash
git add prisma/migrations/
git commit -m "chore(db): apply phase8 ledger migration (db push workaround)"
```

---

## Task 3: `assignPaxTypes` 순수 함수 (그리디 + 잔차 보정)

**Files:**
- Create: `src/entities/booking/model/paxAssignment.ts`
- Test: `src/entities/booking/model/__tests__/paxAssignment.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `src/entities/booking/model/__tests__/paxAssignment.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assignPaxTypes } from "../paxAssignment";

const prices = { priceAdult: 1000, priceChild: 600, priceInfant: 0 };

describe("assignPaxTypes", () => {
  it("나이 많은 순으로 adult→child→infant 그리디 배정", () => {
    const result = assignPaxTypes({
      travelers: [
        { key: "young", birthDate: new Date("2020-01-01") },
        { key: "old", birthDate: new Date("1990-01-01") },
        { key: "mid", birthDate: new Date("2015-01-01") },
      ],
      adultCount: 1, childCount: 1, infantCount: 1,
      ...prices, totalPrice: 1600,
    });
    const byKey = Object.fromEntries(result.map((r) => [r.key, r]));
    expect(byKey.old.paxType).toBe("ADULT");
    expect(byKey.old.unitPrice).toBe(1000);
    expect(byKey.mid.paxType).toBe("CHILD");
    expect(byKey.mid.unitPrice).toBe(600);
    expect(byKey.young.paxType).toBe("INFANT");
    expect(byKey.young.unitPrice).toBe(0);
  });

  it("Σ unitPrice == totalPrice 불변식 (가격 드리프트 잔차를 첫 ADULT에 보정)", () => {
    // 현재가 합 1600이지만 과거 결제 totalPrice가 1700(드리프트) → 차액 +100을 ADULT에
    const result = assignPaxTypes({
      travelers: [
        { key: "a", birthDate: new Date("1990-01-01") },
        { key: "c", birthDate: new Date("2015-01-01") },
      ],
      adultCount: 1, childCount: 1, infantCount: 0,
      ...prices, totalPrice: 1700,
    });
    const sum = result.reduce((s, r) => s + r.unitPrice, 0);
    expect(sum).toBe(1700);
    const adult = result.find((r) => r.paxType === "ADULT")!;
    expect(adult.unitPrice).toBe(1100); // 1000 + 100 잔차
  });

  it("traveler 수 ≠ 카운트 합이면 throw", () => {
    expect(() =>
      assignPaxTypes({
        travelers: [{ key: "a", birthDate: new Date("1990-01-01") }],
        adultCount: 1, childCount: 1, infantCount: 0,
        ...prices, totalPrice: 1600,
      })
    ).toThrow(/count mismatch/i);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test -- paxAssignment`
Expected: FAIL ("Cannot find module ../paxAssignment")

- [ ] **Step 3: 구현 작성**

Create `src/entities/booking/model/paxAssignment.ts`:

```ts
import type { PaxType } from "@prisma/client";

export interface PaxAssignmentInput {
  travelers: { key: string; birthDate: Date }[];
  adultCount: number;
  childCount: number;
  infantCount: number;
  priceAdult: number;
  priceChild: number;
  priceInfant: number;
  totalPrice: number;
}

export interface PaxAssignment {
  key: string;
  paxType: PaxType;
  unitPrice: number;
}

/**
 * 여행자를 나이 많은 순으로 정렬해 booking 카운트(adult/child/infant)에 그리디 배정.
 * unitPrice는 departure 단가 스냅샷; Σ가 totalPrice와 다르면(가격 드리프트) 차액을
 * 첫 ADULT(없으면 첫 CHILD, 없으면 첫 INFANT)에 가감해 불변식 Σ unitPrice == totalPrice를 강제.
 * 순수 함수 — 입력 배열 비변이([...].sort).
 */
export function assignPaxTypes(input: PaxAssignmentInput): PaxAssignment[] {
  const { travelers, adultCount, childCount, infantCount } = input;
  const total = adultCount + childCount + infantCount;
  if (travelers.length !== total) {
    throw new Error(
      `pax count mismatch: travelers=${travelers.length} counts=${total}`
    );
  }

  const sorted = [...travelers].sort(
    (a, b) => a.birthDate.getTime() - b.birthDate.getTime()
  );

  const buckets: { paxType: PaxType; count: number; price: number }[] = [
    { paxType: "ADULT", count: adultCount, price: input.priceAdult },
    { paxType: "CHILD", count: childCount, price: input.priceChild },
    { paxType: "INFANT", count: infantCount, price: input.priceInfant },
  ];

  const assignments: PaxAssignment[] = [];
  let idx = 0;
  for (const b of buckets) {
    for (let i = 0; i < b.count; i++) {
      assignments.push({ key: sorted[idx].key, paxType: b.paxType, unitPrice: b.price });
      idx++;
    }
  }

  // 잔차 보정: Σ unitPrice == totalPrice 강제
  const sum = assignments.reduce((s, a) => s + a.unitPrice, 0);
  const diff = input.totalPrice - sum;
  if (diff !== 0) {
    const target =
      assignments.find((a) => a.paxType === "ADULT") ??
      assignments.find((a) => a.paxType === "CHILD") ??
      assignments[0];
    target.unitPrice += diff;
  }

  return assignments;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test -- paxAssignment`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/entities/booking/model/paxAssignment.ts src/entities/booking/model/__tests__/paxAssignment.test.ts
git commit -m "feat(booking): assignPaxTypes pure fn with totalPrice invariant"
```

---

## Task 4: `refundKeys` 멱등키 생성기 + `refundable` 잔여액 헬퍼

**Files:**
- Create: `src/entities/payment/model/refundKeys.ts`, `src/entities/payment/model/refundable.ts`
- Test: `src/entities/payment/model/__tests__/refundKeys.test.ts`

- [x] **Step 1: 실패 테스트 작성**

Create `src/entities/payment/model/__tests__/refundKeys.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { travelerCancelKey, discretionaryKey, fullCancelKey } from "../refundKeys";
import { refundableAmount } from "../refundable";

describe("refundKeys", () => {
  it("travelerCancelKey는 traveler id 정렬에 무관하게 동일 (멱등)", () => {
    const a = travelerCancelKey("bk1", ["t3", "t1", "t2"]);
    const b = travelerCancelKey("bk1", ["t1", "t2", "t3"]);
    expect(a).toBe(b);
    expect(a).toBe("traveler-cancel:bk1:t1,t2,t3");
  });
  it("discretionaryKey는 requestId 기반", () => {
    expect(discretionaryKey("bk1", "req-9")).toBe("discretionary:bk1:req-9");
  });
  it("fullCancelKey는 booking당 1개", () => {
    expect(fullCancelKey("bk1")).toBe("full-cancel:bk1");
  });
});

describe("refundableAmount", () => {
  it("amount - refundedAmount", () => {
    expect(refundableAmount({ amount: 1000, refundedAmount: 300 })).toBe(700);
  });
  it("음수 방지(0 하한)", () => {
    expect(refundableAmount({ amount: 1000, refundedAmount: 1200 })).toBe(0);
  });
});
```

- [x] **Step 2: 테스트 실패 확인**

Run: `npm run test -- refundKeys`
Expected: FAIL ("Cannot find module ../refundKeys")

- [x] **Step 3: 구현 작성**

Create `src/entities/payment/model/refundKeys.ts`:

```ts
/** 환불 요청 단위 멱등키 생성 — 동일 논리 요청 재시도가 같은 키를 만들어 이중환불 차단. */

export function travelerCancelKey(bookingId: string, travelerIds: string[]): string {
  const sorted = [...travelerIds].sort();
  return `traveler-cancel:${bookingId}:${sorted.join(",")}`;
}

export function discretionaryKey(bookingId: string, requestId: string): string {
  return `discretionary:${bookingId}:${requestId}`;
}

export function fullCancelKey(bookingId: string): string {
  return `full-cancel:${bookingId}`;
}
```

Create `src/entities/payment/model/refundable.ts`:

```ts
/** 잔여 환불가능액 = amount − refundedAmount (0 하한). 순수 함수. */
export function refundableAmount(p: { amount: number; refundedAmount: number }): number {
  return Math.max(p.amount - p.refundedAmount, 0);
}
```

- [x] **Step 4: 테스트 통과 확인**

Run: `npm run test -- refundKeys`
Expected: PASS (5 tests)

- [x] **Step 5: Commit**

```bash
git add src/entities/payment/model/refundKeys.ts src/entities/payment/model/refundable.ts src/entities/payment/model/__tests__/refundKeys.test.ts
git commit -m "feat(payment): idempotency key generators + refundable helper"
```

---

## Task 5: `reserveRefund`/`releaseRefund` Ledger 조건부 차감

**Files:**
- Create: `src/entities/payment/api/ledger.ts`
- Test: `src/entities/payment/api/__tests__/ledger.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (mock tx)**

Create `src/entities/payment/api/__tests__/ledger.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { reserveRefund, releaseRefund } from "../ledger";

function mockTx(updateManyCount: number) {
  return {
    payment: { updateMany: vi.fn().mockResolvedValue({ count: updateManyCount }) },
  } as never;
}

describe("reserveRefund", () => {
  it("조건부 차감 성공(count=1) → true, where에 refundedAmount lte 가드 포함", async () => {
    const tx = mockTx(1);
    const ok = await reserveRefund(tx, { paymentId: "p1", amount: 1000, requestedRefund: 300 });
    expect(ok).toBe(true);
    const call = (tx as never as { payment: { updateMany: { mock: { calls: unknown[][] } } } })
      .payment.updateMany.mock.calls[0][0] as {
      where: { refundedAmount: { lte: number }; status: { in: string[] } };
      data: { refundedAmount: { increment: number } };
    };
    expect(call.where.refundedAmount.lte).toBe(700); // amount - requested
    expect(call.where.status.in).toEqual(["PAID", "PARTIAL_CANCELED"]);
    expect(call.data.refundedAmount.increment).toBe(300);
  });

  it("경합/한도초과(count=0) → false", async () => {
    const ok = await reserveRefund(mockTx(0), { paymentId: "p1", amount: 1000, requestedRefund: 300 });
    expect(ok).toBe(false);
  });
});

describe("releaseRefund", () => {
  it("refundedAmount decrement 복원", async () => {
    const tx = mockTx(1);
    await releaseRefund(tx, { paymentId: "p1", amount: 300 });
    const call = (tx as never as { payment: { updateMany: { mock: { calls: unknown[][] } } } })
      .payment.updateMany.mock.calls[0][0] as { data: { refundedAmount: { decrement: number } } };
    expect(call.data.refundedAmount.decrement).toBe(300);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test -- ledger`
Expected: FAIL ("Cannot find module ../ledger")

- [ ] **Step 3: 구현 작성**

Create `src/entities/payment/api/ledger.ts`:

```ts
import type { Prisma } from "@prisma/client";

/**
 * 환불 예약(reserve) — Payment.refundedAmount 조건부 차감(원자적 CAS).
 * Postgres row lock이 동시 요청을 직렬화 → Σ 환불 ≤ amount 불변식을 retry 루프 없이 보장.
 * (§spec D2, 좌석 reserveSeats와 동형) 반환 false = 경합 패자 또는 한도초과.
 */
export async function reserveRefund(
  tx: Prisma.TransactionClient,
  { paymentId, amount, requestedRefund }: { paymentId: string; amount: number; requestedRefund: number }
): Promise<boolean> {
  const res = await tx.payment.updateMany({
    where: {
      id: paymentId,
      status: { in: ["PAID", "PARTIAL_CANCELED"] },
      refundedAmount: { lte: amount - requestedRefund },
    },
    data: { refundedAmount: { increment: requestedRefund } },
  });
  return res.count > 0;
}

/** 예약 해제(release) — PG 영구 실패 시 refundedAmount 복원. */
export async function releaseRefund(
  tx: Prisma.TransactionClient,
  { paymentId, amount }: { paymentId: string; amount: number }
): Promise<void> {
  await tx.payment.updateMany({
    where: { id: paymentId },
    data: { refundedAmount: { decrement: amount } },
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test -- ledger`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/entities/payment/api/ledger.ts src/entities/payment/api/__tests__/ledger.test.ts
git commit -m "feat(payment): ledger reserve/release conditional decrement (race-free)"
```

---

## Task 6: `transitionStatusTx` 좌석 환원 스킵 옵션

**Files:**
- Modify: `src/entities/booking/api/mutations.ts:102-150`
- Test: `src/entities/booking/api/__tests__/transitionSkipSeats.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `src/entities/booking/api/__tests__/transitionSkipSeats.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const releaseSeats = vi.fn();
vi.mock("../seatLock", () => ({
  reserveSeats: vi.fn(),
  releaseSeats: (...args: unknown[]) => releaseSeats(...args),
  InsufficientCapacityError: class extends Error {},
}));
vi.mock("@/shared/lib/email-job/enqueue", () => ({ enqueueEmailJob: vi.fn() }));

import { transitionStatusTx } from "../mutations";

function txWith(booking: { status: string; departureId: string; adultCount: number; childCount: number }) {
  return {
    booking: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "bk1", ...booking }),
      update: vi.fn().mockResolvedValue({ id: "bk1", status: "CANCELED_BY_AGENCY" }),
    },
    bookingEvent: { create: vi.fn() },
  } as never;
}

describe("transitionStatusTx skipSeatReturn", () => {
  beforeEach(() => releaseSeats.mockClear());

  it("skipSeatReturn=true면 terminal 전이라도 releaseSeats 미호출(이중환원 방지)", async () => {
    await transitionStatusTx(
      txWith({ status: "PAID", departureId: "d1", adultCount: 2, childCount: 0 }),
      { bookingId: "bk1", to: "CANCELED_BY_AGENCY", actor: "system:saga", skipSeatReturn: true }
    );
    expect(releaseSeats).not.toHaveBeenCalled();
  });

  it("skipSeatReturn 미지정이면 기존대로 좌석 환원", async () => {
    await transitionStatusTx(
      txWith({ status: "PAID", departureId: "d1", adultCount: 2, childCount: 0 }),
      { bookingId: "bk1", to: "CANCELED_BY_AGENCY", actor: "system:saga" }
    );
    expect(releaseSeats).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test -- transitionSkipSeats`
Expected: FAIL (skipSeatReturn 미지원 → 두 케이스 모두 releaseSeats 호출)

- [ ] **Step 3: 구현 — TransitionStatusInput에 옵션 추가**

`src/entities/booking/api/mutations.ts`의 `TransitionStatusInput` 인터페이스(90-95)와 `transitionStatusTx`(102-120) 수정:

```ts
interface TransitionStatusInput {
  bookingId: string;
  to: BookingStatus;
  actor: string;
  reason?: string;
  /** 사가가 좌석을 이미 정밀 환원한 경우 true — terminal 전이의 전체 환원 이중집행 방지(spec §5.3). */
  skipSeatReturn?: boolean;
}
```

`transitionStatusTx` 본문의 좌석 환원 가드(113-120)를 수정:

```ts
  // R7: 취소 전이 시 좌석 환원 (보상 트랜잭션). 사가가 정밀 환원했으면 스킵(이중환원 방지).
  if (!skipSeatReturn && shouldReturnSeats(current.status, to)) {
    await releaseSeats(
      tx,
      current.departureId,
      current.adultCount + current.childCount
    );
  }
```

함수 시그니처 구조분해에 `skipSeatReturn` 추가:

```ts
export async function transitionStatusTx(
  tx: Prisma.TransactionClient,
  { bookingId, to, actor, reason, skipSeatReturn }: TransitionStatusInput
): Promise<Booking> {
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test -- transitionSkipSeats && npm run typecheck`
Expected: PASS (2 tests), typecheck PASS

- [ ] **Step 5: Commit**

```bash
git add src/entities/booking/api/mutations.ts src/entities/booking/api/__tests__/transitionSkipSeats.test.ts
git commit -m "feat(booking): transitionStatusTx skipSeatReturn option"
```

---

## Task 7: `createBooking` + seed — paxType/unitPrice 채우기

**Files:**
- Modify: `src/entities/booking/api/mutations.ts:13-88`
- Modify: `prisma/seed.ts`
- Test: `src/entities/booking/api/__tests__/createBookingPax.test.ts`

- [x] **Step 1: 실패 테스트 작성 (assignPaxTypes 연동 검증)**

Create `src/entities/booking/api/__tests__/createBookingPax.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assignPaxTypes } from "../../model/paxAssignment";

// createBooking이 travelers를 입력 순서가 아닌 assignPaxTypes 결과로 채우는지
// 단위 수준에서 매핑 규칙을 고정(통합은 Task 12). 여기선 매핑 계약만 박제.
describe("createBooking pax mapping contract", () => {
  it("입력 traveler에 index key를 부여해 assignPaxTypes 결과를 역매핑할 수 있다", () => {
    const travelers = [
      { lastNameEn: "A", birthDate: new Date("1990-01-01") },
      { lastNameEn: "B", birthDate: new Date("2018-01-01") },
    ];
    const assigned = assignPaxTypes({
      travelers: travelers.map((t, i) => ({ key: String(i), birthDate: t.birthDate })),
      adultCount: 1, childCount: 1, infantCount: 0,
      priceAdult: 1000, priceChild: 600, priceInfant: 0, totalPrice: 1600,
    });
    const byIndex = new Map(assigned.map((a) => [a.key, a]));
    expect(byIndex.get("0")!.paxType).toBe("ADULT");
    expect(byIndex.get("1")!.paxType).toBe("CHILD");
  });
});
```

- [x] **Step 2: 테스트 실패 확인 (import 경로 정상이면 PASS 가능 — 먼저 RED 보장 위해 구현 전 실행)**

Run: `npm run test -- createBookingPax`
Expected: PASS (assignPaxTypes는 Task 3에서 구현됨 — 이 테스트는 매핑 계약 회귀 가드). 계약이 깨지면 FAIL.

- [x] **Step 3: createBooking 수정 — paxType/unitPrice 주입**

`src/entities/booking/api/mutations.ts`의 createBooking에서 departure select에 이미 priceAdult/Child/Infant 있음(20-24). 좌석 차감 직전(39 근처)에 배정 계산 추가하고, travelers.create 매핑(54-64)을 수정:

```ts
  // pax 배정 — index를 key로 assignPaxTypes 호출 후 역매핑
  const assignments = assignPaxTypes({
    travelers: data.travelers.map((t, i) => ({ key: String(i), birthDate: t.birthDate })),
    adultCount: data.adultCount,
    childCount: data.childCount,
    infantCount: data.infantCount,
    priceAdult: departure.priceAdult,
    priceChild: departure.priceChild,
    priceInfant: departure.priceInfant,
    totalPrice,
  });
  const assignByIndex = new Map(assignments.map((a) => [a.key, a]));
```

travelers.create 매핑:

```ts
        travelers: {
          create: data.travelers.map((t, i) => ({
            role: t.role ?? "TRAVELER",
            lastNameEn: t.lastNameEn,
            firstNameEn: t.firstNameEn,
            gender: t.gender,
            birthDate: t.birthDate,
            passportNo: t.passportNo,
            expireDate: t.expireDate,
            phone: t.phone,
            email: t.email,
            paxType: assignByIndex.get(String(i))!.paxType,
            unitPrice: assignByIndex.get(String(i))!.unitPrice,
          })),
        },
```

파일 상단 import 추가:

```ts
import { assignPaxTypes } from "../model/paxAssignment";
```

- [x] **Step 4: seed.ts — booking 생성 경로가 createBooking을 거치므로 자동 반영 확인**

`prisma/seed.ts`는 `createBooking`을 호출(1125 근처)하므로 paxType/unitPrice가 자동 채워진다. 별도 수정 불필요 — 단 seed 재실행으로 검증.

Run: `npm run db:seed` (또는 `npx tsx prisma/seed.ts`)
Expected: `✅ Booking seed: ...` 출력, 에러 0.

- [x] **Step 5: seed booking의 Traveler unitPrice 합 == totalPrice 검증**

Run:
```bash
npx tsx -e "import {db} from './src/shared/lib/db'; (async()=>{const b=await db.booking.findFirst({include:{travelers:true}}); const sum=b!.travelers.reduce((s,t)=>s+t.unitPrice,0); console.log('totalPrice',b!.totalPrice,'sumUnit',sum, sum===b!.totalPrice?'OK':'MISMATCH'); process.exit(0)})()"
```
Expected: `... OK`

- [x] **Step 6: typecheck + commit**

Run: `npm run typecheck && npm run test -- createBookingPax`
Expected: PASS

```bash
git add src/entities/booking/api/mutations.ts src/entities/booking/api/__tests__/createBookingPax.test.ts
git commit -m "feat(booking): populate Traveler paxType/unitPrice on createBooking"
```

---

## Task 8: Backfill 스크립트 (기존 데이터 정합)

**Files:**
- Create: `scripts/backfill-phase8.ts`
- Test: `scripts/__tests__/backfill-phase8.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (순수 로직 추출 검증)**

Create `scripts/__tests__/backfill-phase8.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeRefundedFromJobs } from "../backfill-phase8";

describe("computeRefundedFromJobs", () => {
  it("PENDING/IN_PROGRESS/SUCCEEDED amount 합산, FAILED 제외", () => {
    const sum = computeRefundedFromJobs([
      { amount: 300, status: "SUCCEEDED" },
      { amount: 200, status: "PENDING" },
      { amount: 100, status: "IN_PROGRESS" },
      { amount: 999, status: "FAILED" },
    ]);
    expect(sum).toBe(600);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test -- backfill-phase8`
Expected: FAIL ("Cannot find module ../backfill-phase8")

- [ ] **Step 3: 구현 작성**

Create `scripts/backfill-phase8.ts`:

```ts
/**
 * Phase 8 backfill — 멱등. 재실행 안전(이미 채워진 row 스킵).
 *  1) Traveler.paxType/unitPrice (assignPaxTypes, totalPrice 잔차보정)
 *  2) Payment.refundedAmount = Σ active RefundJob.amount
 *  3) 기존 RefundJob kind/baseAmount/seatsReleased/idempotencyKey
 * 실행: npx tsx scripts/backfill-phase8.ts
 */
import type { RefundJobStatus } from "@prisma/client";
import { db } from "@/shared/lib/db";
import { assignPaxTypes } from "@/entities/booking/model/paxAssignment";
import { fullCancelKey } from "@/entities/payment/model/refundKeys";

const ACTIVE: RefundJobStatus[] = ["PENDING", "IN_PROGRESS", "SUCCEEDED"];

export function computeRefundedFromJobs(jobs: { amount: number; status: string }[]): number {
  return jobs.filter((j) => ACTIVE.includes(j.status as RefundJobStatus)).reduce((s, j) => s + j.amount, 0);
}

async function backfillTravelers() {
  const bookings = await db.booking.findMany({
    where: { travelers: { some: { paxType: null } } },
    include: { travelers: true, departure: { select: { priceAdult: true, priceChild: true, priceInfant: true } } },
  });
  for (const b of bookings) {
    if (b.travelers.length !== b.adultCount + b.childCount + b.infantCount) {
      console.warn(`SKIP booking ${b.id}: traveler count mismatch (manual review)`);
      continue;
    }
    const assigned = assignPaxTypes({
      travelers: b.travelers.map((t) => ({ key: t.id, birthDate: t.birthDate })),
      adultCount: b.adultCount, childCount: b.childCount, infantCount: b.infantCount,
      priceAdult: b.departure.priceAdult, priceChild: b.departure.priceChild,
      priceInfant: b.departure.priceInfant, totalPrice: b.totalPrice,
    });
    for (const a of assigned) {
      await db.traveler.update({ where: { id: a.key }, data: { paxType: a.paxType, unitPrice: a.unitPrice } });
    }
    console.log(`✓ traveler backfill booking ${b.id}`);
  }
}

async function backfillPayments() {
  const payments = await db.payment.findMany({ include: { refundJobs: true, booking: { select: { adultCount: true, childCount: true } } } });
  for (const p of payments) {
    const refunded = computeRefundedFromJobs(p.refundJobs);
    await db.payment.update({ where: { id: p.id }, data: { refundedAmount: refunded } });
    for (const j of p.refundJobs) {
      if (j.idempotencyKey) continue; // 멱등: 이미 처리
      await db.refundJob.update({
        where: { id: j.id },
        data: {
          baseAmount: p.amount,
          seatsReleased: p.booking.adultCount + p.booking.childCount,
          idempotencyKey: fullCancelKey(j.bookingId),
        },
      }).catch((e) => console.warn(`RefundJob ${j.id} idempotencyKey conflict skipped: ${e}`));
    }
    console.log(`✓ payment backfill ${p.id} refunded=${refunded}`);
  }
}

async function main() {
  await backfillTravelers();
  await backfillPayments();
  console.log("Phase 8 backfill done.");
}

if (process.env.NODE_ENV !== "test") {
  main().catch(console.error).finally(() => db.$disconnect());
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test -- backfill-phase8`
Expected: PASS (1 test)

- [ ] **Step 5: 실제 backfill 실행 + 불변식 검증**

Run: `npx tsx scripts/backfill-phase8.ts`
Expected: `✓ ...` 로그 + `Phase 8 backfill done.`

불변식 검증 (spec §4.4 — 전부 0건):
```bash
npx tsx -e "import {db} from './src/shared/lib/db'; (async()=>{const bad=await db.\$queryRawUnsafe('SELECT b.id FROM \"Booking\" b JOIN (SELECT \"bookingId\", SUM(\"unitPrice\") s FROM \"Traveler\" GROUP BY \"bookingId\") t ON t.\"bookingId\"=b.id WHERE t.s <> b.\"totalPrice\"'); console.log('mismatch rows:', (bad as unknown[]).length); process.exit(0)})()"
```
Expected: `mismatch rows: 0`

- [ ] **Step 6: Commit**

```bash
git add scripts/backfill-phase8.ts scripts/__tests__/backfill-phase8.test.ts
git commit -m "feat(db): idempotent phase8 backfill (traveler unitPrice + payment refundedAmount)"
```

---

## Task 9: 환불 사가 리팩토링 — 종류별 분기 (핵심)

**Files:**
- Modify: `src/entities/payment/api/refund.ts` (대수술)
- Test: `src/entities/payment/api/__tests__/refundLedger.test.ts`

- [x] **Step 1: 실패 테스트 작성 (DISCRETIONARY + 부분 TRAVELER + 멱등 + 한도초과)**

Create `src/entities/payment/api/__tests__/refundLedger.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const cancel = vi.fn().mockResolvedValue(undefined);
vi.mock("@/shared/lib/toss", () => ({ tossClient: { cancel: (...a: unknown[]) => cancel(...a) } }));
const transitionStatus = vi.fn();
vi.mock("@/entities/booking", () => ({ transitionStatus: (...a: unknown[]) => transitionStatus(...a) }));
vi.mock("@/shared/lib/observability", () => ({
  logger: { error: vi.fn() }, metrics: { incr: vi.fn() }, captureException: vi.fn(),
}));

// db mock — 시나리오별 동작 주입
const reserveCount = { value: 1 };
const existingJob = { value: null as null | { id: string } };
vi.mock("@/shared/lib/db", () => {
  const tx = {
    payment: {
      updateMany: vi.fn().mockImplementation(() => Promise.resolve({ count: reserveCount.value })),
      update: vi.fn().mockResolvedValue({}),
    },
    refundJob: {
      findUnique: vi.fn().mockImplementation(() => Promise.resolve(existingJob.value)),
      create: vi.fn().mockResolvedValue({ id: "rj1", attempts: 0 }),
      update: vi.fn().mockResolvedValue({}),
    },
    paymentEvent: { create: vi.fn() },
    traveler: { updateMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    booking: { findUnique: vi.fn() },
  };
  return {
    db: {
      $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      payment: { findFirst: vi.fn().mockResolvedValue({ id: "p1", amount: 1000, refundedAmount: 0, tossPaymentKey: "pk1" }) },
    },
  };
});

import { refundDiscretionary } from "../refund";

describe("refundDiscretionary", () => {
  beforeEach(() => { reserveCount.value = 1; existingJob.value = null; cancel.mockClear(); });

  it("재량 환불은 booking 전이 없이 PG cancel(요청액)만 수행", async () => {
    await refundDiscretionary({ bookingId: "bk1", paymentId: "p1", amount: 300, actor: "admin:1", requestId: "r1" });
    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ cancelAmount: 300 }));
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it("한도초과(reserve count=0) → REFUND_EXCEEDS_REFUNDABLE, PG 미호출", async () => {
    reserveCount.value = 0;
    await expect(
      refundDiscretionary({ bookingId: "bk1", paymentId: "p1", amount: 300, actor: "admin:1", requestId: "r2" })
    ).rejects.toThrow(/REFUND_EXCEEDS_REFUNDABLE/);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("멱등: 동일 idempotencyKey 기존 Job 존재 → no-op(PG 미호출)", async () => {
    existingJob.value = { id: "rj-existing" };
    await refundDiscretionary({ bookingId: "bk1", paymentId: "p1", amount: 300, actor: "admin:1", requestId: "r1" });
    expect(cancel).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: 테스트 실패 확인**

Run: `npm run test -- refundLedger`
Expected: FAIL ("refundDiscretionary is not exported")

- [x] **Step 3: 구현 — refund.ts에 종류별 함수 추가**

`src/entities/payment/api/refund.ts`에 공통 헬퍼 + `refundDiscretionary` 추가(기존 `refundBooking`은 Task 10에서 FULL_CANCEL 경유로 정리). 신규 코드:

```ts
import { reserveRefund, releaseRefund } from "./ledger";
import { discretionaryKey } from "../model/refundKeys";
import type { Prisma, RefundKind } from "@prisma/client";

interface SagaCore {
  bookingId: string;
  paymentId: string;
  tossPaymentKey: string;
  amount: number;          // payment 총액
  refundAmount: number;    // 이번 환불 실액
  penaltyAmount: number;
  baseAmount: number;
  seatsReleased: number;
  kind: RefundKind;
  idempotencyKey: string;
  actor: string;
  reason?: string;
}

/**
 * 공통 3-phase 사가. settle 직후 후처리(booking 전이/좌석/traveler)는 호출자가 onSettled로 주입.
 * Phase1 예약(reserve) → Phase2 PG(밖) → Phase3 정산(settle).
 */
async function runRefundSaga(
  core: SagaCore,
  onSettled?: () => Promise<void>
): Promise<void> {
  // Phase 1: 멱등 + 예약 (DB Tx)
  const created = await db.$transaction(async (tx) => {
    const existing = await tx.refundJob.findUnique({ where: { idempotencyKey: core.idempotencyKey }, select: { id: true } });
    if (existing) return null; // 멱등 no-op

    const ok = await reserveRefund(tx, { paymentId: core.paymentId, amount: core.amount, requestedRefund: core.refundAmount });
    if (!ok) throw new PaymentError("REFUND_EXCEEDS_REFUNDABLE", { requestedRefund: core.refundAmount });

    return tx.refundJob.create({
      data: {
        bookingId: core.bookingId, paymentId: core.paymentId,
        amount: core.refundAmount, penaltyAmount: core.penaltyAmount, baseAmount: core.baseAmount,
        seatsReleased: core.seatsReleased, kind: core.kind, idempotencyKey: core.idempotencyKey,
        reason: core.reason ?? null, actor: core.actor, status: "IN_PROGRESS",
      },
      select: { id: true, attempts: true },
    });
  });
  if (!created) return; // 멱등 종료

  // Phase 2: 외부 PG (Tx 밖)
  try {
    await tossClient.cancel({
      paymentKey: core.tossPaymentKey,
      cancelReason: core.reason ?? "환불 요청",
      cancelAmount: core.refundAmount,
      idempotencyKey: created.id,
    });
  } catch (err) {
    // 일시 실패: 예약 유지 + PENDING backoff (cron 재시도). 영구 판별은 cron이.
    await db.refundJob.update({
      where: { id: created.id },
      data: { status: "PENDING", attempts: { increment: 1 }, nextRunAt: backoff(created.attempts), lastError: String(err) },
    });
    metrics.incr("payment.refund.deferred");
    captureException(err, { bookingId: core.bookingId });
    throw new PaymentError("REFUND_DEFERRED", { cause: String(err) });
  }

  // Phase 3: 정산 (DB Tx)
  await db.$transaction(async (tx) => {
    const p = await tx.payment.findUniqueOrThrow({ where: { id: core.paymentId }, select: { amount: true, refundedAmount: true } });
    await tx.payment.update({
      where: { id: core.paymentId },
      data: { status: p.refundedAmount >= p.amount ? "CANCELED" : "PARTIAL_CANCELED", canceledAt: new Date() },
    });
    await tx.refundJob.update({ where: { id: created.id }, data: { status: "SUCCEEDED" } });
    await tx.paymentEvent.create({
      data: {
        providerEventId: `refund:${created.id}`, bookingId: core.bookingId, paymentId: core.paymentId,
        type: "REFUND_REQUEST",
        payload: { kind: core.kind, baseAmount: core.baseAmount, penaltyAmount: core.penaltyAmount, refundAmount: core.refundAmount, actor: core.actor } as unknown as Prisma.InputJsonValue,
        result: "PROCESSED",
      },
    });
  });
  metrics.incr("payment.refund.success");

  if (onSettled) await onSettled();
}

interface DiscretionaryInput {
  bookingId: string;
  paymentId: string;
  amount: number;        // 환불 요청액
  actor: string;
  requestId: string;     // UI 생성 멱등 토큰
  reason?: string;
}

/** 관리자 재량 환불 — 좌석/booking/traveler 불변, 순수 머니무브. */
export async function refundDiscretionary(input: DiscretionaryInput): Promise<void> {
  const payment = await db.payment.findFirst({
    where: { id: input.paymentId, status: { in: ["PAID", "PARTIAL_CANCELED"] } },
    select: { id: true, amount: true, refundedAmount: true, tossPaymentKey: true },
  });
  if (!payment?.tossPaymentKey) throw new PaymentError("PAID_PAYMENT_NOT_FOUND");

  await runRefundSaga({
    bookingId: input.bookingId, paymentId: payment.id, tossPaymentKey: payment.tossPaymentKey,
    amount: payment.amount, refundAmount: input.amount, penaltyAmount: 0, baseAmount: 0,
    seatsReleased: 0, kind: "DISCRETIONARY",
    idempotencyKey: discretionaryKey(input.bookingId, input.requestId),
    actor: input.actor, reason: input.reason,
  });
}
```

> 주의: 기존 `refundBooking`의 `findFirst({ status: "PAID" })`는 PARTIAL_CANCELED 재진입을 막으므로, 신규 경로는 `status: { in: ["PAID","PARTIAL_CANCELED"] }`로 조회. tossClient.cancel 시그니처에 `idempotencyKey` 추가 필요(다음 스텝).

- [x] **Step 4: tossClient.cancel에 idempotencyKey 파라미터 추가**

`src/shared/lib/toss/`의 cancel 구현에 `idempotencyKey?: string`를 받아 HTTP 헤더 `Idempotency-Key`로 전달(Mock 서버는 무시해도 무방). 기존 호출부 호환 위해 optional.

Run: `grep -rn "cancel" src/shared/lib/toss/`로 시그니처 위치 확인 후 인터페이스에 `idempotencyKey?: string` 추가.

- [x] **Step 5: 테스트 통과 확인**

Run: `npm run test -- refundLedger && npm run typecheck`
Expected: PASS (3 tests), typecheck PASS

- [x] **Step 6: Commit**

```bash
git add src/entities/payment/api/refund.ts src/shared/lib/toss/ src/entities/payment/api/__tests__/refundLedger.test.ts
git commit -m "feat(payment): runRefundSaga core + refundDiscretionary (ledger, idempotent)"
```

---

## Task 10: `refundTraveler` + `refundBooking`(FULL_CANCEL) 정리

**Files:**
- Modify: `src/entities/payment/api/refund.ts`
- Create: `src/entities/booking/api/travelerCancel.ts`
- Test: `src/entities/payment/api/__tests__/refundTraveler.test.ts`

- [x] **Step 1: 실패 테스트 작성**

Create `src/entities/payment/api/__tests__/refundTraveler.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeCanceledBase } from "../refund";

describe("computeCanceledBase", () => {
  it("취소 여행자 unitPrice 합 + 좌석점유분(ADULT/CHILD) 계산", () => {
    const r = computeCanceledBase([
      { paxType: "ADULT", unitPrice: 1000 },
      { paxType: "CHILD", unitPrice: 600 },
      { paxType: "INFANT", unitPrice: 0 },
    ]);
    expect(r.canceledBase).toBe(1600);
    expect(r.seatsReleased).toBe(2); // INFANT 미차감
  });
});
```

- [x] **Step 2: 테스트 실패 확인**

Run: `npm run test -- refundTraveler`
Expected: FAIL ("computeCanceledBase is not exported")

- [x] **Step 3: 구현 — computeCanceledBase + refundTraveler + refundBooking 재작성**

`src/entities/payment/api/refund.ts`에 추가:

```ts
import { computePenalty } from "../model/penaltyPolicy";
import { travelerCancelKey, fullCancelKey } from "../model/refundKeys";
import { transitionStatusTx } from "@/entities/booking";
import type { PaxType } from "@prisma/client";

export function computeCanceledBase(
  travelers: { paxType: PaxType | null; unitPrice: number }[]
): { canceledBase: number; seatsReleased: number } {
  let canceledBase = 0;
  let seatsReleased = 0;
  for (const t of travelers) {
    canceledBase += t.unitPrice;
    if (t.paxType === "ADULT" || t.paxType === "CHILD") seatsReleased += 1;
  }
  return { canceledBase, seatsReleased };
}

interface TravelerCancelInput {
  bookingId: string;
  travelerIds: string[];
  actor: string;
  applyPenalty: boolean;
  reason?: string;
}

/** 여행자 부분 취소 — 취소분 base에 위약금 적용, 좌석 N개 환원, 마지막이면 booking terminal. */
export async function refundTraveler(input: TravelerCancelInput): Promise<void> {
  const booking = await db.booking.findUnique({
    where: { id: input.bookingId },
    select: {
      id: true, status: true, departureId: true,
      departure: { select: { departureDate: true } },
      travelers: { select: { id: true, paxType: true, unitPrice: true, canceledAt: true } },
    },
  });
  if (!booking) throw new PaymentError("BOOKING_NOT_FOUND");
  if (!["PAID", "READY"].includes(booking.status)) throw new PaymentError("BOOKING_NOT_REFUNDABLE", { current: booking.status });

  const targetTravelers = booking.travelers.filter((t) => input.travelerIds.includes(t.id) && t.canceledAt === null);
  if (targetTravelers.length === 0) throw new PaymentError("NO_ACTIVE_TRAVELERS");

  const { canceledBase, seatsReleased } = computeCanceledBase(targetTravelers);
  const { penaltyAmount, refundAmount } = input.applyPenalty
    ? computePenalty({ baseAmount: canceledBase, departureDate: booking.departure.departureDate, now: new Date() })
    : { penaltyAmount: 0, refundAmount: canceledBase };

  const payment = await db.payment.findFirst({
    where: { bookingId: input.bookingId, status: { in: ["PAID", "PARTIAL_CANCELED"] } },
    select: { id: true, amount: true, refundedAmount: true, tossPaymentKey: true },
  });
  if (!payment?.tossPaymentKey) throw new PaymentError("PAID_PAYMENT_NOT_FOUND");

  // 취소 후 활성 여행자가 0이 되는지(=terminal)
  const remainingActive = booking.travelers.filter((t) => t.canceledAt === null && !input.travelerIds.includes(t.id)).length;
  const isLast = remainingActive === 0;

  await runRefundSaga(
    {
      bookingId: booking.id, paymentId: payment.id, tossPaymentKey: payment.tossPaymentKey,
      amount: payment.amount, refundAmount, penaltyAmount, baseAmount: canceledBase,
      seatsReleased, kind: isLast ? "FULL_CANCEL" : "TRAVELER_CANCEL",
      idempotencyKey: isLast ? fullCancelKey(booking.id) : travelerCancelKey(booking.id, input.travelerIds),
      actor: input.actor, reason: input.reason,
    },
    async () => {
      // settle 후처리: traveler 표식 + 좌석 정밀 환원 + (마지막이면) terminal 전이(좌석 스킵)
      await db.$transaction(async (tx) => {
        await tx.refundJob.findFirstOrThrow({ where: { idempotencyKey: isLast ? fullCancelKey(booking.id) : travelerCancelKey(booking.id, input.travelerIds) }, select: { id: true } })
          .then((rj) => tx.traveler.updateMany({ where: { id: { in: input.travelerIds }, canceledAt: null }, data: { canceledAt: new Date(), canceledByRefundJobId: rj.id } }));
        if (seatsReleased > 0) await releaseSeatsRaw(tx, booking.departureId, seatsReleased);
        if (isLast) {
          await transitionStatusTx(tx, {
            bookingId: booking.id,
            to: input.actor.startsWith("user:") ? "CANCELED_BY_USER" : "CANCELED_BY_AGENCY",
            actor: input.actor, reason: input.reason ?? "전체 여행자 취소 완료",
            skipSeatReturn: true, // 사가가 이미 좌석 정밀 환원
          });
        }
      });
    }
  );
}
```

`releaseSeatsRaw`는 `@/entities/booking`의 `releaseSeats`를 재사용(배럴 export 확인). import:

```ts
import { releaseSeats as releaseSeatsRaw } from "@/entities/booking";
```

기존 `refundBooking`은 FULL_CANCEL 위임 래퍼로 축소(호환 유지):

```ts
/** 하위호환: 예약 전체 취소 = 모든 활성 여행자 refundTraveler. */
export async function refundBooking({ bookingId, actor, reason, applyPenalty }: { bookingId: string; actor: string; reason?: string; applyPenalty: boolean }): Promise<void> {
  const booking = await db.booking.findUnique({ where: { id: bookingId }, select: { travelers: { where: { canceledAt: null }, select: { id: true } } } });
  if (!booking) throw new PaymentError("BOOKING_NOT_FOUND");
  await refundTraveler({ bookingId, travelerIds: booking.travelers.map((t) => t.id), actor, applyPenalty, reason });
}
```

- [x] **Step 4: 배럴 export 갱신**

`src/entities/payment/index.ts`에 `refundTraveler`, `refundDiscretionary`, `computeCanceledBase` export 추가. `src/entities/booking/index.ts`에 `releaseSeats` export 확인(이미 57행에 존재).

- [x] **Step 5: 테스트 통과 확인**

Run: `npm run test -- refundTraveler refundLedger && npm run typecheck`
Expected: PASS, typecheck PASS

- [x] **Step 6: Commit**

```bash
git add src/entities/payment/api/refund.ts src/entities/payment/index.ts src/entities/payment/api/__tests__/refundTraveler.test.ts
git commit -m "feat(payment): refundTraveler partial cancel + refundBooking as FULL_CANCEL wrapper"
```

---

## Task 11: `refundRetry` cron worker — 보상/예약해제 반영

**Files:**
- Modify: `src/entities/payment/api/refundRetry.ts`
- Test: `src/entities/payment/api/__tests__/refundRetryLedger.test.ts`

- [x] **Step 1: 기존 refundRetry 읽기**

Run: `cat src/entities/payment/api/refundRetry.ts`로 현재 재시도 로직 파악(동결 스냅샷 `amount`/`penaltyAmount`만 읽고 재계산 0 — [ADR-0031] 유지 확인).

- [x] **Step 2: 실패 테스트 작성 (영구 실패 → 예약 해제)**

Create `src/entities/payment/api/__tests__/refundRetryLedger.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isPermanentFailure } from "../refundRetry";

describe("isPermanentFailure", () => {
  it("최대 attempts 도달 시 영구 실패(예약 해제 대상)", () => {
    expect(isPermanentFailure(10)).toBe(true);
    expect(isPermanentFailure(0)).toBe(false);
  });
});
```

- [x] **Step 3: 테스트 실패 확인**

Run: `npm run test -- refundRetryLedger`
Expected: FAIL ("isPermanentFailure is not exported")

- [x] **Step 4: 구현 — 영구 실패 판별 + releaseRefund 호출**

`src/entities/payment/api/refundRetry.ts`에 추가/수정:

```ts
import { releaseRefund } from "./ledger";

const MAX_ATTEMPTS = 8;
export function isPermanentFailure(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}
```

재시도 루프에서 PG cancel이 또 실패하고 `isPermanentFailure(attempts)`면: `RefundJob.status=FAILED` + `releaseRefund(tx, { paymentId, amount: job.amount })`로 예약 해제. 성공 시 기존대로 SUCCEEDED + Payment status 갱신(`refundedAmount >= amount ? CANCELED : PARTIAL_CANCELED`). 부분 환불(TRAVELER_CANCEL) 재시도 성공 시 traveler 표식/좌석 환원이 이미 settle 전에 안 됐다면 후처리 필요 — 단 현재 설계상 settle 후처리는 refundTraveler의 onSettled에서만 실행되므로, cron 재시도가 settle을 완료시킬 땐 traveler/좌석 후처리가 누락된다. → **cron 재시도 성공 경로에도 kind별 후처리 적용**(아래 Step 5).

- [x] **Step 5: cron 재시도 성공 시 kind별 후처리**

refundRetry의 성공 경로에서 `job.kind`로 분기:
- `DISCRETIONARY`: 후처리 없음.
- `TRAVELER_CANCEL`/`FULL_CANCEL`: `Traveler.canceledByRefundJobId == job.id`인 여행자 표식이 이미 있으면 스킵, 없으면 표식 + `releaseSeats(seatsReleased)` + (FULL_CANCEL이면) terminal 전이(skipSeatReturn). 멱등 위해 `canceledAt IS NULL` 가드.

```ts
if (job.kind === "TRAVELER_CANCEL" || job.kind === "FULL_CANCEL") {
  await db.$transaction(async (tx) => {
    const marked = await tx.traveler.updateMany({
      where: { canceledByRefundJobId: job.id, canceledAt: null },
      data: { canceledAt: new Date() },
    });
    if (marked.count > 0 && job.seatsReleased > 0) await releaseSeats(tx, job.departureId, job.seatsReleased);
    if (job.kind === "FULL_CANCEL") {
      await transitionStatusTx(tx, { bookingId: job.bookingId, to: job.actor?.startsWith("user:") ? "CANCELED_BY_USER" : "CANCELED_BY_AGENCY", actor: job.actor ?? "system:cron", skipSeatReturn: true }).catch(() => {});
    }
  });
}
```

> 주의: `RefundJob`에 `departureId`가 없으므로 booking join으로 가져오거나 job 조회 시 include. 구현 시 `db.refundJob.findUnique({ include: { booking: { select: { departureId: true } } } })`.

- [x] **Step 6: 테스트 통과 확인**

Run: `npm run test -- refundRetryLedger refundRetry && npm run typecheck`
Expected: PASS, typecheck PASS

- [x] **Step 7: Commit**

```bash
git add src/entities/payment/api/refundRetry.ts src/entities/payment/api/__tests__/refundRetryLedger.test.ts
git commit -m "feat(payment): refundRetry ledger release + kind-based post-settle"
```

---

## Task 12: Admin Server Actions — 여행자 취소 + 재량 환불

**Files:**
- Create: `src/features/admin-traveler-cancel/server/actions.ts`
- Create: `src/features/admin-discretionary-refund/server/actions.ts`
- Test: `src/features/admin-discretionary-refund/server/__tests__/actions.test.ts`

- [x] **Step 1: 실패 테스트 작성 (Zod 검증 + 권한 게이트)**

Create `src/features/admin-discretionary-refund/server/__tests__/actions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DiscretionaryRefundSchema } from "../actions";

describe("DiscretionaryRefundSchema", () => {
  it("양의 정수 금액만 허용", () => {
    expect(DiscretionaryRefundSchema.safeParse({ paymentId: "p1", bookingId: "b1", amount: 0, requestId: "r1" }).success).toBe(false);
    expect(DiscretionaryRefundSchema.safeParse({ paymentId: "p1", bookingId: "b1", amount: 500, requestId: "r1" }).success).toBe(true);
  });
  it("amount 비정수 거부", () => {
    expect(DiscretionaryRefundSchema.safeParse({ paymentId: "p1", bookingId: "b1", amount: 1.5, requestId: "r1" }).success).toBe(false);
  });
});
```

- [x] **Step 2: 테스트 실패 확인**

Run: `npm run test -- admin-discretionary-refund`
Expected: FAIL ("Cannot find module ../actions")

- [x] **Step 3: 구현 — discretionary action**

Create `src/features/admin-discretionary-refund/server/actions.ts`:

```ts
"use server";
import { z } from "zod";
import { auth } from "@/shared/lib/auth";
import { refundDiscretionary } from "@/entities/payment";
import { revalidatePath } from "next/cache";

export const DiscretionaryRefundSchema = z.object({
  paymentId: z.string().min(1),
  bookingId: z.string().min(1),
  amount: z.number().int().positive(),
  requestId: z.string().min(1),
  reason: z.string().optional(),
});

export async function discretionaryRefundAction(input: z.infer<typeof DiscretionaryRefundSchema>) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") throw new Error("FORBIDDEN");
  const data = DiscretionaryRefundSchema.parse(input);
  await refundDiscretionary({ ...data, actor: `admin:${session.user.id}` });
  revalidatePath(`/admin/bookings/${data.bookingId}`);
}
```

- [x] **Step 4: 구현 — traveler cancel action**

Create `src/features/admin-traveler-cancel/server/actions.ts`:

```ts
"use server";
import { z } from "zod";
import { auth } from "@/shared/lib/auth";
import { refundTraveler } from "@/entities/payment";
import { revalidatePath } from "next/cache";

export const TravelerCancelSchema = z.object({
  bookingId: z.string().min(1),
  travelerIds: z.array(z.string().min(1)).min(1),
  applyPenalty: z.boolean(),
  reason: z.string().optional(),
});

export async function travelerCancelAction(input: z.infer<typeof TravelerCancelSchema>) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") throw new Error("FORBIDDEN");
  const data = TravelerCancelSchema.parse(input);
  await refundTraveler({ ...data, actor: `admin:${session.user.id}` });
  revalidatePath(`/admin/bookings/${data.bookingId}`);
}
```

- [x] **Step 5: 테스트 통과 확인**

Run: `npm run test -- admin-discretionary-refund && npm run typecheck`
Expected: PASS, typecheck PASS

- [x] **Step 6: Commit**

```bash
git add src/features/admin-traveler-cancel/ src/features/admin-discretionary-refund/
git commit -m "feat(admin): traveler-cancel + discretionary-refund server actions"
```

---

## Task 13: booking-detail 위젯 — 여행자 취소 + 재량 환불 + 잔여액 UI

**Files:**
- Modify: `src/widgets/booking-detail/ui/BookingDetailView.tsx`
- Create: `src/widgets/booking-detail/ui/TravelerCancelPanel.tsx`, `DiscretionaryRefundPanel.tsx` (`'use client'` islands)

- [ ] **Step 1: 잔여 환불가능액 표시 (server 조립)**

`BookingDetailView.tsx`에 잔여액 표시 추가 — payment에서 `amount - refundedAmount` 계산해 표기. `refundableAmount` 헬퍼 재사용:

```tsx
import { refundableAmount } from "@/entities/payment";
// ...
<p>잔여 환불가능액: {refundableAmount(payment).toLocaleString()}원</p>
```

(`refundable.ts`를 `entities/payment/index.ts` 배럴에 export.)

- [ ] **Step 2: TravelerCancelPanel island (`'use client'`)**

Create `src/widgets/booking-detail/ui/TravelerCancelPanel.tsx`: 활성 여행자(canceledAt=null) 체크박스 목록 + 위약금 적용 토글 + 제출. `useTransition`으로 pending 처리, `travelerCancelAction` 호출. 취소된 여행자는 비활성 표기.

```tsx
"use client";
import { useState, useTransition } from "react";
import { travelerCancelAction } from "@/features/admin-traveler-cancel/server/actions";

interface T { id: string; firstNameEn: string; lastNameEn: string; paxType: string | null; unitPrice: number; canceledAt: string | null; }

export function TravelerCancelPanel({ bookingId, travelers }: { bookingId: string; travelers: T[] }) {
  const [sel, setSel] = useState<string[]>([]);
  const [applyPenalty, setApplyPenalty] = useState(true);
  const [pending, start] = useTransition();
  const active = travelers.filter((t) => !t.canceledAt);

  return (
    <div>
      {active.map((t) => (
        <label key={t.id}>
          <input type="checkbox" checked={sel.includes(t.id)}
            onChange={(e) => setSel((s) => e.target.checked ? [...s, t.id] : s.filter((x) => x !== t.id))} />
          {t.lastNameEn} {t.firstNameEn} ({t.paxType}) {t.unitPrice.toLocaleString()}원
        </label>
      ))}
      <label><input type="checkbox" checked={applyPenalty} onChange={(e) => setApplyPenalty(e.target.checked)} /> 위약금 적용</label>
      <button disabled={pending || sel.length === 0}
        onClick={() => start(() => travelerCancelAction({ bookingId, travelerIds: sel, applyPenalty }).then(() => setSel([])))}>
        {pending ? "처리 중..." : "선택 여행자 취소"}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: DiscretionaryRefundPanel island**

Create `src/widgets/booking-detail/ui/DiscretionaryRefundPanel.tsx`: 금액 입력 + requestId(`useRef(crypto.randomUUID())` 마운트 시 1회 생성) + 잔여액 초과 클라 가드 + 제출. 좌석 미변동 경고 배너(spec R3).

```tsx
"use client";
import { useRef, useState, useTransition } from "react";
import { discretionaryRefundAction } from "@/features/admin-discretionary-refund/server/actions";

export function DiscretionaryRefundPanel({ bookingId, paymentId, refundable }: { bookingId: string; paymentId: string; refundable: number }) {
  const requestId = useRef(crypto.randomUUID());
  const [amount, setAmount] = useState(0);
  const [pending, start] = useTransition();
  return (
    <div>
      <p style={{ color: "#b45309" }}>⚠️ 재량 환불은 좌석/예약 인원을 변경하지 않습니다(순수 금액 환불).</p>
      <input type="number" max={refundable} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
      <button disabled={pending || amount <= 0 || amount > refundable}
        onClick={() => start(() => discretionaryRefundAction({ bookingId, paymentId, amount, requestId: requestId.current }))}>
        {pending ? "처리 중..." : `${amount.toLocaleString()}원 환불`}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: BookingDetailView에 두 패널 조립**

`BookingDetailView.tsx`에서 payment가 PAID/PARTIAL_CANCELED일 때 두 island 렌더. travelers/refundable를 props로 전달.

- [ ] **Step 5: 빌드/타입 검증**

Run: `npm run typecheck && npm run lint`
Expected: PASS. `grep -rn "use client" src/widgets/booking-detail/ui/`로 island만 client인지 확인(`entities/**/ui` 금지 규칙 무관 — widgets 레이어).

- [ ] **Step 6: Commit**

```bash
git add src/widgets/booking-detail/
git commit -m "feat(booking-detail): traveler-cancel + discretionary-refund UI islands"
```

---

## Task 14: 통합 검증 + ADR-0036

**Files:**
- Create: `docs/superpowers/adr/0036-ledger-multiple-partial-refunds.md`
- Modify: `docs/superpowers/adr/README.md`

- [ ] **Step 1: 전체 테스트 + typecheck + lint**

Run: `npm run typecheck && npm run test && npm run lint`
Expected: 전부 PASS. 신규 테스트(paxAssignment, refundKeys, ledger, transitionSkipSeats, refundLedger, refundTraveler, refundRetryLedger, admin-discretionary) 모두 GREEN.

- [ ] **Step 2: 동시성 런타임 증거 — 동시 부분환불 2건 합 ≤ amount**

Mock 서버(localhost:4242) 기동 후 동일 payment에 동시 환불 2건을 쏴서 `refundedAmount ≤ amount` 확인:
```bash
npx tsx -e "import {db} from './src/shared/lib/db'; import {refundDiscretionary} from './src/entities/payment'; (async()=>{const p=await db.payment.findFirst({where:{status:'PAID'}}); if(!p)return console.log('no PAID'); await Promise.allSettled([refundDiscretionary({bookingId:p.bookingId,paymentId:p.id,amount:Math.ceil(p.amount*0.7),actor:'admin:test',requestId:'c1'}),refundDiscretionary({bookingId:p.bookingId,paymentId:p.id,amount:Math.ceil(p.amount*0.7),actor:'admin:test',requestId:'c2'})]); const after=await db.payment.findUnique({where:{id:p.id}}); console.log('amount',after!.amount,'refunded',after!.refundedAmount, after!.refundedAmount<=after!.amount?'OK':'OVER-REFUND'); process.exit(0)})()"
```
Expected: `... OK` (한 건만 성공, 합이 amount 미초과).

- [ ] **Step 3: ADR-0036 작성**

`docs/superpowers/adr/template.md` 복사해 `0036-ledger-multiple-partial-refunds.md` 작성. 4섹션:
- **Context:** 단일-취소 모델 한계, 다회 부분환불 필요.
- **Decision:** Payment.refundedAmount 물질화 카운터 + RefundJob 원장화 + Traveler.unitPrice 스냅샷 + 조건부 차감 동시성 + 부분 base 위약금 + non-terminal 상태머신.
- **Consequences:** 좌석 이중환원 스킵 옵션 도입, 부분환불 메일 비범위, DISCRETIONARY 좌석 불변.
- **Alternatives Considered:** 순수-파생 SUM(거부: 락+왕복), explicit version 락(거부: 조건부 차감이 원자적이라 잉여), Departure 현재가 복원(거부: ADR-0027 D2 위반), 전체액 기준 위약금(거부: 부분취소 과징).

- [ ] **Step 4: README 인덱스 + CLAUDE.md 갱신**

`docs/superpowers/adr/README.md`에 ADR-0036 한 줄 추가. `CLAUDE.md` §8에 Phase 8 완료 + "다음 작업자 혼란 방지" 노트 추가(부분환불 메일 비범위, DISCRETIONARY 좌석 불변, 좌석 이중환원 스킵 옵션 이유).

- [ ] **Step 5: 체크박스 누락 점검 + 최종 커밋**

Run: `grep -n "\- \[ \]" docs/superpowers/plans/2026-06-04-multiple-partial-refunds-plan.md`
Expected: 완료된 태스크에 미체크 0건.

```bash
git add docs/superpowers/adr/ docs/superpowers/plans/ CLAUDE.md
git commit -m "docs(adr): 0036 ledger multiple partial refunds + phase8 close-out"
```

---

## Self-Review 결과 (작성자 점검)

- **Spec coverage:** D1(Task1,5,7,8)·D2(Task5,9)·D3(Task3,10)·D4(Task4,9)·D5(Task6,10,11) / backfill(Task8) / 멱등(Task4,9) / 상태머신(Task6,10,11) / UI(Task12,13) / ADR(Task14) — 전부 매핑됨.
- **Placeholder scan:** 모든 코드 스텝에 실제 코드 포함. "적절한 에러처리" 류 없음.
- **Type consistency:** `assignPaxTypes`/`PaxAssignment`/`reserveRefund`/`releaseRefund`/`runRefundSaga`/`computeCanceledBase`/`refundTraveler`/`refundDiscretionary` 시그니처가 태스크 간 일관. `idempotencyKey` 생성기 3종이 Task4 정의와 Task9/10 사용처 일치.
- **알려진 후속(비범위):** 부분환불 전용 메일(`PARTIAL_REFUND_COMPLETED`), 고객 셀프 부분취소 UI — spec §2 비목표 / §8 R2에 박제.
