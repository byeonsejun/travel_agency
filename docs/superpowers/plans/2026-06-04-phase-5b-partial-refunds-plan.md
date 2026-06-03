# Phase 5-B — 부분 환불 및 위약금 정책 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 국외여행 표준약관 기준 시간경과 위약금을 자가취소 환불에 적용하고, Toss 부분취소(`cancelAmount = total − penalty`) + `PARTIAL_CANCELED` 상태 + 위약금 스냅샷 동결을 구현한다.

**Architecture:** 순수 정책 엔진(`penaltyPolicy.ts`)이 위약금/환불액을 산출 → 사가 진입(`refundBooking`)이 enqueue 시점에 `RefundJob.amount`(환불액)/`penaltyAmount`로 **동결** → Phase 2에서 환불액만 Toss 취소 → Phase 3에서 `penaltyAmount>0` 여부로 `PARTIAL_CANCELED`/`CANCELED` 분기. cron 재시도는 스냅샷을 재계산 없이 신뢰. UI는 RSC가 동일 순수함수로 미리보기를 주입하고 Server Action이 실행 시점에 권위 재계산.

**Tech Stack:** Next.js 15 App Router, Prisma 5 + PostgreSQL, Zod 3, Vitest 2 (TDD), Toss Payments(Mock/sandbox only — §5 NO-REAL-MONEY).

**Spec:** `docs/superpowers/specs/2026-06-04-phase-5b-partial-refunds.md`

---

## 파일 구조 (File Structure)

| 종류 | 파일 | 책임 |
|---|---|---|
| 신규 | `src/entities/payment/model/penaltyPolicy.ts` | 위약금 정책 SSOT 테이블 + `computePenalty` 순수 함수 |
| 신규 | `src/entities/payment/model/__tests__/penaltyPolicy.test.ts` | 경계값·불변식 단위 테스트 |
| 스키마 | `prisma/schema.prisma` | `PaymentStatus.PARTIAL_CANCELED`, `RefundJob.penaltyAmount` |
| 스키마 | `prisma/migrations/<ts>_phase5b_partial_refund/migration.sql` | 수동 마이그레이션 |
| 사가 | `src/entities/payment/api/refund.ts` | `applyPenalty` 분기 + 위약금 동결 + 상태 분기 |
| 사가 | `src/entities/payment/api/refundRetry.ts` | 스냅샷 기반 재시도(무재계산) + 상태 분기 |
| 메일 | `src/entities/payment/api/getRefundCompletedEmailData.ts` | PARTIAL_CANCELED 포함 + RefundJob 출처 환불액 |
| 메일 | `src/shared/email/templates/types.ts`, `RefundCompletedEmail.tsx` | `penaltyAmount` props + 조건부 라인 |
| Action | `src/features/booking-cancel/server/actions.ts` | `applyPenalty: true` |
| Action | `src/features/admin-booking-cancel/{server/actions.ts,model/schemas.ts}` | `waivePenalty` 토글 |
| UI | `src/widgets/booking-detail/ui/BookingDetailView.tsx` | 미리보기 계산·주입 |
| UI | `src/features/booking-cancel/ui/CancelBookingButton.tsx` | 미리보기 표시 |
| barrel | `src/entities/payment/index.ts` | `computePenalty` 노출 |
| Mock(선택) | `scripts/qa/mock-toss-server.ts` | 부분취소 시 `PARTIAL_CANCELED` 반환 |
| ADR | `docs/superpowers/adr/0031-penalty-snapshot-partial-cancel.md` | 결정 박제 |

각 페르소나 활성: 💳 Domain Booking(전 태스크), 🏛️ Architect(barrel/레이어), ⚙️ Backend(사가/스키마/Action), 🎨 Frontend(UI), 🔬 QA(완료 직전).

---

## Task 1: 위약금 정책 엔진 (순수 함수)

**Files:**
- Create: `src/entities/payment/model/penaltyPolicy.ts`
- Test: `src/entities/payment/model/__tests__/penaltyPolicy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/entities/payment/model/__tests__/penaltyPolicy.test.ts
import { describe, it, expect } from "vitest";
import { computePenalty } from "../penaltyPolicy";

// 출발일 2026-07-01 (KST 자정). now를 바꿔 D-day 구간을 검증.
const departureDate = new Date("2026-07-01T00:00:00+09:00");
const base = 1_000_000; // 100만원

function at(daysBefore: number): Date {
  // 출발일 KST 자정에서 daysBefore일 전의 정오(자정 경계 오차 회피)
  return new Date(departureDate.getTime() - daysBefore * 86_400_000 + 12 * 3_600_000);
}

describe("computePenalty — 국외여행 표준약관 구간", () => {
  it("D≥30: 위약금 0%", () => {
    const r = computePenalty({ baseAmount: base, departureDate, now: at(30) });
    expect(r.rate).toBe(0);
    expect(r.penaltyAmount).toBe(0);
    expect(r.refundAmount).toBe(base);
  });

  it("D=29: 10%", () => {
    expect(computePenalty({ baseAmount: base, departureDate, now: at(29) }).rate).toBe(0.1);
  });

  it("D=20: 10%", () => {
    expect(computePenalty({ baseAmount: base, departureDate, now: at(20) }).rate).toBe(0.1);
  });

  it("D=19: 15%", () => {
    expect(computePenalty({ baseAmount: base, departureDate, now: at(19) }).rate).toBe(0.15);
  });

  it("D=10: 15%", () => {
    expect(computePenalty({ baseAmount: base, departureDate, now: at(10) }).rate).toBe(0.15);
  });

  it("D=9: 20%", () => {
    expect(computePenalty({ baseAmount: base, departureDate, now: at(9) }).rate).toBe(0.2);
  });

  it("D=8: 20%", () => {
    expect(computePenalty({ baseAmount: base, departureDate, now: at(8) }).rate).toBe(0.2);
  });

  it("D=7: 30%", () => {
    expect(computePenalty({ baseAmount: base, departureDate, now: at(7) }).rate).toBe(0.3);
  });

  it("D=1: 30%", () => {
    expect(computePenalty({ baseAmount: base, departureDate, now: at(1) }).rate).toBe(0.3);
  });

  it("D=0 (당일): 50%", () => {
    const r = computePenalty({ baseAmount: base, departureDate, now: at(0) });
    expect(r.rate).toBe(0.5);
    expect(r.penaltyAmount).toBe(500_000);
    expect(r.refundAmount).toBe(500_000);
  });

  it("D<0 (출발 후): 50%", () => {
    expect(computePenalty({ baseAmount: base, departureDate, now: at(-3) }).rate).toBe(0.5);
  });

  it("불변식: penalty + refund === base, 모두 정수", () => {
    const r = computePenalty({ baseAmount: 999_999, departureDate, now: at(5) }); // 30%
    expect(Number.isInteger(r.penaltyAmount)).toBe(true);
    expect(Number.isInteger(r.refundAmount)).toBe(true);
    expect(r.penaltyAmount + r.refundAmount).toBe(999_999);
    // floor: 999999 * 0.3 = 299999.7 → 299999
    expect(r.penaltyAmount).toBe(299_999);
    expect(r.refundAmount).toBe(700_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- penaltyPolicy`
Expected: FAIL — `computePenalty` is not defined / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/entities/payment/model/penaltyPolicy.ts
/**
 * 국외여행 표준약관(소비자분쟁해결기준) 기준 시간경과 위약금 정책 — 순수 함수.
 * 외부 IO 0. now를 주입받아 테스트 결정성을 보장한다. (spec §3)
 */

/** 출발일까지 남은 일수(minDaysBefore) 하한 이상이면 해당 rate. 내림차순 첫 매칭. */
export const OVERSEAS_PENALTY_TIERS = [
  { minDaysBefore: 30, rate: 0.0 },
  { minDaysBefore: 20, rate: 0.1 },
  { minDaysBefore: 10, rate: 0.15 },
  { minDaysBefore: 8, rate: 0.2 },
  { minDaysBefore: 1, rate: 0.3 },
  { minDaysBefore: Number.NEGATIVE_INFINITY, rate: 0.5 }, // 당일(D≤0) 포함
] as const;

export interface PenaltyInput {
  /** 위약금 산정 기준액(원 단위 정수) = 결제 금액. */
  baseAmount: number;
  /** 출발일(@db.Date). KST 자정 기준으로 해석. */
  departureDate: Date;
  /** 취소 통보 시각(주입). */
  now: Date;
}

export interface PenaltyResult {
  daysBefore: number;
  rate: number;
  penaltyAmount: number;
  refundAmount: number;
}

const DAY_MS = 86_400_000;

/** 출발일 KST 자정 − now 를 일 단위로 내림. departureDate는 UTC 0시로 저장되므로 KST(+9h) 보정. */
function daysUntil(departureDate: Date, now: Date): number {
  // @db.Date는 UTC 자정으로 저장된다. KST 자정 = UTC 전날 15:00.
  const departKstMidnightUtc = departureDate.getTime() - 9 * 3_600_000;
  return Math.floor((departKstMidnightUtc - now.getTime()) / DAY_MS);
}

export function computePenalty(input: PenaltyInput): PenaltyResult {
  const { baseAmount, departureDate, now } = input;
  const daysBefore = daysUntil(departureDate, now);
  const tier =
    OVERSEAS_PENALTY_TIERS.find((t) => daysBefore >= t.minDaysBefore) ??
    OVERSEAS_PENALTY_TIERS[OVERSEAS_PENALTY_TIERS.length - 1];
  const penaltyAmount = Math.floor(baseAmount * tier.rate);
  return {
    daysBefore,
    rate: tier.rate,
    penaltyAmount,
    refundAmount: baseAmount - penaltyAmount,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- penaltyPolicy`
Expected: PASS (모든 케이스). 만약 D-day 경계가 어긋나면 `daysUntil`의 KST 보정과 테스트 `at()`의 정오 오프셋을 확인.

- [ ] **Step 5: Commit**

```bash
git add src/entities/payment/model/penaltyPolicy.ts src/entities/payment/model/__tests__/penaltyPolicy.test.ts
git commit -m "feat(payment): add overseas-travel penalty policy engine (pure fn)"
```

---

## Task 2: 스키마 마이그레이션 (PARTIAL_CANCELED + penaltyAmount)

**Files:**
- Modify: `prisma/schema.prisma` (PaymentStatus enum, RefundJob model)
- Create: `prisma/migrations/<timestamp>_phase5b_partial_refund/migration.sql`

> shadow DB(pgvector) 제약으로 `migrate dev` 불가 → db push + 수동 SQL + resolve 3-step ([[project_prisma_migration_workaround]]).

- [ ] **Step 1: Edit `prisma/schema.prisma` — enum 값 추가**

`PaymentStatus`에 `PARTIAL_CANCELED` 추가 (CANCELED 다음 줄):

```prisma
enum PaymentStatus {
  PENDING
  PAID
  CANCELED
  PARTIAL_CANCELED
  FAILED
}
```

- [ ] **Step 2: Edit `prisma/schema.prisma` — RefundJob.penaltyAmount 추가**

`RefundJob` 모델의 `amount Int` 줄 주석을 갱신하고 바로 아래 `penaltyAmount` 추가:

```prisma
  amount    Int // 실제 환불액 = baseAmount − penaltyAmount (위약금 0이면 결제 전액)
  penaltyAmount Int @default(0) // 취소 요청 시점 동결된 위약금 스냅샷 (spec §4)
```

- [ ] **Step 3: dev DB에 반영 + 클라이언트 재생성**

Run: `npx prisma db push && npx prisma generate`
Expected: "Your database is now in sync" + Prisma Client 재생성. 데이터 손실 경고 없음(추가만).

- [ ] **Step 4: 수동 마이그레이션 SQL 작성**

디렉터리 생성 후 파일 작성 (`<ts>`는 `date +%Y%m%d%H%M%S`):

```sql
-- prisma/migrations/<ts>_phase5b_partial_refund/migration.sql
-- ALTER TYPE ... ADD VALUE는 트랜잭션 밖에서 실행되어야 한다(Postgres 제약).
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PARTIAL_CANCELED';

ALTER TABLE "RefundJob" ADD COLUMN IF NOT EXISTS "penaltyAmount" INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 5: 마이그레이션 히스토리 정합**

Run: `npx prisma migrate resolve --applied <ts>_phase5b_partial_refund`
Expected: "Migration marked as applied".

- [ ] **Step 6: typecheck 통과 확인**

Run: `npm run typecheck`
Expected: PASS — 생성된 타입에 `PARTIAL_CANCELED`, `penaltyAmount` 반영.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(payment): add PARTIAL_CANCELED status + RefundJob.penaltyAmount snapshot"
```

---

## Task 3: 사가 진입점 `refundBooking` 확장 (applyPenalty + 동결)

**Files:**
- Modify: `src/entities/payment/api/refund.ts`
- Test: `src/entities/payment/api/__tests__/refund.test.ts`

- [ ] **Step 1: Write the failing test (기존 파일에 추가)**

기존 테스트의 `refundBooking` 호출에 `applyPenalty` 인자가 추가되어야 한다. 신규 케이스 추가:

```ts
// src/entities/payment/api/__tests__/refund.test.ts 에 describe 블록 추가
describe("refundBooking — 부분 환불(위약금)", () => {
  it("applyPenalty=true & D-3(30%) → RefundJob.amount=환불액, penaltyAmount 저장, Payment PARTIAL_CANCELED", async () => {
    // Arrange: PAID booking, departureDate 3일 후, payment.amount=1_000_000
    // (기존 테스트의 셋업 헬퍼 재사용 — booking/payment/departure 시드)
    const { bookingId } = await seedPaidBooking({
      amount: 1_000_000,
      departureDate: new Date(Date.now() + 3 * 86_400_000),
    });

    await refundBooking({ bookingId, actor: "user:u1", reason: "변심", applyPenalty: true });

    const job = await db.refundJob.findFirstOrThrow({ where: { bookingId } });
    expect(job.amount).toBe(700_000);       // 환불액
    expect(job.penaltyAmount).toBe(300_000); // 위약금 30%
    const payment = await db.payment.findFirstOrThrow({ where: { bookingId } });
    expect(payment.status).toBe("PARTIAL_CANCELED");
    // Toss cancel은 환불액만큼만 호출
    expect(tossCancelSpy).toHaveBeenCalledWith(
      expect.objectContaining({ cancelAmount: 700_000 })
    );
  });

  it("applyPenalty=true & D-40(0%) → penaltyAmount=0, Payment CANCELED, 전액 환불", async () => {
    const { bookingId } = await seedPaidBooking({
      amount: 500_000,
      departureDate: new Date(Date.now() + 40 * 86_400_000),
    });
    await refundBooking({ bookingId, actor: "user:u1", applyPenalty: true });
    const job = await db.refundJob.findFirstOrThrow({ where: { bookingId } });
    expect(job.penaltyAmount).toBe(0);
    expect(job.amount).toBe(500_000);
    const payment = await db.payment.findFirstOrThrow({ where: { bookingId } });
    expect(payment.status).toBe("CANCELED");
  });

  it("applyPenalty=false → 위약금 무관 전액 환불 + CANCELED (기존 동작)", async () => {
    const { bookingId } = await seedPaidBooking({
      amount: 500_000,
      departureDate: new Date(Date.now() + 2 * 86_400_000), // 가까워도 면제
    });
    await refundBooking({ bookingId, actor: "admin:a1", applyPenalty: false });
    const job = await db.refundJob.findFirstOrThrow({ where: { bookingId } });
    expect(job.penaltyAmount).toBe(0);
    expect(job.amount).toBe(500_000);
  });
});
```

> 셋업 헬퍼 `seedPaidBooking`이 기존 테스트에 없으면, 기존 테스트가 쓰는 픽스처 패턴을 그대로 따라 departureDate를 파라미터화해 추가한다. tossClient.cancel은 기존 테스트의 mock(`tossCancelSpy`) 방식을 재사용.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- refund.test`
Expected: FAIL — `applyPenalty` 미지원 / `penaltyAmount` 미저장 / Payment 항상 CANCELED.

- [ ] **Step 3: Implement — `refund.ts` 수정**

(a) import 추가:

```ts
import { computePenalty } from "../model/penaltyPolicy";
```

(b) `RefundInput`에 `applyPenalty` 추가:

```ts
interface RefundInput {
  bookingId: string;
  actor: string;
  reason?: string;
  applyPenalty: boolean;
}
```

(c) 사전 조회 2를 확장 — booking 조회 시 `departure.departureDate`도 가져온다. 기존 `db.booking.findUnique`의 select에 추가:

```ts
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      departure: { select: { departureDate: true } },
    },
  });
```

(d) PAID payment 조회 후, 위약금 산출 블록 추가 (Phase 1 enqueue 직전):

```ts
  // ── 위약금 동결: applyPenalty면 표준약관 계산, 아니면 전액 환불 ──
  const { penaltyAmount, refundAmount } = applyPenalty
    ? computePenalty({
        baseAmount: paidPayment.amount,
        departureDate: booking.departure.departureDate,
        now: new Date(),
      })
    : { penaltyAmount: 0, refundAmount: paidPayment.amount };
```

(e) Phase 1 `tx.refundJob.create`의 data에 반영:

```ts
      data: {
        bookingId,
        paymentId: paidPayment.id,
        amount: refundAmount,      // ← 환불액
        penaltyAmount,             // ← 동결 스냅샷
        reason: reason ?? null,
        actor,
        status: "IN_PROGRESS",
      },
```

(f) Phase 2 `tossClient.cancel`의 `cancelAmount`를 환불액으로:

```ts
    await tossClient.cancel({
      paymentKey: paidPayment.tossPaymentKey,
      cancelReason: reason ?? "사용자 환불 요청",
      cancelAmount: refundAmount,
    });
```

(g) Phase 3 Payment 상태 분기 + PaymentEvent payload 감사:

```ts
    await tx.payment.update({
      where: { id: paidPayment.id },
      data: {
        status: penaltyAmount > 0 ? "PARTIAL_CANCELED" : "CANCELED",
        canceledAt: new Date(),
      },
    });
    // ... refundJob SUCCEEDED ...
    await tx.paymentEvent.create({
      data: {
        providerEventId: `refund:${paidPayment.id}:${Date.now()}`,
        bookingId,
        paymentId: paidPayment.id,
        type: "REFUND_REQUEST",
        payload: {
          bookingId, reason: reason ?? null, actor,
          baseAmount: paidPayment.amount, penaltyAmount, refundAmount,
        } as unknown as Prisma.InputJsonValue,
        result: "PROCESSED",
      },
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- refund.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/entities/payment/api/refund.ts src/entities/payment/api/__tests__/refund.test.ts
git commit -m "feat(payment): apply penalty + partial cancel in refundBooking entry"
```

---

## Task 4: 재시도 worker `retryRefundJob` 확장 (스냅샷 기반)

**Files:**
- Modify: `src/entities/payment/api/refundRetry.ts`
- Test: `src/entities/payment/api/__tests__/refundRetry.test.ts`

- [ ] **Step 1: Write the failing test (추가)**

```ts
describe("retryRefundJob — 부분 환불 스냅샷", () => {
  it("penaltyAmount>0 job → cancelAmount=job.amount, Payment PARTIAL_CANCELED (재계산 없음)", async () => {
    const { jobId, paymentKey } = await seedPendingRefundJob({
      amount: 700_000,
      penaltyAmount: 300_000,
    });
    const res = await retryRefundJob(jobId);
    expect(res.type).toBe("succeeded");
    expect(tossCancelSpy).toHaveBeenCalledWith(
      expect.objectContaining({ paymentKey, cancelAmount: 700_000 })
    );
    const payment = await db.payment.findFirstOrThrow({ where: { tossPaymentKey: paymentKey } });
    expect(payment.status).toBe("PARTIAL_CANCELED");
  });

  it("penaltyAmount=0 job → Payment CANCELED (기존 cascade 경로)", async () => {
    const { jobId } = await seedPendingRefundJob({ amount: 500_000, penaltyAmount: 0 });
    await retryRefundJob(jobId);
    // Payment CANCELED 검증
  });

  it("Payment가 이미 PARTIAL_CANCELED → job 정리 후 skip", async () => {
    const { jobId } = await seedPendingRefundJob({
      amount: 700_000, penaltyAmount: 300_000, paymentStatus: "PARTIAL_CANCELED",
    });
    const res = await retryRefundJob(jobId);
    expect(res.type).toBe("skipped");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- refundRetry.test`
Expected: FAIL — Payment 항상 CANCELED / PARTIAL_CANCELED short-circuit 없음.

- [ ] **Step 3: Implement — `refundRetry.ts` 수정**

(a) Short-circuit 1 보강 — `payment.status` 비교에 PARTIAL_CANCELED 포함:

```ts
  if (job.payment.status === "CANCELED" || job.payment.status === "PARTIAL_CANCELED") {
    await db.refundJob.update({
      where: { id: jobId },
      data: { status: "SUCCEEDED", lastError: "payment already (partial-)canceled; cleaned up by retry worker" },
    });
    metrics.incr("payment.refund.retry.already_canceled");
    return { type: "skipped", jobId, reason: "payment_already_canceled" };
  }
```

(b) Phase 2 cancelAmount는 이미 `job.payment.amount`였던 것을 `job.amount`(환불액 스냅샷)로 교체:

```ts
    await tossClient.cancel({
      paymentKey: job.payment.tossPaymentKey,
      cancelReason: job.reason ?? "환불 처리 재시도",
      cancelAmount: job.amount,
    });
```

> `findUniqueOrThrow`의 include에 이미 `payment.amount`가 있으나, cancelAmount는 `job.amount`(RefundJob 컬럼)를 써야 한다 — payment.amount는 원결제액이라 부분환불에서 틀린다.

(c) Phase 3 Payment 상태 분기:

```ts
    await tx.payment.update({
      where: { id: job.paymentId },
      data: {
        status: job.penaltyAmount > 0 ? "PARTIAL_CANCELED" : "CANCELED",
        canceledAt: new Date(),
      },
    });
```

(d) PaymentEvent payload에 금액 감사 추가:

```ts
        payload: {
          bookingId: job.bookingId, reason: job.reason,
          actor: job.actor ?? "system:refund-retry",
          retryAttempt: job.attempts,
          penaltyAmount: job.penaltyAmount, refundAmount: job.amount,
        } as unknown as Prisma.InputJsonValue,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- refundRetry.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/entities/payment/api/refundRetry.ts src/entities/payment/api/__tests__/refundRetry.test.ts
git commit -m "feat(payment): partial-cancel aware retry worker (snapshot, no recompute)"
```

---

## Task 5: Server Actions 분기 (자가취소 + admin 토글)

**Files:**
- Modify: `src/features/booking-cancel/server/actions.ts` (`applyPenalty: true`)
- Modify: `src/features/admin-booking-cancel/model/schemas.ts` (`waivePenalty`)
- Modify: `src/features/admin-booking-cancel/server/actions.ts` (`applyPenalty: !waivePenalty`)

- [ ] **Step 1: 자가취소 — `applyPenalty: true` 전달**

`cancelBookingAction`의 `refundBooking` 호출(현 line ~87)에 인자 추가:

```ts
      await refundBooking({
        bookingId,
        actor: `user:${userId}`,
        reason,
        applyPenalty: true,
      });
```

- [ ] **Step 2: admin 스키마에 `waivePenalty` 추가**

`AdminCancelBookingSchema`에 필드 추가 (기본 false=부과):

```ts
// src/features/admin-booking-cancel/model/schemas.ts
export const AdminCancelBookingSchema = z.object({
  bookingId: z.string().min(1),
  reason: z.string().min(1).max(200),
  waivePenalty: z.boolean().default(false),
});
```

- [ ] **Step 3: admin 액션에서 분기 전달**

`adminCancelBookingAction`에서 parsed 구조분해에 `waivePenalty` 추가 후 호출:

```ts
  const { bookingId, reason, waivePenalty } = parsed.data;
  // ...
      await refundBooking({
        bookingId,
        actor: `admin:${adminId}`,
        reason,
        applyPenalty: !waivePenalty,
      });
```

- [ ] **Step 4: typecheck + 관련 테스트**

Run: `npm run typecheck && npm run test -- admin-booking-cancel booking-cancel`
Expected: PASS. 기존 액션 테스트가 `refundBooking` mock 인자를 검증한다면 `applyPenalty` 기대값 반영.

- [ ] **Step 5: Commit**

```bash
git add src/features/booking-cancel/server/actions.ts src/features/admin-booking-cancel/
git commit -m "feat(cancel): wire applyPenalty (user=true, admin=waive toggle)"
```

---

## Task 6: 미리보기 UI (RSC 주입 + 다이얼로그 표시 + admin 토글)

**Files:**
- Modify: `src/entities/payment/index.ts` (barrel — `computePenalty` + 타입 노출)
- Modify: `src/widgets/booking-detail/ui/BookingDetailView.tsx` (미리보기 계산·주입)
- Modify: `src/features/booking-cancel/ui/CancelBookingButton.tsx` (미리보기 표시)

- [ ] **Step 1: barrel에 `computePenalty` 노출**

`src/entities/payment/index.ts`에 추가 (도메인 타입 섹션 근처):

```ts
// ── 위약금 정책 (순수) ─────────────────────────────────────────
export { computePenalty, OVERSEAS_PENALTY_TIERS } from "./model/penaltyPolicy";
export type { PenaltyResult, PenaltyInput } from "./model/penaltyPolicy";
```

- [ ] **Step 2: 위젯에서 미리보기 계산 + props 주입**

`BookingDetailView.tsx`:
- import 추가: `import { PaymentStatusBadge, computePenalty } from "@/entities/payment";`
- `cancelable` 계산 직후, PAID payment를 찾아 미리보기 산출:

```ts
  // 자가취소 미리보기: PAID 결제 + 출발일로 위약금/환불액을 RSC에서 미리 계산.
  // 실제 동결은 Server Action이 실행 시점에 권위 재계산(spec §6.1).
  const paidForPreview = booking.payments.find((p) => p.status === "PAID");
  const refundPreview = paidForPreview
    ? computePenalty({
        baseAmount: paidForPreview.amount,
        departureDate: booking.departure.departureDate,
        now: new Date(),
      })
    : null;
```

- `CancelBookingButton` 호출(현 line ~157)에 props 전달:

```tsx
          <CancelBookingButton bookingId={booking.id} refundPreview={refundPreview} />
```

- [ ] **Step 3: `CancelBookingButton`에 미리보기 표시**

Props 타입 + 다이얼로그 본문에 미리보기 블록 추가:

```tsx
import type { PenaltyResult } from "@/entities/payment";

type Props = {
  bookingId: string;
  refundPreview?: PenaltyResult | null;
};

export function CancelBookingButton({ bookingId, refundPreview }: Props) {
```

다이얼로그 안내문(`취소 후에는 좌석이...`) 아래에 삽입:

```tsx
            {refundPreview && (
              <div className="mt-3 rounded-lg bg-slate-50 px-4 py-3 text-sm">
                {refundPreview.penaltyAmount > 0 ? (
                  <>
                    <p className="text-gray-700">
                      환불 예정 <strong className="text-gray-900">{refundPreview.refundAmount.toLocaleString("ko-KR")}원</strong>
                    </p>
                    <p className="mt-1 text-amber-700">
                      위약금 {refundPreview.penaltyAmount.toLocaleString("ko-KR")}원 공제
                      (출발 D-{Math.max(refundPreview.daysBefore, 0)}, {Math.round(refundPreview.rate * 100)}%)
                    </p>
                  </>
                ) : (
                  <p className="font-medium text-emerald-700">
                    전액 환불 ({refundPreview.refundAmount.toLocaleString("ko-KR")}원)
                  </p>
                )}
              </div>
            )}
```

- [ ] **Step 4: admin 취소 폼에 위약금 면제 토글 (해당 UI 존재 시)**

admin 단건취소 UI 컴포넌트(`features/admin-booking-cancel/ui/*`)에 체크박스 추가하고 dispatch payload에 `waivePenalty` 포함. 컴포넌트가 아직 없으면 이 스텝은 액션 스키마 기본값(false=부과)으로 동작하므로 후속 처리 — 존재 여부를 `ls src/features/admin-booking-cancel/ui` 로 먼저 확인.

```bash
ls src/features/admin-booking-cancel/ui 2>/dev/null
```

존재하면 폼 컴포넌트에:

```tsx
<label className="flex items-center gap-2 text-sm">
  <input type="checkbox" checked={waivePenalty} onChange={(e) => setWaivePenalty(e.target.checked)} />
  위약금 면제 (여행사 귀책)
</label>
```
그리고 `dispatch({ bookingId, reason, waivePenalty })`.

- [ ] **Step 5: typecheck + 빌드 확인**

Run: `npm run typecheck`
Expected: PASS — `PenaltyResult` import·props 타입 일치.

- [ ] **Step 6: Commit**

```bash
git add src/entities/payment/index.ts src/widgets/booking-detail/ src/features/booking-cancel/ui/ src/features/admin-booking-cancel/
git commit -m "feat(cancel): refund/penalty preview in cancel dialog + admin waive toggle"
```

---

## Task 7: 환불완료 메일 정합성 수정 (PARTIAL_CANCELED + 실환불액)

**Files:**
- Modify: `src/entities/payment/api/getRefundCompletedEmailData.ts`
- Modify: `src/shared/email/templates/types.ts` (`penaltyAmount`)
- Modify: `src/shared/email/templates/RefundCompletedEmail.tsx` (조건부 라인)
- Test: `src/entities/payment/api/__tests__/getRefundCompletedEmailData.test.ts`

- [ ] **Step 1: Write the failing test (추가)**

```ts
describe("getRefundCompletedEmailData — 부분 환불", () => {
  it("PARTIAL_CANCELED 결제 + SUCCEEDED RefundJob → 실환불액·위약금 보고", async () => {
    const { bookingId } = await seedRefundedBooking({
      paymentStatus: "PARTIAL_CANCELED",
      paymentAmount: 1_000_000,   // 원결제액
      refundJob: { amount: 700_000, penaltyAmount: 300_000, status: "SUCCEEDED" },
    });
    const data = await getRefundCompletedEmailData(bookingId);
    expect(data).not.toBeNull();
    expect(data!.props.refundAmount).toBe(700_000);   // 원결제액 아님!
    expect(data!.props.penaltyAmount).toBe(300_000);
  });

  it("전액 환불(CANCELED, penaltyAmount=0) → penaltyAmount 0 보고", async () => {
    const { bookingId } = await seedRefundedBooking({
      paymentStatus: "CANCELED",
      paymentAmount: 500_000,
      refundJob: { amount: 500_000, penaltyAmount: 0, status: "SUCCEEDED" },
    });
    const data = await getRefundCompletedEmailData(bookingId);
    expect(data!.props.refundAmount).toBe(500_000);
    expect(data!.props.penaltyAmount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- getRefundCompletedEmailData`
Expected: FAIL — PARTIAL_CANCELED 필터 누락으로 null / penaltyAmount 미존재.

- [ ] **Step 3: Implement — `getRefundCompletedEmailData.ts` 수정**

쿼리를 RefundJob 출처로 변경:

```ts
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      user: { select: { email: true, name: true } },
      departure: { select: { product: { select: { title: true } } } },
      payments: {
        where: { status: { in: ["CANCELED", "PARTIAL_CANCELED"] } },
        select: { method: true },
        orderBy: { canceledAt: "desc" },
        take: 1,
      },
      refundJobs: {
        where: { status: "SUCCEEDED" },
        select: { amount: true, penaltyAmount: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
  });

  const refundedPayment = booking?.payments[0];
  const refundJob = booking?.refundJobs[0];
  if (!booking || !refundedPayment || !refundJob) return null;

  return {
    recipientEmail: booking.user.email,
    props: {
      customerName: booking.user.name ?? "고객",
      bookingId: booking.id,
      productTitle: booking.departure.product.title,
      refundAmount: refundJob.amount,         // 실제 환불액
      penaltyAmount: refundJob.penaltyAmount,  // 위약금
      paymentMethod: METHOD_LABEL[refundedPayment.method] ?? refundedPayment.method,
    },
  };
```

- [ ] **Step 4: `RefundCompletedEmailProps`에 `penaltyAmount` 추가**

```ts
// src/shared/email/templates/types.ts
export interface RefundCompletedEmailProps {
  customerName: string;
  bookingId: string;
  productTitle: string;
  refundAmount: number;
  penaltyAmount: number; // ← 추가 (0이면 템플릿에서 라인 숨김)
  paymentMethod: string;
}
```

- [ ] **Step 5: 템플릿에 위약금 라인 조건부 추가**

`RefundCompletedEmail.tsx` 구조분해에 `penaltyAmount` 추가하고, "환불 금액 강조" Section 위에 조건부 라인:

```tsx
export function RefundCompletedEmail({
  customerName, bookingId, productTitle, refundAmount, penaltyAmount, paymentMethod,
}: RefundCompletedEmailProps) {
```

환불 금액 강조 Section 내부 `{won(refundAmount)}` 아래:

```tsx
            {penaltyAmount > 0 && (
              <Text style={{ color: "#92400e", fontSize: "13px", margin: "6px 0 0" }}>
                위약금 {won(penaltyAmount)} 공제 후 환불 금액입니다.
              </Text>
            )}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm run test -- getRefundCompletedEmailData && npm run typecheck`
Expected: PASS. (render.ts가 props 타입을 참조하므로 typecheck로 누락 감지.)

- [ ] **Step 7: Commit**

```bash
git add src/entities/payment/api/getRefundCompletedEmailData.ts src/shared/email/ src/entities/payment/api/__tests__/getRefundCompletedEmailData.test.ts
git commit -m "fix(email): report actual refund/penalty amount for partial cancels"
```

---

## Task 8: (선택) Mock 충실도 + 런타임 e2e 검증 (🔬 QA)

**Files:**
- Modify(선택): `scripts/qa/mock-toss-server.ts`

- [ ] **Step 1: (선택) Mock이 부분취소 시 PARTIAL_CANCELED 반환**

`handleCancel`에서 요청 본문에 원금액 힌트가 없으므로, 환경변수/시나리오로 분기하거나 `cancelAmount`를 그대로 echo하며 status만 시나리오로 토글. 우리 사가는 응답 status를 신뢰하지 않으므로(로컬 penaltyAmount로 분기) **로직 불변** — 충실도 목적만:

```ts
  // MOCK_TOSS_PARTIAL=1 이면 PARTIAL_CANCELED 반환
  const status = process.env.MOCK_TOSS_PARTIAL === "1" ? "PARTIAL_CANCELED" : "CANCELED";
  send(res, 200, { paymentKey, status, cancels: [{ cancelAmount, canceledAt: isoNow(), transactionKey: `mock_txn_${Date.now()}` }] });
```

- [ ] **Step 2: 런타임 e2e — Mock Toss로 부분취소 검증**

Mock 서버 기동 후, D-3 PAID booking을 자가취소하고 DB 상태를 증거 수집:

Run (각각):
```bash
# 1) mock 기동 (별도 셸)
npx tsx scripts/qa/mock-toss-server.ts 4242 &
# 2) 자가취소 Server Action 경로를 타는 통합 시나리오 또는 prisma로 직접 refundBooking 호출 스크립트
# 3) 결과 확인
npx prisma studio  # 또는 아래 쿼리
```
검증 쿼리(예): RefundJob.amount/penaltyAmount, Payment.status=PARTIAL_CANCELED, PaymentEvent.payload에 금액 감사.
Expected: 700000/300000, PARTIAL_CANCELED, payload에 baseAmount/penaltyAmount/refundAmount.

- [ ] **Step 3: 전체 게이트**

Run: `npm run typecheck && npm run test && npm run lint`
Expected: 전부 PASS. 출력 인용해 보고.

- [ ] **Step 4: Commit (Mock 수정 시)**

```bash
git add scripts/qa/mock-toss-server.ts
git commit -m "test(qa): mock toss partial-cancel fidelity"
```

---

## Task 9: ADR-0031 + CLAUDE.md 컨텍스트 노트

**Files:**
- Create: `docs/superpowers/adr/0031-penalty-snapshot-partial-cancel.md`
- Modify: `docs/superpowers/adr/README.md` (인덱스 한 줄)
- Modify: `CLAUDE.md` §8 (혼란 방지 노트 1~2줄)

- [ ] **Step 1: ADR 작성 (template.md 복사 후 4섹션)**

`Context / Decision / Consequences / Alternatives Considered`. 핵심 박제:
- 위약금을 actor 추론이 아닌 명시적 `applyPenalty` 플래그로 받은 이유(호출자 의도 명확·cascade 면제 분기).
- 취소 시점 스냅샷 동결(재시도 무재계산) — D-day 변동 면역([ADR-0027] 동형).
- `RefundJob.amount` 의미를 "환불액"으로 재정의 + `penaltyAmount` 컬럼 채택.
- **Alternatives Considered**: (a) 별도 `Refund` 원장 테이블 — 모델+쿼리+배치 연동 재설계로 거부 (b) Booking에 금액 필드 — 레이어 책임 결합으로 거부 (c) cron 재시도 시 재계산 — D-day 변동으로 금액 불일치 위험 거부.

- [ ] **Step 2: README 인덱스 + CLAUDE.md 노트 추가**

CLAUDE.md §8에 한 줄: "부분환불 위약금은 어디서? → [ADR-0031]. 자가취소만 적용(국외여행 표준약관 D-day 정률), enqueue 시점 동결, retry 무재계산. cascade는 위약금 0 유지."

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/adr/ CLAUDE.md
git commit -m "docs(adr): 0031 penalty snapshot & partial-cancel state model"
```

---

## 완료 체크리스트 (최종 QA — 🔬 R1/R8 증거 기반)

- [ ] `npm run typecheck` PASS (출력 인용)
- [ ] `npm run test` PASS — penaltyPolicy/refund/refundRetry/email 전부 (출력 인용)
- [ ] `npm run lint` PASS
- [ ] `grep -n "\- \[ \]"` 로 이 플랜의 미체크 항목 0 확인 (§4.1)
- [ ] Mock Toss 부분취소 런타임 증거(RefundJob.amount=환불액 / penaltyAmount / Payment.status=PARTIAL_CANCELED)
- [ ] 🛑 NO-REAL-MONEY: 전 과정 Mock/sandbox, live 키 0 (§5 재확인)
