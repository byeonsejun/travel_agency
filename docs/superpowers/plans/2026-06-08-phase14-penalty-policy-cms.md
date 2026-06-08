# Custom Penalty Policy CMS (Phase 14 / C2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 하드코딩된 `OVERSEAS_PENALTY_TIERS` 단일 정률을 DB 층위의 네임드·불변 버전 정책 템플릿으로 끌어내려, 상품/출발일별 위약금 정책을 admin CMS로 커스터마이즈한다.

**Architecture:** 신규 `entities/penalty-policy` 베이스 슬라이스(model: tiers 타입·Zod 검증·resolve 순수함수·computePenalty / api: 활성버전 조회·버전 CRUD)를 payment·booking·admin이 단방향 의존. 정책은 append-only 불변 버전, 예약 시점 (key,version) 스냅샷으로 동결(소급 ❌), 3단계 폴백(departure → product → 시스템 기본). 100% 위약금은 `refundAmount===0` Toss-skip 가드로 방어.

**Tech Stack:** Next.js 15 App Router(RSC), Prisma 5 + PostgreSQL(JSONB), Zod 3, Vitest 2, FSD.

**Spec:** `docs/superpowers/specs/2026-06-08-custom-penalty-policy-design.md`

---

## File Structure

**신규 슬라이스 `entities/penalty-policy/`**
- `model/tiers.ts` — `PenaltyTier` 타입, `OVERSEAS_PENALTY_TIERS` 시스템 기본 상수, `DEFAULT_POLICY_KEY`, `PenaltyTierSchema`/`PenaltyTiersSchema`(Zod), `resolvePenaltyPolicyKey`(순수), `computePenalty`(tiers 주입 순수).
- `api/queries.ts` — `getActivePenaltyPolicy(key)`, `getActivePenaltyPolicies()`, `getPenaltyTiersBySnapshot(key, version)`.
- `api/mutations.ts` — `createPenaltyPolicyVersion(input)`(새 버전 + isActive flip, Tx).
- `index.ts` — barrel.
- `model/__tests__/tiers.test.ts`, `api/__tests__/*.test.ts`.

**수정**
- `prisma/schema.prisma` — `PenaltyPolicy` 모델 + `Product.penaltyPolicyKey` + `Departure.penaltyPolicyKey` + `Booking.penaltyPolicyKey/Version`.
- `prisma/seed.ts` — `standard_overseas` v1 시드.
- `src/entities/payment/api/refund.ts` — `refundAmount===0` 가드(Task 1) + 스냅샷 tiers 해소(Task 3).
- `src/entities/payment/api/refundRetry.ts` — 동일 가드 + (해소 불필요, job.amount 동결).
- `src/entities/payment/model/penaltyPolicy.ts` — **삭제**(computePenalty/상수가 penalty-policy로 이동). payment 소비자는 `@/entities/penalty-policy`에서 import.
- `src/entities/payment/index.ts` — computePenalty/OVERSEAS_PENALTY_TIERS export 제거(또는 penalty-policy 재노출).
- `src/entities/booking/api/mutations.ts` — 예약 생성 시 스냅샷.
- `src/widgets/booking-detail/ui/BookingDetailView.tsx` — 미리보기 tiers를 스냅샷 기반으로.

**Admin UI**
- `src/app/(admin)/admin/penalty-policies/page.tsx` — 정책 목록 RSC.
- `src/features/admin-penalty-policy/` — model(schemas) + ui(편집 폼 island) + server(actions).
- `src/features/admin-product-penalty/` (또는 기존 상품/출발 편집 확장) — penaltyPolicyKey 드롭다운 + 할당 action.
- admin nav 갱신.

---

## Task 1: `refundAmount === 0` Toss-skip 가드 (방어선 최우선)

**왜 먼저?** 100% 위약금 정책이 도입되면 `refundAmount`가 0이 될 수 있고, `tossClient.cancel({ cancelAmount: 0 })`은 Toss가 거부한다. 정책 시스템을 쌓기 전에 양 사가 경로에 방어선을 먼저 깐다. 현재 하드코딩 tiers(max 50%)에선 0이 안 나오므로 회귀 없음 — 강제 0 케이스로 테스트.

**Files:**
- Modify: `src/entities/payment/api/refund.ts` (runRefundSaga Phase 2)
- Modify: `src/entities/payment/api/refundRetry.ts` (retryRefundJob Phase 2)
- Test: `src/entities/payment/api/__tests__/refund.test.ts`, `src/entities/payment/api/__tests__/refundRetry.test.ts`

- [x] **Step 1: refund.ts — 실패 테스트 작성**

`src/entities/payment/api/__tests__/refund.test.ts`에 추가(기존 `mocks`/하네스 재사용):

```ts
it("refundAmount===0(100% 위약금)이면 tossClient.cancel을 호출하지 않고 settle한다", async () => {
  // booking: 활성 traveler 1명, unitPrice 100000
  mocks.db.booking.findUnique.mockResolvedValue({
    id: "bk0", status: "PAID", departureId: "dp0",
    departure: { departureDate: new Date("2026-12-25") },
    travelers: [{ id: "t0", paxType: "ADULT", unitPrice: 100000, canceledAt: null }],
  });
  mocks.db.payment.findFirst.mockResolvedValue({
    id: "pay0", amount: 100000, refundedAmount: 0, tossPaymentKey: "tk0",
  });
  // Phase1 reserve/create: refundJob 멱등 없음 → 생성
  mocks.tx.refundJob.findUnique.mockResolvedValue(null);
  mocks.tx.payment.updateMany.mockResolvedValue({ count: 1 }); // reserveRefund ok
  mocks.tx.refundJob.create.mockResolvedValue({ id: "rj0", attempts: 0 });
  mocks.tx.refundJob.findFirstOrThrow.mockResolvedValue({ id: "rj0" });
  mocks.db.$transaction.mockImplementation(async (fn: (tx: typeof mocks.tx) => unknown) => fn(mocks.tx));

  // refundTraveler with applyPenalty=true AND a 100% tier injected via booking snapshot
  // (이 테스트는 computePenalty가 100%를 내도록 booking 스냅샷 tiers를 100%로 두는 Task 3 이후 강화됨;
  //  Task 1 시점엔 refundAmount===0을 직접 만들기 위해 단일 traveler unitPrice=0 사용)
  mocks.db.booking.findUnique.mockResolvedValue({
    id: "bk0", status: "PAID", departureId: "dp0",
    departure: { departureDate: new Date("2026-12-25") },
    travelers: [{ id: "t0", paxType: "ADULT", unitPrice: 0, canceledAt: null }],
  });

  await refundTraveler({ bookingId: "bk0", travelerIds: ["t0"], actor: "admin:a", applyPenalty: false });

  expect(mocks.tossClient.cancel).not.toHaveBeenCalled();
  // settle은 수행 — refundJob SUCCEEDED 업데이트가 일어남
  expect(mocks.tx.refundJob.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED" }) }),
  );
});
```

- [x] **Step 2: 실패 확인**

Run: `npx vitest run src/entities/payment/api/__tests__/refund.test.ts -t "refundAmount===0"`
Expected: FAIL — 현재는 `tossClient.cancel`이 cancelAmount:0으로 호출됨.

- [x] **Step 3: refund.ts 가드 구현**

`runRefundSaga`의 Phase 2 블록을 수정. 기존:

```ts
  // Phase 2: 외부 PG 취소 (Tx 밖 — ADR-0003)
  try {
    await tossClient.cancel({ ... });
  } catch (err) { ... }
```

→ refundAmount 0이면 PG 호출 자체를 건너뛴다:

```ts
  // Phase 2: 외부 PG 취소 (Tx 밖 — ADR-0003)
  // 100% 위약금 등으로 실환불액이 0이면 Toss cancel(cancelAmount:0)은 거부되므로 skip.
  // 머니무브가 없을 뿐, settle(Phase 3)·booking 전이(onSettled)는 정상 수행한다.
  if (core.refundAmount > 0) {
    try {
      await tossClient.cancel({
        paymentKey: core.tossPaymentKey,
        cancelReason: core.reason ?? "환불 요청",
        cancelAmount: core.refundAmount,
        idempotencyKey: created.id,
      });
    } catch (err) {
      await db.refundJob.update({
        where: { id: created.id },
        data: {
          status: "PENDING",
          attempts: { increment: 1 },
          nextRunAt: backoff(created.attempts),
          lastError: String(err),
        },
      });
      metrics.incr("payment.refund.deferred");
      captureException(err, { bookingId: core.bookingId });
      throw new PaymentError("REFUND_DEFERRED", { cause: String(err) });
    }
  } else {
    metrics.incr("payment.refund.zero_amount_skip");
  }
```

- [x] **Step 4: 통과 확인**

Run: `npx vitest run src/entities/payment/api/__tests__/refund.test.ts -t "refundAmount===0"`
Expected: PASS

- [x] **Step 5: refundRetry.ts — 실패 테스트 작성**

`src/entities/payment/api/__tests__/refundRetry.test.ts`에 추가(기존 하네스 재사용):

```ts
it("job.amount===0이면 tossClient.cancel skip 후 SUCCEEDED settle", async () => {
  mocks.db.refundJob.findUniqueOrThrow.mockResolvedValue({
    id: "rj0", bookingId: "bk0", paymentId: "pay0", amount: 0, penaltyAmount: 100000,
    kind: "DISCRETIONARY", attempts: 0, reason: null, actor: "admin:a", seatsReleased: 0,
    payment: { id: "pay0", tossPaymentKey: "tk0", amount: 100000, status: "PAID", refundedAmount: 100000 },
    booking: { departureId: "dp0" },
  });
  mocks.db.$transaction.mockImplementation(async (fn: (tx: typeof mocks.tx) => unknown) => fn(mocks.tx));
  // claim 성공
  mocks.tx.refundJob.updateMany.mockResolvedValue({ count: 1 });

  const res = await retryRefundJob("rj0");

  expect(mocks.tossClient.cancel).not.toHaveBeenCalled();
  expect(res).toMatchObject({ type: "succeeded" });
});
```

- [x] **Step 6: 실패 확인**

Run: `npx vitest run src/entities/payment/api/__tests__/refundRetry.test.ts -t "job.amount===0"`
Expected: FAIL

- [x] **Step 7: refundRetry.ts 가드 구현**

`retryRefundJob`의 Phase 2 `try { await tossClient.cancel(...) }` 블록을 `if (job.amount > 0) { ... }` 로 감싼다. 0이면 skip하고 곧장 Phase 3 settle로 진행:

```ts
  // ── Phase 2: 외부 PG 취소 (Tx 바깥, ADR-0003) ──
  // job.amount===0(100% 위약금)이면 Toss cancel은 거부되므로 skip → 곧장 settle.
  if (job.amount > 0) {
    try {
      await tossClient.cancel({
        paymentKey: job.payment.tossPaymentKey,
        cancelReason: job.reason ?? "환불 처리 재시도",
        cancelAmount: job.amount,
      });
    } catch (cancelErr) {
      // ── 기존 영구실패/일시실패 처리 블록 전체를 이 안으로 이동 ──
      const newAttempts = job.attempts + 1;
      const lastError = String(cancelErr);
      if (isPermanentFailure(newAttempts)) {
        await db.$transaction(async (tx) => {
          await tx.refundJob.update({ where: { id: jobId }, data: { status: "FAILED", attempts: { increment: 1 }, lastError } });
          await releaseRefund(tx, { paymentId: job.paymentId, amount: job.amount });
        });
        metrics.incr("payment.refund.retry.permanent_failed");
        captureException(cancelErr, { bookingId: job.bookingId, paymentId: job.paymentId, extras: { jobId, permanent: true } });
        return { type: "failed", jobId, reason: "permanent_failure" };
      }
      const nextRunAt = backoff(newAttempts);
      await db.refundJob.update({ where: { id: jobId }, data: { status: "PENDING", attempts: { increment: 1 }, nextRunAt, lastError } });
      logger.warn("payment.refund.retry.pg_failed", { jobId, attempts: newAttempts, nextRunAt: nextRunAt.toISOString() });
      metrics.incr("payment.refund.retry.deferred");
      captureException(cancelErr, { bookingId: job.bookingId, paymentId: job.paymentId, extras: { jobId, retry: true } });
      return { type: "deferred", jobId, attempts: newAttempts, nextRunAt, lastError };
    }
  } else {
    metrics.incr("payment.refund.retry.zero_amount_skip");
  }
```

- [x] **Step 8: 통과 확인 + 전체 회귀**

Run: `npx vitest run src/entities/payment && npx tsc --noEmit`
Expected: PASS, tsc clean

- [x] **Step 9: Commit**

```bash
git add src/entities/payment
git commit -m "feat(payment): skip Toss cancel when refundAmount is 0 (100% penalty guard)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 스키마 마이그레이션 + 시드

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260608000000_phase14_penalty_policy/migration.sql`
- Modify: `prisma/seed.ts`

- [x] **Step 1: schema.prisma — PenaltyPolicy 모델 + 컬럼 추가**

`PenaltyPolicy` 모델 추가(파일 내 적당한 위치, 예: Departure 인근):

```prisma
// 위약금 정책 템플릿. append-only 불변 버전: 수정 = version+1 새 행 INSERT(기존 행 불변).
// Product/Departure가 penaltyPolicyKey(논리 key)로 참조 → 예약 시점 활성 버전으로 해소·스냅샷.
model PenaltyPolicy {
  id        String   @id @default(cuid())
  key       String   // 버전 간 안정 식별자. ex) "standard_overseas", "peak_season"
  version   Int      // key별 1부터 증가
  name      String
  tiers     Json     // [{ minDaysBefore: Int, rate: Float(0~1) }, ...] 내림차순, 마지막=catch-all
  isActive  Boolean  @default(true) // key당 정확히 1개만 true
  createdBy String?  // "admin:<id>"
  createdAt DateTime @default(now())

  @@unique([key, version])
  @@index([key, isActive])
}
```

`Product` 모델에 컬럼 추가:
```prisma
  penaltyPolicyKey String? // null → 시스템 기본("standard_overseas")
```
`Departure` 모델에 컬럼 추가:
```prisma
  penaltyPolicyKey String? // null → 상품 정책 상속(오버라이드 시에만 set)
```
`Booking` 모델에 컬럼 추가:
```prisma
  penaltyPolicyKey     String? // 예약 시점 동결 (legacy=null → 시스템 기본 상수)
  penaltyPolicyVersion Int?    // 동결 버전 → 취소 시 정확한 tiers 복원
```

- [x] **Step 2: 마이그레이션 적용 (검증된 워크어라운드 — `prisma migrate dev` 금지)**

이 repo는 shadow DB(pgvector)에서 `migrate dev`가 실패한다. 3-step:

```bash
npx prisma db push --accept-data-loss   # 실 DB 반영 + client 재생성 (컬럼 추가/테이블 생성만 — 데이터 손실 없음)
```

그 다음 `prisma/migrations/20260608000000_phase14_penalty_policy/migration.sql` 수동 작성(기존 마이그레이션 스타일/따옴표 규약 따름):

```sql
-- CreateTable
CREATE TABLE "PenaltyPolicy" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "tiers" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PenaltyPolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PenaltyPolicy_key_version_key" ON "PenaltyPolicy"("key", "version");
CREATE INDEX "PenaltyPolicy_key_isActive_idx" ON "PenaltyPolicy"("key", "isActive");

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "penaltyPolicyKey" TEXT;
ALTER TABLE "Departure" ADD COLUMN "penaltyPolicyKey" TEXT;
ALTER TABLE "Booking" ADD COLUMN "penaltyPolicyKey" TEXT;
ALTER TABLE "Booking" ADD COLUMN "penaltyPolicyVersion" INTEGER;
```

그 다음:
```bash
npx prisma migrate resolve --applied 20260608000000_phase14_penalty_policy
```

- [x] **Step 3: 적용 검증**

Run:
```bash
npx prisma validate
npx prisma db execute --stdin <<'SQL'
SELECT column_name FROM information_schema.columns WHERE table_name='Booking' AND column_name IN ('penaltyPolicyKey','penaltyPolicyVersion');
SELECT to_regclass('"PenaltyPolicy"') AS penalty_policy_table;
SQL
```
Expected: schema valid, 2 Booking 컬럼 + PenaltyPolicy 테이블 존재.

- [x] **Step 4: seed.ts — standard_overseas v1 시드**

`prisma/seed.ts`에 추가(상품 시드보다 먼저 실행되도록 상단부). tiers는 현 `OVERSEAS_PENALTY_TIERS` 값을 JSON-safe(마지막 행 minDaysBefore = -99999)로:

```ts
await prisma.penaltyPolicy.upsert({
  where: { key_version: { key: "standard_overseas", version: 1 } },
  update: {},
  create: {
    key: "standard_overseas",
    version: 1,
    name: "국외여행 표준약관",
    isActive: true,
    tiers: [
      { minDaysBefore: 30, rate: 0.0 },
      { minDaysBefore: 20, rate: 0.1 },
      { minDaysBefore: 10, rate: 0.15 },
      { minDaysBefore: 8, rate: 0.2 },
      { minDaysBefore: 1, rate: 0.3 },
      { minDaysBefore: -99999, rate: 0.5 },
    ],
  },
});
```

- [x] **Step 5: seed 실행 검증**

Run: `npm run db:seed && npx prisma db execute --stdin <<'SQL'
SELECT key, version, "isActive" FROM "PenaltyPolicy" WHERE key='standard_overseas';
SQL`
Expected: 1행 (standard_overseas, 1, true).

- [x] **Step 6: Commit**

```bash
git add prisma
git commit -m "feat(db): PenaltyPolicy table + policy columns + standard_overseas seed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 코어 비즈니스 로직 (penalty-policy 슬라이스 + 통합)

### Task 3.1: 신규 슬라이스 model — 타입·상수·Zod·resolve·computePenalty

**Files:**
- Create: `src/entities/penalty-policy/model/tiers.ts`
- Create: `src/entities/penalty-policy/model/__tests__/tiers.test.ts`

- [x] **Step 1: 실패 테스트 작성**

`src/entities/penalty-policy/model/__tests__/tiers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  PenaltyTiersSchema, resolvePenaltyPolicyKey, computePenalty, OVERSEAS_PENALTY_TIERS,
} from "../tiers";

describe("PenaltyTiersSchema", () => {
  it("정상 tiers 통과", () => {
    expect(PenaltyTiersSchema.safeParse([
      { minDaysBefore: 30, rate: 0 }, { minDaysBefore: -99999, rate: 0.5 },
    ]).success).toBe(true);
  });
  it("rate>1 reject", () => {
    expect(PenaltyTiersSchema.safeParse([{ minDaysBefore: -99999, rate: 1.5 }]).success).toBe(false);
  });
  it("rate=1(100%) 허용 (D4)", () => {
    expect(PenaltyTiersSchema.safeParse([{ minDaysBefore: -99999, rate: 1 }]).success).toBe(true);
  });
  it("minDaysBefore 내림차순 아니면 reject", () => {
    expect(PenaltyTiersSchema.safeParse([
      { minDaysBefore: 10, rate: 0 }, { minDaysBefore: 30, rate: 0.5 },
    ]).success).toBe(false);
  });
  it("빈 배열 reject", () => {
    expect(PenaltyTiersSchema.safeParse([]).success).toBe(false);
  });
});

describe("resolvePenaltyPolicyKey", () => {
  it("departure 우선", () => {
    expect(resolvePenaltyPolicyKey("prod_k", "dep_k")).toBe("dep_k");
  });
  it("departure 없으면 product", () => {
    expect(resolvePenaltyPolicyKey("prod_k", null)).toBe("prod_k");
  });
  it("둘 다 없으면 시스템 기본", () => {
    expect(resolvePenaltyPolicyKey(null, null)).toBe("standard_overseas");
  });
});

describe("computePenalty (tiers 주입)", () => {
  it("100% tier → refundAmount 0", () => {
    const r = computePenalty({
      baseAmount: 100000, departureDate: new Date("2026-01-02T00:00:00Z"),
      now: new Date("2026-01-01T12:00:00Z"), tiers: [{ minDaysBefore: -99999, rate: 1 }],
    });
    expect(r.penaltyAmount).toBe(100000);
    expect(r.refundAmount).toBe(0);
  });
  it("기본 상수로 30일 전 무료취소", () => {
    const r = computePenalty({
      baseAmount: 100000, departureDate: new Date("2026-12-31T00:00:00Z"),
      now: new Date("2026-01-01T12:00:00Z"), tiers: OVERSEAS_PENALTY_TIERS,
    });
    expect(r.rate).toBe(0);
    expect(r.refundAmount).toBe(100000);
  });
});
```

- [x] **Step 2: 실패 확인**

Run: `npx vitest run src/entities/penalty-policy/model/__tests__/tiers.test.ts`
Expected: FAIL — 모듈 없음.

- [x] **Step 3: tiers.ts 구현**

`src/entities/penalty-policy/model/tiers.ts`:

```ts
/**
 * 위약금 tier 도메인 — 순수. 외부 IO 0. now 주입으로 테스트 결정성 보장.
 * (기존 entities/payment/model/penaltyPolicy.ts에서 이전, tiers 주입식으로 일반화.)
 */
import { z } from "zod";

export const DEFAULT_POLICY_KEY = "standard_overseas";

/** 시스템 기본 폴백 tiers (국외여행 표준약관). JSON-safe: 마지막 행 minDaysBefore=-99999(catch-all). */
export const OVERSEAS_PENALTY_TIERS: PenaltyTier[] = [
  { minDaysBefore: 30, rate: 0.0 },
  { minDaysBefore: 20, rate: 0.1 },
  { minDaysBefore: 10, rate: 0.15 },
  { minDaysBefore: 8, rate: 0.2 },
  { minDaysBefore: 1, rate: 0.3 },
  { minDaysBefore: -99999, rate: 0.5 },
];

export interface PenaltyTier {
  minDaysBefore: number;
  rate: number;
}

export const PenaltyTierSchema = z.object({
  minDaysBefore: z.number().int(),
  rate: z.number().min(0).max(1), // D4: 0~100% 허용
});

/** 최소 1행 + minDaysBefore 엄격 내림차순. (find가 내림차순 첫 매칭에 의존) */
export const PenaltyTiersSchema = z
  .array(PenaltyTierSchema)
  .min(1)
  .superRefine((tiers, ctx) => {
    for (let i = 1; i < tiers.length; i++) {
      if (tiers[i].minDaysBefore >= tiers[i - 1].minDaysBefore) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `minDaysBefore must be strictly descending (index ${i})`,
        });
      }
    }
  });

export function resolvePenaltyPolicyKey(
  productKey: string | null,
  departureKey: string | null,
): string {
  return departureKey ?? productKey ?? DEFAULT_POLICY_KEY;
}

export interface PenaltyInput {
  baseAmount: number;
  departureDate: Date;
  now: Date;
  tiers: PenaltyTier[];
}
export interface PenaltyResult {
  daysBefore: number;
  rate: number;
  penaltyAmount: number;
  refundAmount: number;
}

const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;

function daysUntil(departureDate: Date, now: Date): number {
  const departKstMidnightUtcMs = departureDate.getTime() - KST_OFFSET_MS;
  return Math.ceil((departKstMidnightUtcMs - now.getTime()) / DAY_MS);
}

export function computePenalty(input: PenaltyInput): PenaltyResult {
  const { baseAmount, departureDate, now, tiers } = input;
  const daysBefore = daysUntil(departureDate, now);
  const tier = tiers.find((t) => daysBefore >= t.minDaysBefore) ?? tiers[tiers.length - 1];
  const penaltyAmount = Math.floor(baseAmount * tier.rate);
  return { daysBefore, rate: tier.rate, penaltyAmount, refundAmount: baseAmount - penaltyAmount };
}
```

- [x] **Step 4: 통과 확인**

Run: `npx vitest run src/entities/penalty-policy/model/__tests__/tiers.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/entities/penalty-policy/model
git commit -m "feat(penalty-policy): tiers model — Zod validation, resolve, computePenalty

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 3.2: api 조회 로더 + barrel

**Files:**
- Create: `src/entities/penalty-policy/api/queries.ts`
- Create: `src/entities/penalty-policy/index.ts`
- Test: `src/entities/penalty-policy/api/__tests__/queries.test.ts`

- [x] **Step 1: 실패 테스트 작성**

`src/entities/penalty-policy/api/__tests__/queries.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  db: { penaltyPolicy: { findFirst: vi.fn(), findMany: vi.fn() } },
}));
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
import { getActivePenaltyTiers, getTiersBySnapshot } from "../queries";

beforeEach(() => vi.clearAllMocks());

describe("getActivePenaltyTiers", () => {
  it("활성 버전 tiers 반환", async () => {
    mocks.db.penaltyPolicy.findFirst.mockResolvedValue({
      version: 2, tiers: [{ minDaysBefore: -99999, rate: 0.5 }],
    });
    const r = await getActivePenaltyTiers("standard_overseas");
    expect(r).toEqual({ version: 2, tiers: [{ minDaysBefore: -99999, rate: 0.5 }] });
  });
  it("없으면 시스템 기본 상수(version 0)", async () => {
    mocks.db.penaltyPolicy.findFirst.mockResolvedValue(null);
    const r = await getActivePenaltyTiers("missing");
    expect(r.version).toBe(0);
    expect(r.tiers.length).toBeGreaterThan(0);
  });
});

describe("getTiersBySnapshot", () => {
  it("snapshot version의 tiers 반환", async () => {
    mocks.db.penaltyPolicy.findFirst.mockResolvedValue({ tiers: [{ minDaysBefore: -99999, rate: 0.3 }] });
    const r = await getTiersBySnapshot("k", 1);
    expect(r[0].rate).toBe(0.3);
  });
  it("snapshot 없음(legacy null) → 시스템 기본 상수", async () => {
    const r = await getTiersBySnapshot(null, null);
    expect(r.length).toBeGreaterThan(0);
  });
});
```

- [x] **Step 2: 실패 확인**

Run: `npx vitest run src/entities/penalty-policy/api/__tests__/queries.test.ts`
Expected: FAIL — 모듈 없음.

- [x] **Step 3: queries.ts 구현**

`src/entities/penalty-policy/api/queries.ts`:

```ts
import { db } from "@/shared/lib/db";
import { OVERSEAS_PENALTY_TIERS, PenaltyTiersSchema, type PenaltyTier } from "../model/tiers";

/** tiers JSON을 검증·파싱. 실패 시 시스템 기본 상수로 graceful 폴백. */
function parseTiers(raw: unknown): PenaltyTier[] {
  const parsed = PenaltyTiersSchema.safeParse(raw);
  return parsed.success ? parsed.data : OVERSEAS_PENALTY_TIERS;
}

/** key의 활성 버전 tiers + version. 없으면 시스템 기본 상수(version 0). */
export async function getActivePenaltyTiers(
  key: string,
): Promise<{ version: number; tiers: PenaltyTier[] }> {
  const row = await db.penaltyPolicy.findFirst({
    where: { key, isActive: true },
    select: { version: true, tiers: true },
  });
  if (!row) return { version: 0, tiers: OVERSEAS_PENALTY_TIERS };
  return { version: row.version, tiers: parseTiers(row.tiers) };
}

/** 예약 스냅샷 (key, version)으로 정확한 tiers 복원. legacy(null) → 시스템 기본. */
export async function getTiersBySnapshot(
  key: string | null,
  version: number | null,
): Promise<PenaltyTier[]> {
  if (!key || version == null || version === 0) return OVERSEAS_PENALTY_TIERS;
  const row = await db.penaltyPolicy.findFirst({
    where: { key, version },
    select: { tiers: true },
  });
  return row ? parseTiers(row.tiers) : OVERSEAS_PENALTY_TIERS;
}

/** admin 목록 — key별 활성 버전. */
export async function getActivePenaltyPolicies() {
  return db.penaltyPolicy.findMany({
    where: { isActive: true },
    orderBy: { key: "asc" },
    select: { id: true, key: true, version: true, name: true, tiers: true, createdAt: true },
  });
}
```

`src/entities/penalty-policy/index.ts` (barrel):

```ts
export {
  computePenalty, resolvePenaltyPolicyKey, PenaltyTiersSchema, PenaltyTierSchema,
  OVERSEAS_PENALTY_TIERS, DEFAULT_POLICY_KEY,
} from "./model/tiers";
export type { PenaltyTier, PenaltyInput, PenaltyResult } from "./model/tiers";
export { getActivePenaltyTiers, getTiersBySnapshot, getActivePenaltyPolicies } from "./api/queries";
```

- [x] **Step 4: 통과 확인**

Run: `npx vitest run src/entities/penalty-policy && npx tsc --noEmit`
Expected: PASS, tsc clean

- [x] **Step 5: Commit**

```bash
git add src/entities/penalty-policy
git commit -m "feat(penalty-policy): active/snapshot tiers loaders + barrel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 3.3: payment 소비자 이전 (computePenalty 소스 전환 + 스냅샷 tiers 해소)

**Files:**
- Delete: `src/entities/payment/model/penaltyPolicy.ts`
- Modify: `src/entities/payment/index.ts`
- Modify: `src/entities/payment/api/refund.ts`
- Modify: `src/widgets/booking-detail/ui/BookingDetailView.tsx`
- Test: `src/entities/payment/api/__tests__/refund.test.ts`

- [x] **Step 1: penaltyPolicy.ts 삭제 + payment barrel 갱신**

`rm src/entities/payment/model/penaltyPolicy.ts`. `src/entities/payment/index.ts`의 두 줄:
```ts
export { computePenalty, OVERSEAS_PENALTY_TIERS } from "./model/penaltyPolicy";
export type { PenaltyResult, PenaltyInput } from "./model/penaltyPolicy";
```
→ 제거(소비자는 `@/entities/penalty-policy`에서 직접 import). 기존 payment 테스트가 `../model/penaltyPolicy`를 import하면 함께 갱신.

- [x] **Step 2: refund.ts — 스냅샷 tiers 해소 후 computePenalty 호출**

import 교체:
```ts
import { computePenalty, getTiersBySnapshot } from "@/entities/penalty-policy";
```
(`import { computePenalty } from "../model/penaltyPolicy";` 삭제)

`refundTraveler` 내부에서 booking 조회 select에 스냅샷 컬럼 추가:
```ts
    select: {
      id: true, status: true, departureId: true,
      penaltyPolicyKey: true, penaltyPolicyVersion: true,
      departure: { select: { departureDate: true } },
      travelers: { select: { id: true, paxType: true, unitPrice: true, canceledAt: true } },
    },
```

penalty 계산부를 스냅샷 tiers 기반으로:
```ts
  const tiers = await getTiersBySnapshot(booking.penaltyPolicyKey, booking.penaltyPolicyVersion);
  const { penaltyAmount, refundAmount } = input.applyPenalty
    ? computePenalty({ baseAmount: canceledBase, departureDate: booking.departure.departureDate, now: new Date(), tiers })
    : { penaltyAmount: 0, refundAmount: canceledBase };
```

- [x] **Step 3: BookingDetailView.tsx — 미리보기 tiers 전달**

`import { ..., computePenalty } from "@/entities/payment";` → `computePenalty`를 `@/entities/penalty-policy`에서 import. 미리보기 호출에 tiers 주입. RSC이므로 상위(`BookingDetailView` 또는 그 page loader)에서 `getTiersBySnapshot(booking.penaltyPolicyKey, booking.penaltyPolicyVersion)`로 tiers를 구해 prop으로 전달하거나 컴포넌트가 직접 await. 기존 `computePenalty({ baseAmount, departureDate, now })` 호출(약 53행)에 `tiers` 추가:
```ts
computePenalty({ baseAmount, departureDate, now, tiers })
```
(tiers는 위 로더로 확보; 스냅샷 없으면 로더가 상수 폴백.)

- [x] **Step 4: 기존 refund 테스트 갱신 + 통과**

`refund.test.ts`/`refundRetry.test.ts`에서 booking mock에 `penaltyPolicyKey/Version` 필드 추가(없으면 null), `getTiersBySnapshot` 모킹:
```ts
vi.mock("@/entities/penalty-policy", async (orig) => ({
  ...(await orig<typeof import("@/entities/penalty-policy")>()),
  getTiersBySnapshot: vi.fn().mockResolvedValue(OVERSEAS_PENALTY_TIERS),
}));
```
Run: `npx vitest run src/entities/payment src/widgets && npx tsc --noEmit`
Expected: PASS, tsc clean

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(payment): source computePenalty from penalty-policy + resolve snapshot tiers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 3.4: 예약 생성 시 스냅샷 (booking)

**Files:**
- Modify: `src/entities/booking/api/mutations.ts` (createBooking Tx)
- Test: `src/entities/booking/api/__tests__/*` (createBooking 테스트)

- [x] **Step 1: 실패 테스트 작성**

createBooking 테스트(해당 파일)에 추가 — booking.create data에 스냅샷 컬럼이 들어가는지:
```ts
it("예약 생성 시 활성 위약금 정책을 스냅샷한다", async () => {
  // departure 조회가 product.penaltyPolicyKey / departure.penaltyPolicyKey를 반환하도록 mock
  // getActivePenaltyTiers가 { version: 2, ... } 반환하도록 mock
  // → booking.create data.penaltyPolicyKey === resolved, data.penaltyPolicyVersion === 2 검증
});
```
(실제 하네스의 mock 구조에 맞춰 작성. 핵심 단언: `tx.booking.create` data에 `penaltyPolicyKey`, `penaltyPolicyVersion` 포함.)

- [x] **Step 2: 실패 확인**

Run: `npx vitest run src/entities/booking/api -t "스냅샷"`
Expected: FAIL

- [x] **Step 3: mutations.ts 구현**

createBooking에서 departure 조회 시 product/departure의 `penaltyPolicyKey`를 포함하고, 스냅샷 해소:
```ts
import { resolvePenaltyPolicyKey, getActivePenaltyTiers } from "@/entities/penalty-policy";

// departure 조회 select에 추가: penaltyPolicyKey + product.penaltyPolicyKey
// (이미 departure를 조회 중이면 select 확장; 아니면 추가 조회)
const policyKey = resolvePenaltyPolicyKey(
  productPenaltyPolicyKey ?? null,
  departurePenaltyPolicyKey ?? null,
);
const { version: policyVersion } = await getActivePenaltyTiers(policyKey);
```
`tx.booking.create` data에 추가:
```ts
        penaltyPolicyKey: policyKey,
        penaltyPolicyVersion: policyVersion,
```
또한 기존 `terms.create`에 정책 약관 행 추가(감사):
```ts
            { termKey: policyKey, termVersion: String(policyVersion) },
```
(주의: `getActivePenaltyTiers`는 Tx 밖 조회 — createBooking 진입 직후, `db.$transaction` 시작 전에 호출해 Tx 내부엔 순수 데이터만 들어가게 한다.)

- [x] **Step 4: 통과 확인**

Run: `npx vitest run src/entities/booking/api && npx tsc --noEmit`
Expected: PASS, tsc clean

- [x] **Step 5: Commit**

```bash
git add src/entities/booking
git commit -m "feat(booking): snapshot active penalty policy at booking creation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 3.5 (추가): FULL_CANCEL → Payment CANCELED 상태 전이 픽스 (Task 1 보류분)

사용자 지시로 추가. 100% 위약금(`refundAmount===0`) 및 부분위약금 전체취소 시 결제가 `PARTIAL_CANCELED`로 잘못 남던 문제를, `kind === "FULL_CANCEL"`이면 환불액과 무관하게 `CANCELED`로 마감하도록 양 사가 Phase 3에 게이트 추가. 진짜 부분환불(DISCRETIONARY/TRAVELER_CANCEL)은 PARTIAL_CANCELED 유지. ADR-0031의 full-cancel 규칙을 갱신(supersede).

- [x] 신규 테스트 RED→GREEN: 100% 위약금 전체취소 → Toss skip(Task-1) + Payment CANCELED(Task-3.5) 결합 검증
- [x] `refund.ts` `runRefundSaga` Phase 3: `core.kind === "FULL_CANCEL" || newRefundedAmount >= core.amount` 게이트
- [x] `refundRetry.ts` `retryRefundJob` Phase 3: `job.kind === "FULL_CANCEL" || refundedAmount >= amount` 게이트
- [x] 기존 Case A 테스트 2건(FULL_CANCEL+위약금) PARTIAL_CANCELED → CANCELED 갱신(의도적 행위 변경)
- [x] 이메일 경로(`getRefundCompletedEmailData`) 영향 없음 확인(status `in` 필터 + 금액은 RefundJob에서 read)
- [x] 전체 회귀 1014 tests green, tsc clean

---

## Task 4: Admin CMS (정책 생성 + 상품/출발일 매핑)

### Task 4.1: 버전 생성 mutation

**Files:**
- Create: `src/entities/penalty-policy/api/mutations.ts`
- Modify: `src/entities/penalty-policy/index.ts`
- Test: `src/entities/penalty-policy/api/__tests__/mutations.test.ts`

- [x] **Step 1: 실패 테스트 작성**

`mutations.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  tx: { penaltyPolicy: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() } },
  db: { $transaction: vi.fn() },
}));
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
import { createPenaltyPolicyVersion } from "../mutations";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.$transaction.mockImplementation(async (fn: (tx: typeof mocks.tx) => unknown) => fn(mocks.tx));
});

it("기존 활성 버전을 isActive=false로 내리고 version+1 새 행 생성", async () => {
  mocks.tx.penaltyPolicy.findFirst.mockResolvedValue({ version: 3 });
  mocks.tx.penaltyPolicy.create.mockResolvedValue({ id: "p4", key: "k", version: 4 });
  const r = await createPenaltyPolicyVersion({
    key: "k", name: "n", tiers: [{ minDaysBefore: -99999, rate: 0.5 }], actor: "admin:a",
  });
  expect(mocks.tx.penaltyPolicy.updateMany).toHaveBeenCalledWith({
    where: { key: "k", isActive: true }, data: { isActive: false },
  });
  expect(mocks.tx.penaltyPolicy.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ key: "k", version: 4, isActive: true }),
  }));
  expect(r.version).toBe(4);
});

it("기존 버전 없으면 version 1로 생성", async () => {
  mocks.tx.penaltyPolicy.findFirst.mockResolvedValue(null);
  mocks.tx.penaltyPolicy.create.mockResolvedValue({ id: "p1", key: "k", version: 1 });
  await createPenaltyPolicyVersion({ key: "k", name: "n", tiers: [{ minDaysBefore: -99999, rate: 0.5 }], actor: "admin:a" });
  expect(mocks.tx.penaltyPolicy.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ version: 1 }),
  }));
});
```

- [x] **Step 2: 실패 확인**

Run: `npx vitest run src/entities/penalty-policy/api/__tests__/mutations.test.ts`
Expected: FAIL

- [x] **Step 3: mutations.ts 구현**

```ts
import { db } from "@/shared/lib/db";
import type { Prisma } from "@prisma/client";
import { PenaltyTiersSchema, type PenaltyTier } from "../model/tiers";

export interface CreatePenaltyPolicyVersionInput {
  key: string;
  name: string;
  tiers: PenaltyTier[];
  actor: string;
}

/** 새 정책 버전 생성: 이전 활성 버전 isActive=false, version+1 새 행 isActive=true (단일 Tx). */
export async function createPenaltyPolicyVersion(
  input: CreatePenaltyPolicyVersionInput,
): Promise<{ id: string; key: string; version: number }> {
  const tiers = PenaltyTiersSchema.parse(input.tiers); // 불변식 강제
  return db.$transaction(async (tx) => {
    const latest = await tx.penaltyPolicy.findFirst({
      where: { key: input.key },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;
    await tx.penaltyPolicy.updateMany({
      where: { key: input.key, isActive: true },
      data: { isActive: false },
    });
    return tx.penaltyPolicy.create({
      data: {
        key: input.key,
        version: nextVersion,
        name: input.name,
        tiers: tiers as unknown as Prisma.InputJsonValue,
        isActive: true,
        createdBy: input.actor,
      },
      select: { id: true, key: true, version: true },
    });
  });
}
```
barrel에 추가:
```ts
export { createPenaltyPolicyVersion } from "./api/mutations";
export type { CreatePenaltyPolicyVersionInput } from "./api/mutations";
```

- [x] **Step 4: 통과 확인**

Run: `npx vitest run src/entities/penalty-policy && npx tsc --noEmit`
Expected: PASS, tsc clean

- [x] **Step 5: Commit**

```bash
git add src/entities/penalty-policy
git commit -m "feat(penalty-policy): createPenaltyPolicyVersion (append-only version flip)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 4.2: 정책 목록 페이지 + 편집 폼 island + Server Action

**패턴 참고:** `src/features/admin-booking-cancel/`(server action + `'use client'` island + zod schema + `withRateLimitAction` mutation tier) 와 `src/app/(admin)/admin/` 라우트 구조를 그대로 따른다.

**Files:**
- Create: `src/features/admin-penalty-policy/model/schemas.ts`
- Create: `src/features/admin-penalty-policy/server/actions.ts`
- Create: `src/features/admin-penalty-policy/ui/PenaltyPolicyForm.tsx` (`'use client'`)
- Create: `src/features/admin-penalty-policy/index.ts`
- Create: `src/app/(admin)/admin/penalty-policies/page.tsx`
- Test: `src/features/admin-penalty-policy/server/__tests__/actions.test.ts`

- [x] **Step 1: schemas.ts**

```ts
import { z } from "zod";
import { PenaltyTiersSchema } from "@/entities/penalty-policy";

export const SavePenaltyPolicySchema = z.object({
  key: z.string().min(1).regex(/^[a-z0-9_]+$/, "소문자/숫자/_ 만"),
  name: z.string().min(1).max(100),
  tiers: PenaltyTiersSchema,
});
export type SavePenaltyPolicyInput = z.infer<typeof SavePenaltyPolicySchema>;
```

- [x] **Step 2: server/actions.ts (Zod 검증 + auth admin 가드 + withRateLimitAction mutation + revalidate)**

```ts
"use server";
import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { withRateLimitAction } from "@/shared/lib/rate-limit"; // 실제 경로 확인 후 맞춤
import { createPenaltyPolicyVersion } from "@/entities/penalty-policy";
import { SavePenaltyPolicySchema } from "../model/schemas";

export const savePenaltyPolicyAction = withRateLimitAction(
  { tier: "mutation" },
  async (raw: unknown) => {
    const session = await auth();
    if (session?.user?.role !== "ADMIN") return { ok: false as const, error: "FORBIDDEN" };
    const parsed = SavePenaltyPolicySchema.safeParse(raw);
    if (!parsed.success) return { ok: false as const, error: "INVALID_INPUT" };
    const res = await createPenaltyPolicyVersion({ ...parsed.data, actor: `admin:${session.user.id}` });
    revalidatePath("/admin/penalty-policies");
    return { ok: true as const, version: res.version };
  },
);
```
(주: `withRateLimitAction` 시그니처·`onBlock` 반환모드는 기존 `admin-booking-cancel/server/actions.ts`를 참고해 정확히 맞춘다 — [ADR-0040].)

- [x] **Step 3: ui/PenaltyPolicyForm.tsx (`'use client'` island)**

tier 행 동적 추가/삭제(minDaysBefore, rate%), 저장 시 `savePenaltyPolicyAction` 호출. `useActionState`/`useTransition` 패턴은 기존 admin island를 따른다. (rate는 % 입력 → /100 변환해 0~1로 전송.)

- [x] **Step 4: app/(admin)/admin/penalty-policies/page.tsx (RSC)**

```tsx
import { getActivePenaltyPolicies } from "@/entities/penalty-policy";
import { PenaltyPolicyForm } from "@/features/admin-penalty-policy";

export const dynamic = "force-dynamic"; // admin 도메인 — 캐시 비활성(§6 안전 도메인)

export default async function PenaltyPoliciesPage() {
  const policies = await getActivePenaltyPolicies();
  return ( /* 목록 테이블(key/version/name/tiers 요약) + 생성/편집 폼 */ );
}
```

- [x] **Step 5: actions 테스트 + 통과**

`actions.test.ts`: 비admin → FORBIDDEN, 잘못된 tiers → INVALID_INPUT, 정상 → createPenaltyPolicyVersion 호출 + revalidatePath. (auth/withRateLimitAction/createPenaltyPolicyVersion 모킹.)
Run: `npx vitest run src/features/admin-penalty-policy && npx tsc --noEmit`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add src/features/admin-penalty-policy "src/app/(admin)/admin/penalty-policies"
git commit -m "feat(admin): penalty policy CMS — list page + editor island + save action

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 4.3: 상품/출발일 정책 매핑 + admin nav

**Files:**
- Modify: 상품 편집 화면(`src/app/(admin)/admin/products/[id]/...` 또는 해당 features) — `penaltyPolicyKey` 드롭다운
- Modify: 출발일 편집 화면(`.../departures`) — `penaltyPolicyKey` 드롭다운(빈 값=상속)
- Modify: 매핑 저장 Server Action(기존 상품/출발 수정 action 확장 또는 신규)
- Modify: admin nav 컴포넌트 — "위약금 정책" 링크

- [x] **Step 1: 활성 정책 목록 제공**

드롭다운 옵션은 `getActivePenaltyPolicies()` 결과(key + name). 상품용: "기본값(시스템 표준)" + 각 정책. 출발용: "상품 정책 상속(빈 값)" + 각 정책.

- [x] **Step 2: 상품 수정 action에 penaltyPolicyKey 반영**

기존 상품 update 입력 스키마/액션에 `penaltyPolicyKey: z.string().nullable().optional()` 추가, `product.update` data에 반영. 출발일도 동일(`departure.update`).

- [x] **Step 3: admin nav 링크 추가**

admin 셸 nav 컴포넌트(예: `(admin)/layout.tsx` 또는 nav 컴포넌트)에 "위약금 정책"(`/admin/penalty-policies`) 항목 추가.

- [x] **Step 4: 매핑 동작 검증 (수동/통합)**

dev에서: 정책 생성 → 상품에 할당 → 그 상품으로 예약 생성 → `Booking.penaltyPolicyKey/Version`이 스냅샷됐는지 `prisma db execute`로 확인. 출발일 오버라이드 → 해당 출발 예약이 출발 정책으로 스냅샷되는지 확인.

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(admin): assign penalty policy to product/departure + nav entry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 최종 검증 (종합)

- [x] `npx tsc --noEmit` 통과
- [x] `npx vitest run` 통과 (신규 테스트 포함)
- [x] `npm run lint` 통과
- [x] `npm run build` 통과 (server-only/배럴/클라경계 회귀 차단 — 메모리 규칙)
- [x] 런타임 증거: 정책 생성→상품 할당→예약(스냅샷)→100% 정책 취소(Toss skip + 전이) e2e를 dev에서 `prisma db execute`/콘솔로 확인
- [x] ADR 후보 발행 제안: 정책 CMS 스냅샷 전략(불변 버전 + reference-snapshot) + 3단계 폴백 + 100% `refundAmount===0` 가드
- [x] plan 체크박스 전수 `[x]` 반영 확인(`grep -n "\- \[ \]"`)
