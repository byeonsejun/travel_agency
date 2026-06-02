# Phase 4-B Cancel/Refund Cascade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> ⚠️ CLAUDE.md §4.2 — 모든 체크박스는 미완료(`- [ ]`)로 초기화. Task 완료 즉시 `[ ]`→`[x]` (§4.1).
> 선행 spec: [`docs/superpowers/specs/2026-06-02-phase-4b-cancel-cascade.md`](../specs/2026-06-02-phase-4b-cancel-cascade.md)

**Goal:** 관리자가 예약이 묶인 출발일을 강제 취소하면, N건의 환불/취소를 비동기 fan-out으로 처리하고 부분 실패를 배치 단위로 추적·재시도한다.

**Architecture:** 부모 배치 `DepartureCancellation` + `RefundJob.cancellationBatchId`로 오케스트레이션. admin 액션은 DB-only 단일 tx(외부 IO 0)로 departure→CANCELED + RefundJob enqueue(PAID) + 미결제 인라인 취소. 실제 PG 환불은 기존 `process-refunds` cron이 ADR-0003 Saga 그대로 drain. 배치 status는 RefundJob 상태에서 파생(`recomputeBatchStatus`).

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Prisma 5(PostgreSQL), Zod 3, Vitest 2(TDD), 기존 Toss mock/sandbox.

---

## 결정사항 (spec B1~B4)
- **B1**: 부모 배치 테이블 `DepartureCancellation` (결제 여부 무관 통합 추적)
- **B2**: departure 즉시 `CANCELED` (상태/프로세스 분리, enum 추가 없음)
- **B3**: 비동기 enqueue + 기존 cron drain (동기 루프 금지)
- **B4**: force-cancel 전용 경로 (Phase 4-A `bookedSeats===0` 가드 우회)

## File Structure

| 종류 | 경로 | 책임 |
|---|---|---|
| 수정 | `prisma/schema.prisma` | `DepartureCancellation` 모델 + enum + `RefundJob.cancellationBatchId` + 역참조 |
| 신규 | `prisma/migrations/20260602000000_departure_cancellation/migration.sql` | DDL |
| 신규 | `src/entities/payment/api/enqueueRefundJob.ts` | Phase 1 enqueue-only (dedup) |
| 수정 | `src/entities/payment/index.ts` | barrel |
| 수정 | `src/entities/booking/api/mutations.ts` | `transitionStatusTx` 추출 + `cancelBookingByAgencyTx` |
| 수정 | `src/entities/booking/index.ts` | barrel |
| 신규 | `src/entities/departure-cancellation/model/types.ts` | 배치 타입 |
| 신규 | `src/entities/departure-cancellation/api/recomputeBatchStatus.ts` | 상태 파생·갱신 |
| 신규 | `src/entities/departure-cancellation/api/queries.ts` | 목록·상세 |
| 신규 | `src/entities/departure-cancellation/index.ts` | barrel |
| 신규 | `src/features/admin-departure-cancel/server/actions.ts` | `startDepartureCancellation` + `retryBatchRefundAction` |
| 신규 | `src/features/admin-departure-cancel/index.ts` | barrel |
| 수정 | `src/app/api/cron/process-refunds/route.ts` | drain 후 배치 recompute |
| 신규 | `src/app/(admin)/admin/departure-cancellations/page.tsx` | 배치 목록 |
| 신규 | `src/app/(admin)/admin/departure-cancellations/[id]/page.tsx` | 배치 상세 + 재시도 |
| 수정 | `src/app/(admin)/admin/products/[id]/departures/[depId]/edit/page.tsx` | "강제 취소" 버튼 |
| 후보 | `docs/superpowers/adr/0028-departure-cancel-cascade-batch.md` | ADR |
| 수정 | `CLAUDE.md` §8 | Phase 4-B 완료 노트 |

---

## Task 1 — Prisma 스키마 + 마이그레이션

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260602000000_departure_cancellation/migration.sql`

- [x] **Step 1: schema.prisma 수정**

`enum RefundJobStatus { ... }` 근처에 추가:
```prisma
enum DepartureCancellationStatus {
  PROCESSING
  COMPLETED
  PARTIALLY_FAILED
}

model DepartureCancellation {
  id               String                      @id @default(cuid())
  departureId      String
  status           DepartureCancellationStatus @default(PROCESSING)
  totalBookings    Int
  immediateCancels Int                         @default(0)
  actor            String
  reason           String?
  createdAt        DateTime                    @default(now())
  updatedAt        DateTime                    @updatedAt

  departure  Departure   @relation(fields: [departureId], references: [id], onDelete: Cascade)
  refundJobs RefundJob[]

  @@index([status])
  @@index([departureId])
}
```

`model RefundJob`에 필드 + 인덱스 추가:
```prisma
  cancellationBatchId String?
  cancellationBatch   DepartureCancellation? @relation(fields: [cancellationBatchId], references: [id], onDelete: SetNull)
```
그리고 `model RefundJob`의 `@@index([status, nextRunAt])` 아래에:
```prisma
  @@index([cancellationBatchId])
```

`model Departure`의 관계 블록에 역참조 추가:
```prisma
  cancellations DepartureCancellation[]
```

- [x] **Step 2: 마이그레이션 SQL 작성**

`prisma/migrations/20260602000000_departure_cancellation/migration.sql`:
```sql
-- Phase 4-B — DepartureCancellation 배치 + RefundJob.cancellationBatchId
-- 멱등 재적용 안전(IF NOT EXISTS). enum은 DO 블록으로 가드.

DO $$ BEGIN
  CREATE TYPE "DepartureCancellationStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'PARTIALLY_FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "DepartureCancellation" (
  "id"               TEXT PRIMARY KEY,
  "departureId"      TEXT NOT NULL,
  "status"           "DepartureCancellationStatus" NOT NULL DEFAULT 'PROCESSING',
  "totalBookings"    INTEGER NOT NULL,
  "immediateCancels" INTEGER NOT NULL DEFAULT 0,
  "actor"            TEXT NOT NULL,
  "reason"           TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DepartureCancellation_departureId_fkey"
    FOREIGN KEY ("departureId") REFERENCES "Departure"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "DepartureCancellation_status_idx" ON "DepartureCancellation"("status");
CREATE INDEX IF NOT EXISTS "DepartureCancellation_departureId_idx" ON "DepartureCancellation"("departureId");

ALTER TABLE "RefundJob" ADD COLUMN IF NOT EXISTS "cancellationBatchId" TEXT;
CREATE INDEX IF NOT EXISTS "RefundJob_cancellationBatchId_idx" ON "RefundJob"("cancellationBatchId");
DO $$ BEGIN
  ALTER TABLE "RefundJob" ADD CONSTRAINT "RefundJob_cancellationBatchId_fkey"
    FOREIGN KEY ("cancellationBatchId") REFERENCES "DepartureCancellation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
```

- [x] **Step 3: 마이그레이션 적용** (⚠️ `prisma migrate dev` 불가 — B3/4-A 선례. db execute + resolve 사용)

Run:
```bash
npx prisma db execute --file prisma/migrations/20260602000000_departure_cancellation/migration.sql --schema prisma/schema.prisma
npx prisma migrate resolve --applied 20260602000000_departure_cancellation
npx prisma generate
```
Expected: `Generated Prisma Client` 출력. 에러 0.

- [x] **Step 4: 적용 smoke 확인**

Run:
```bash
npx tsx -e "import {PrismaClient} from '@prisma/client'; const db=new PrismaClient(); db.departureCancellation.count().then(c=>{console.log('DepartureCancellation rows:',c);process.exit(0)})"
```
Expected: `DepartureCancellation rows: 0` (테이블 존재 확인).

- [x] **Step 5: 커밋**
```bash
git add prisma/schema.prisma prisma/migrations/20260602000000_departure_cancellation
git commit -m "feat(db): DepartureCancellation batch + RefundJob.cancellationBatchId (4B Task 1)"
```

---

## Task 2 — enqueueRefundJob + tx 수용 취소 헬퍼 (TDD)

> ⚙️ Backend + 💳 Domain Booking. `transitionStatus`의 자체 tx를 추출해 배치 단일 tx 합류 가능하게.

**Files:**
- Create: `src/entities/payment/api/enqueueRefundJob.ts`
- Create test: `src/entities/payment/api/__tests__/enqueueRefundJob.test.ts`
- Modify: `src/entities/booking/api/mutations.ts` (`transitionStatusTx` 추출 + `cancelBookingByAgencyTx`)
- Create test: `src/entities/booking/api/__tests__/cancelBookingByAgencyTx.test.ts`
- Modify: `src/entities/payment/index.ts`, `src/entities/booking/index.ts` (barrel)

- [x] **Step 1: enqueueRefundJob 실패 테스트**

```ts
// src/entities/payment/api/__tests__/enqueueRefundJob.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  tx: { refundJob: { findFirst: vi.fn(), create: vi.fn() } },
}));

import { enqueueRefundJob } from "../enqueueRefundJob";
import type { Prisma } from "@prisma/client";

beforeEach(() => vi.clearAllMocks());

const args = {
  bookingId: "b1", paymentId: "p1", amount: 1_000_000,
  actor: "admin:a1", reason: "departure canceled", cancellationBatchId: "batch1",
};

describe("enqueueRefundJob", () => {
  it("기존 active job 없으면 PENDING 생성 + batchId 보존", async () => {
    mocks.tx.refundJob.findFirst.mockResolvedValue(null);
    mocks.tx.refundJob.create.mockResolvedValue({ id: "rj1" });
    const res = await enqueueRefundJob(mocks.tx as unknown as Prisma.TransactionClient, args);
    expect(res.enqueued).toBe(true);
    expect(mocks.tx.refundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookingId: "b1", paymentId: "p1", amount: 1_000_000,
          actor: "admin:a1", status: "PENDING", cancellationBatchId: "batch1",
        }),
      }),
    );
  });

  it("기존 active job(PENDING/IN_PROGRESS/SUCCEEDED) 있으면 skip (이중 환불 차단)", async () => {
    mocks.tx.refundJob.findFirst.mockResolvedValue({ id: "existing", status: "PENDING" });
    const res = await enqueueRefundJob(mocks.tx as unknown as Prisma.TransactionClient, args);
    expect(res.enqueued).toBe(false);
    expect(mocks.tx.refundJob.create).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: 실패 확인**

Run: `npx vitest run src/entities/payment/api/__tests__/enqueueRefundJob.test.ts`
Expected: FAIL — `Cannot find module '../enqueueRefundJob'`

- [x] **Step 3: enqueueRefundJob 구현**

```ts
// src/entities/payment/api/enqueueRefundJob.ts
import type { Prisma } from "@prisma/client";

export interface EnqueueRefundJobArgs {
  bookingId: string;
  paymentId: string;
  amount: number;
  actor: string;
  reason?: string;
  cancellationBatchId?: string;
}

/**
 * RefundJob Phase 1 enqueue (PG 호출 없음 — cron이 Phase 2/3 수행).
 * 기존 active job(PENDING/IN_PROGRESS/SUCCEEDED) 존재 시 skip — 이중 환불 차단.
 * nextRunAt=now(default)로 다음 cron tick에 즉시 후보.
 */
export async function enqueueRefundJob(
  tx: Prisma.TransactionClient,
  args: EnqueueRefundJobArgs,
): Promise<{ enqueued: boolean }> {
  const existing = await tx.refundJob.findFirst({
    where: { bookingId: args.bookingId, status: { in: ["PENDING", "IN_PROGRESS", "SUCCEEDED"] } },
    select: { id: true },
  });
  if (existing) return { enqueued: false };

  await tx.refundJob.create({
    data: {
      bookingId: args.bookingId,
      paymentId: args.paymentId,
      amount: args.amount,
      reason: args.reason ?? null,
      actor: args.actor,
      status: "PENDING",
      cancellationBatchId: args.cancellationBatchId ?? null,
    },
    select: { id: true },
  });
  return { enqueued: true };
}
```

- [x] **Step 4: PASS 확인**

Run: `npx vitest run src/entities/payment/api/__tests__/enqueueRefundJob.test.ts`
Expected: PASS

- [x] **Step 5: transitionStatusTx 추출 + cancelBookingByAgencyTx (booking)**

`src/entities/booking/api/mutations.ts`에서 `transitionStatus`의 본문(tx 콜백 내부)을 `transitionStatusTx`로 추출:

```ts
import type { Booking, Prisma } from "@prisma/client";

// tx 수용 코어 — 외부 트랜잭션(배치 fan-out)에 합류 가능.
export async function transitionStatusTx(
  tx: Prisma.TransactionClient,
  { bookingId, to, actor, reason }: TransitionStatusInput,
): Promise<Booking> {
  const current = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
  assertTransition(current.status, to);
  if (shouldReturnSeats(current.status, to)) {
    await releaseSeats(tx, current.departureId, current.adultCount + current.childCount);
  }
  const cancelData =
    to === "CANCELED_BY_USER" || to === "CANCELED_BY_AGENCY"
      ? { canceledAt: new Date(), cancelReason: reason ?? null }
      : {};
  const updated = await tx.booking.update({ where: { id: bookingId }, data: { status: to, ...cancelData } });
  await tx.bookingEvent.create({
    data: { bookingId, fromState: current.status, toState: to, actor, reason: reason ?? null },
  });
  return updated;
}

// 기존 transitionStatus는 래퍼로 (동작 불변, DRY)
export async function transitionStatus(input: TransitionStatusInput): Promise<Booking> {
  return db.$transaction((tx) => transitionStatusTx(tx, input));
}

// 배치 fan-out용 — 미결제 예약을 외부 tx 안에서 즉시 취소(actor는 전체 문자열).
export async function cancelBookingByAgencyTx(
  tx: Prisma.TransactionClient,
  { bookingId, actor, reason }: { bookingId: string; actor: string; reason?: string },
): Promise<Booking> {
  return transitionStatusTx(tx, { bookingId, to: "CANCELED_BY_AGENCY", actor, reason });
}
```

- [x] **Step 6: cancelBookingByAgencyTx 테스트**

```ts
// src/entities/booking/api/__tests__/cancelBookingByAgencyTx.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  tx: {
    booking: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    bookingEvent: { create: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));
vi.mock("@/shared/lib/db", () => ({ db: { $transaction: vi.fn() } }));

import { cancelBookingByAgencyTx } from "../mutations";
import type { Prisma } from "@prisma/client";

beforeEach(() => vi.clearAllMocks());

it("PAID booking → CANCELED_BY_AGENCY 전이 + 좌석 환원(releaseSeats raw 호출)", async () => {
  mocks.tx.booking.findUniqueOrThrow.mockResolvedValue({
    id: "b1", status: "PAID", departureId: "d1", adultCount: 2, childCount: 1,
  });
  mocks.tx.booking.update.mockResolvedValue({ id: "b1", status: "CANCELED_BY_AGENCY" });
  await cancelBookingByAgencyTx(mocks.tx as unknown as Prisma.TransactionClient, {
    bookingId: "b1", actor: "admin:a1", reason: "departure canceled",
  });
  // shouldReturnSeats(PAID→CANCELED_BY_AGENCY)=true → releaseSeats가 $executeRaw 호출
  expect(mocks.tx.$executeRaw).toHaveBeenCalled();
  expect(mocks.tx.booking.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: "CANCELED_BY_AGENCY" }) }),
  );
  expect(mocks.tx.bookingEvent.create).toHaveBeenCalled();
});
```

> `releaseSeats`는 `tx.$executeRaw`(태그드 템플릿)를 호출하므로 mock의 `$executeRaw`가 불린다. (seatLock.ts 참조.)

- [x] **Step 7: 테스트 통과 + barrel 갱신**

`src/entities/payment/index.ts`에 추가:
```ts
export { enqueueRefundJob } from "./api/enqueueRefundJob";
export type { EnqueueRefundJobArgs } from "./api/enqueueRefundJob";
```
`src/entities/booking/index.ts`에 추가:
```ts
export { transitionStatusTx, cancelBookingByAgencyTx } from "./api/mutations";
```

Run: `npx vitest run src/entities/payment src/entities/booking && npx tsc --noEmit`
Expected: 전 테스트 PASS, 타입 에러 0 (기존 refundBooking/transitionStatus 동작 불변).

- [x] **Step 8: 커밋**
```bash
git add src/entities/payment src/entities/booking
git commit -m "feat(payment,booking): enqueueRefundJob + tx-accepting cancel helpers (4B Task 2)"
```

---

## Task 3 — departure-cancellation entity: recompute + queries (TDD)

**Files:**
- Create: `src/entities/departure-cancellation/model/types.ts`
- Create: `src/entities/departure-cancellation/api/recomputeBatchStatus.ts`
- Create test: `src/entities/departure-cancellation/api/__tests__/recomputeBatchStatus.test.ts`
- Create: `src/entities/departure-cancellation/api/queries.ts`
- Create: `src/entities/departure-cancellation/index.ts`

- [x] **Step 1: 타입**

```ts
// src/entities/departure-cancellation/model/types.ts
import type { DepartureCancellation, RefundJob } from "@prisma/client";
export type { DepartureCancellationStatus } from "@prisma/client";

export type CancellationBatchRow = DepartureCancellation & {
  departureLabel: string; // "상품명 · 출발일"
  succeeded: number;
  failed: number;
  pending: number;
};

export type CancellationBatchDetail = DepartureCancellation & {
  jobs: Pick<RefundJob, "id" | "bookingId" | "status" | "attempts" | "lastError">[];
};
```

- [x] **Step 2: recomputeBatchStatus 실패 테스트**

```ts
// src/entities/departure-cancellation/api/__tests__/recomputeBatchStatus.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    refundJob: { findMany: vi.fn() },
    departureCancellation: { update: vi.fn() },
  },
}));
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));

import { recomputeBatchStatus } from "../recomputeBatchStatus";

beforeEach(() => vi.clearAllMocks());

function jobs(statuses: string[]) {
  mocks.db.refundJob.findMany.mockResolvedValue(statuses.map((s) => ({ status: s })));
  mocks.db.departureCancellation.update.mockResolvedValue({});
}

describe("recomputeBatchStatus", () => {
  it("PENDING/IN_PROGRESS 남아있으면 PROCESSING", async () => {
    jobs(["SUCCEEDED", "PENDING"]);
    expect(await recomputeBatchStatus("batch1")).toBe("PROCESSING");
  });
  it("전부 종결 + FAILED 존재 → PARTIALLY_FAILED", async () => {
    jobs(["SUCCEEDED", "FAILED"]);
    expect(await recomputeBatchStatus("batch1")).toBe("PARTIALLY_FAILED");
  });
  it("전부 SUCCEEDED → COMPLETED", async () => {
    jobs(["SUCCEEDED", "SUCCEEDED"]);
    expect(await recomputeBatchStatus("batch1")).toBe("COMPLETED");
  });
  it("job 0건(미결제만) → COMPLETED", async () => {
    jobs([]);
    expect(await recomputeBatchStatus("batch1")).toBe("COMPLETED");
  });
  it("계산된 status를 배치 row에 update", async () => {
    jobs(["FAILED"]);
    await recomputeBatchStatus("batch1");
    expect(mocks.db.departureCancellation.update).toHaveBeenCalledWith({
      where: { id: "batch1" },
      data: { status: "PARTIALLY_FAILED" },
    });
  });
});
```

- [x] **Step 3: 실패 확인**

Run: `npx vitest run src/entities/departure-cancellation/api/__tests__/recomputeBatchStatus.test.ts`
Expected: FAIL — module 없음

- [x] **Step 4: recomputeBatchStatus 구현**

```ts
// src/entities/departure-cancellation/api/recomputeBatchStatus.ts
import type { DepartureCancellationStatus } from "@prisma/client";
import { db } from "@/shared/lib/db";

/**
 * 배치 status를 RefundJob(cancellationBatchId) 상태에서 파생·갱신.
 * RefundJob 상태가 SSOT, 배치 status는 그 투영. (entity 간 import 0 — db 직접 조회)
 */
export async function recomputeBatchStatus(
  batchId: string,
): Promise<DepartureCancellationStatus> {
  const jobs = await db.refundJob.findMany({
    where: { cancellationBatchId: batchId },
    select: { status: true },
  });
  const pending = jobs.filter((j) => j.status === "PENDING" || j.status === "IN_PROGRESS").length;
  const failed = jobs.filter((j) => j.status === "FAILED").length;

  const status: DepartureCancellationStatus =
    pending > 0 ? "PROCESSING" : failed > 0 ? "PARTIALLY_FAILED" : "COMPLETED";

  await db.departureCancellation.update({ where: { id: batchId }, data: { status } });
  return status;
}
```

- [x] **Step 5: PASS 확인**

Run: `npx vitest run src/entities/departure-cancellation/api/__tests__/recomputeBatchStatus.test.ts`
Expected: PASS

- [x] **Step 6: queries + barrel**

```ts
// src/entities/departure-cancellation/api/queries.ts
import { db } from "@/shared/lib/db";
import type { CancellationBatchRow, CancellationBatchDetail } from "../model/types";

export async function listCancellationBatches(): Promise<CancellationBatchRow[]> {
  const rows = await db.departureCancellation.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      departure: { select: { departureDate: true, product: { select: { title: true } } } },
      refundJobs: { select: { status: true } },
    },
  });
  return rows.map((r) => {
    const succeeded = r.refundJobs.filter((j) => j.status === "SUCCEEDED").length;
    const failed = r.refundJobs.filter((j) => j.status === "FAILED").length;
    const pending = r.refundJobs.filter((j) => j.status === "PENDING" || j.status === "IN_PROGRESS").length;
    const { refundJobs: _omit, departure, ...batch } = r;
    return {
      ...batch,
      departureLabel: `${departure.product.title} · ${new Date(departure.departureDate).toLocaleDateString("ko-KR")}`,
      succeeded, failed, pending,
    };
  });
}

export async function getCancellationBatchDetail(id: string): Promise<CancellationBatchDetail | null> {
  const row = await db.departureCancellation.findUnique({
    where: { id },
    include: {
      refundJobs: {
        select: { id: true, bookingId: true, status: true, attempts: true, lastError: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!row) return null;
  const { refundJobs, ...batch } = row;
  return { ...batch, jobs: refundJobs };
}
```

```ts
// src/entities/departure-cancellation/index.ts
export { recomputeBatchStatus } from "./api/recomputeBatchStatus";
export { listCancellationBatches, getCancellationBatchDetail } from "./api/queries";
export type {
  CancellationBatchRow,
  CancellationBatchDetail,
  DepartureCancellationStatus,
} from "./model/types";
```

- [x] **Step 7: typecheck + 테스트**

Run: `npx tsc --noEmit && npx vitest run src/entities/departure-cancellation`
Expected: 타입 에러 0, 테스트 PASS

- [x] **Step 8: 커밋**
```bash
git add src/entities/departure-cancellation
git commit -m "feat(departure-cancellation): batch status recompute + queries (4B Task 3)"
```

---

## Task 4 — startDepartureCancellation 오케스트레이션 + 재시도 액션 (TDD)

> 💳 + ⚙️ 필수. features 레이어가 다수 entity 조합. **단일 tx·외부 IO 0.**

**Files:**
- Create: `src/features/admin-departure-cancel/server/actions.ts`
- Create test: `src/features/admin-departure-cancel/server/__tests__/actions.test.ts`
- Create: `src/features/admin-departure-cancel/index.ts`

- [ ] **Step 1: 실패 테스트**

```ts
// src/features/admin-departure-cancel/server/__tests__/actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidatePath: vi.fn(),
  enqueueRefundJob: vi.fn(),
  cancelBookingByAgencyTx: vi.fn(),
  recomputeBatchStatus: vi.fn(),
  tx: {
    departure: { updateMany: vi.fn() },
    booking: { findMany: vi.fn() },
    departureCancellation: { create: vi.fn(), update: vi.fn() },
  },
  db: { $transaction: vi.fn() },
}));

vi.mock("@/features/auth/server/auth", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath, revalidateTag: vi.fn() }));
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
vi.mock("@/entities/payment", () => ({ enqueueRefundJob: mocks.enqueueRefundJob }));
vi.mock("@/entities/booking", () => ({ cancelBookingByAgencyTx: mocks.cancelBookingByAgencyTx }));
vi.mock("@/entities/departure-cancellation", () => ({ recomputeBatchStatus: mocks.recomputeBatchStatus }));

import { startDepartureCancellation } from "../actions";

beforeEach(() => {
  vi.clearAllMocks();
  // $transaction(cb) → cb(tx) 실행
  mocks.db.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(mocks.tx));
  mocks.tx.departureCancellation.create.mockResolvedValue({ id: "batch1" });
  mocks.tx.departureCancellation.update.mockResolvedValue({});
});

describe("startDepartureCancellation", () => {
  it("이미 CANCELED(또는 부재) → DepartureNotCancelableError (배치 미생성)", async () => {
    mocks.tx.departure.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      startDepartureCancellation({ departureId: "d1", actor: "admin:a1" }),
    ).rejects.toThrow(); // DepartureNotCancelableError
    expect(mocks.tx.departureCancellation.create).not.toHaveBeenCalled();
  });

  it("PAID→enqueue / 미결제→인라인 취소 / 카운트 정확", async () => {
    mocks.tx.departure.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.booking.findMany.mockResolvedValue([
      { id: "b1", status: "PAID", payments: [{ id: "p1", amount: 100, tossPaymentKey: "tk1" }] },
      { id: "b2", status: "DEPARTURE_CONFIRMED", payments: [] },
    ]);
    mocks.enqueueRefundJob.mockResolvedValue({ enqueued: true });
    const res = await startDepartureCancellation({ departureId: "d1", actor: "admin:a1", reason: "운영 취소" });
    expect(res.batchId).toBe("batch1");
    expect(res.enqueued).toBe(1);
    expect(res.immediate).toBe(1);
    expect(mocks.enqueueRefundJob).toHaveBeenCalledTimes(1);
    expect(mocks.cancelBookingByAgencyTx).toHaveBeenCalledTimes(1);
    // PROCESSING (enqueued>0)
    expect(mocks.tx.departureCancellation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PROCESSING", immediateCancels: 1 }) }),
    );
  });

  it("PAID인데 payment 부재 → RefundablePaymentMissingError(롤백)", async () => {
    mocks.tx.departure.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.booking.findMany.mockResolvedValue([{ id: "b1", status: "PAID", payments: [] }]);
    await expect(
      startDepartureCancellation({ departureId: "d1", actor: "admin:a1" }),
    ).rejects.toThrow();
  });

  it("활성 예약 0건 → 배치 COMPLETED 즉시", async () => {
    mocks.tx.departure.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.booking.findMany.mockResolvedValue([]);
    const res = await startDepartureCancellation({ departureId: "d1", actor: "admin:a1" });
    expect(res.enqueued).toBe(0);
    expect(mocks.tx.departureCancellation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }),
    );
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/features/admin-departure-cancel/server/__tests__/actions.test.ts`
Expected: FAIL — module 없음

- [ ] **Step 3: 구현**

```ts
// src/features/admin-departure-cancel/server/actions.ts
"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { auth } from "@/features/auth/server/auth";
import { db } from "@/shared/lib/db";
import { enqueueRefundJob } from "@/entities/payment";
import { cancelBookingByAgencyTx } from "@/entities/booking";
import { recomputeBatchStatus } from "@/entities/departure-cancellation";
import { tagDeparturesByProduct } from "@/entities/departure";
import type { BookingStatus } from "@prisma/client";

export class DepartureNotCancelableError extends Error {
  constructor(public readonly departureId: string) {
    super(`Departure ${departureId} is not cancelable (already canceled or missing)`);
    this.name = "DepartureNotCancelableError";
  }
}
export class RefundablePaymentMissingError extends Error {
  constructor(public readonly bookingId: string) {
    super(`PAID booking ${bookingId} has no payment row`);
    this.name = "RefundablePaymentMissingError";
  }
}

// 좌석 점유(활성) 상태 — booking transitions SEAT_HELD_STATES와 동일.
const SEAT_HELD_STATES: BookingStatus[] = [
  "RECEIVED", "AWAITING_GROUP", "DEPARTURE_CONFIRMED", "PAID", "READY",
];
const REFUNDABLE: BookingStatus[] = ["PAID", "READY"];

export interface StartCancellationInput {
  departureId: string;
  actor: string; // "admin:<id>"
  reason?: string;
}
export interface StartCancellationResult {
  batchId: string;
  total: number;
  enqueued: number;
  immediate: number;
}

export async function startDepartureCancellation(
  input: StartCancellationInput,
): Promise<StartCancellationResult> {
  const { departureId, actor, reason } = input;

  const result = await db.$transaction(async (tx) => {
    // 1. force CAS: 4-A bookedSeats===0 가드 우회
    const cas = await tx.departure.updateMany({
      where: { id: departureId, status: { in: ["SCHEDULED", "CONFIRMED", "CLOSED"] } },
      data: { status: "CANCELED", version: { increment: 1 } },
    });
    if (cas.count === 0) throw new DepartureNotCancelableError(departureId);

    // 2. 활성 예약 + PAID payment 로드
    const bookings = await tx.booking.findMany({
      where: { departureId, status: { in: SEAT_HELD_STATES } },
      select: {
        id: true, status: true,
        payments: { where: { status: "PAID" }, select: { id: true, amount: true, tossPaymentKey: true }, take: 1 },
      },
    });

    // 3. 배치 생성
    const batch = await tx.departureCancellation.create({
      data: { departureId, actor, reason: reason ?? null, totalBookings: bookings.length, status: "PROCESSING" },
      select: { id: true },
    });

    // 4. fan-out (status 기준 분기)
    let immediate = 0, enqueued = 0;
    for (const b of bookings) {
      if (REFUNDABLE.includes(b.status)) {
        const paid = b.payments[0];
        if (!paid) throw new RefundablePaymentMissingError(b.id); // 롤백
        const r = await enqueueRefundJob(tx, {
          bookingId: b.id, paymentId: paid.id, amount: paid.amount,
          actor, reason, cancellationBatchId: batch.id,
        });
        if (r.enqueued) enqueued++;
      } else {
        await cancelBookingByAgencyTx(tx, { bookingId: b.id, actor, reason });
        immediate++;
      }
    }

    // 5. 즉시 종결 여부
    const status = enqueued === 0 ? "COMPLETED" : "PROCESSING";
    await tx.departureCancellation.update({
      where: { id: batch.id },
      data: { immediateCancels: immediate, status },
    });

    return { batchId: batch.id, total: bookings.length, enqueued, immediate, productId: undefined as string | undefined };
  });

  return { batchId: result.batchId, total: result.total, enqueued: result.enqueued, immediate: result.immediate };
}

// 배치 단위 FAILED RefundJob 재시도 — FAILED → PENDING CAS + recompute.
export async function retryBatchRefundAction(formData: FormData): Promise<void> {
  const { redirect } = await import("next/navigation");
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/admin/products");

  const batchId = String(formData.get("batchId") ?? "");
  const jobId = formData.get("jobId"); // 단건 재시도(있으면) / 없으면 배치 전체
  const where = jobId
    ? { id: String(jobId), status: "FAILED" as const }
    : { cancellationBatchId: batchId, status: "FAILED" as const };

  await db.refundJob.updateMany({ where, data: { status: "PENDING", nextRunAt: new Date() } });
  await recomputeBatchStatus(batchId);

  revalidatePath(`/admin/departure-cancellations/${batchId}`);
  redirect(`/admin/departure-cancellations/${batchId}`);
}
```

> `revalidateTag`/`tagDeparturesByProduct` import는 향후 departure 목록 무효화에 사용(force-cancel이 departure status를 바꾸므로). step 5 호출부는 Task 6 UI 연결 시 액션 래퍼에서 수행 — 본 step에서는 import만 두고 lint 통과 위해 사용처가 없으면 제거. (구현자 판단: 사용 안 하면 import 삭제.)

- [ ] **Step 4: PASS 확인**

Run: `npx vitest run src/features/admin-departure-cancel/server/__tests__/actions.test.ts`
Expected: PASS (4 케이스)

- [ ] **Step 5: barrel**

```ts
// src/features/admin-departure-cancel/index.ts
export {
  startDepartureCancellation,
  retryBatchRefundAction,
  DepartureNotCancelableError,
  RefundablePaymentMissingError,
} from "./server/actions";
export type { StartCancellationInput, StartCancellationResult } from "./server/actions";
```

- [ ] **Step 6: typecheck + 커밋**
```bash
npx tsc --noEmit
git add src/features/admin-departure-cancel
git commit -m "feat(admin-departure-cancel): fan-out orchestration + batch retry action (4B Task 4)"
```

---

## Task 5 — cron route 확장: drain 후 배치 recompute (TDD)

**Files:**
- Modify: `src/app/api/cron/process-refunds/route.ts`
- Create test: `src/app/api/cron/process-refunds/__tests__/batch-recompute.test.ts`

- [ ] **Step 1: 실패 테스트** (recompute 호출 검증)

```ts
// src/app/api/cron/process-refunds/__tests__/batch-recompute.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  listDueRefundJobs: vi.fn(),
  retryRefundJob: vi.fn(),
  recomputeBatchStatus: vi.fn(),
  db: { refundJob: { findMany: vi.fn() } },
  env: { CRON_SECRET: "secret" },
}));
vi.mock("@/entities/payment", () => ({
  listDueRefundJobs: mocks.listDueRefundJobs,
  retryRefundJob: mocks.retryRefundJob,
}));
vi.mock("@/entities/departure-cancellation", () => ({ recomputeBatchStatus: mocks.recomputeBatchStatus }));
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
vi.mock("@/shared/lib/env", () => ({ env: mocks.env }));
vi.mock("@/shared/lib/observability", () => ({ logger: { info: vi.fn(), error: vi.fn() }, metrics: { incr: vi.fn() } }));

import { GET } from "../route";

function req() {
  return new Request("http://x/api/cron/process-refunds", {
    headers: { authorization: "Bearer secret" },
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => vi.clearAllMocks());

it("drain한 job들의 distinct batchId에 대해 recomputeBatchStatus 호출", async () => {
  mocks.listDueRefundJobs.mockResolvedValue([{ id: "j1" }, { id: "j2" }, { id: "j3" }]);
  mocks.retryRefundJob.mockResolvedValue({ type: "succeeded", jobId: "x" });
  // 처리된 job들의 batchId 조회: j1,j2 → batchA / j3 → null(단일 사용자 환불)
  mocks.db.refundJob.findMany.mockResolvedValue([
    { cancellationBatchId: "batchA" }, { cancellationBatchId: "batchA" }, { cancellationBatchId: null },
  ]);
  const res = await GET(req());
  expect(res.status).toBe(200);
  // batchA 1회만 (distinct), null은 skip
  expect(mocks.recomputeBatchStatus).toHaveBeenCalledTimes(1);
  expect(mocks.recomputeBatchStatus).toHaveBeenCalledWith("batchA");
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/app/api/cron/process-refunds/__tests__/batch-recompute.test.ts`
Expected: FAIL (recompute 미호출)

- [ ] **Step 3: route.ts 확장**

기존 GET의 job 루프 직후(요약 계산 전)에 배치 recompute 블록 추가:
```ts
import { recomputeBatchStatus } from "@/entities/departure-cancellation";
import { db } from "@/shared/lib/db";

// ... 기존 for 루프로 results 채운 뒤:

// 처리된 job들이 속한 배치를 distinct하게 모아 status 재계산 (null=단일 사용자 환불 skip)
const processedIds = due.map((j) => j.id);
const processedJobs = await db.refundJob.findMany({
  where: { id: { in: processedIds } },
  select: { cancellationBatchId: true },
});
const batchIds = [...new Set(processedJobs.map((j) => j.cancellationBatchId).filter((x): x is string => x !== null))];
for (const batchId of batchIds) {
  await recomputeBatchStatus(batchId);
}
```

> `due`/`results` 변수명은 기존 route.ts 그대로. `processedIds`는 `due`에서 추출. recompute는 try-catch 격리 불필요(자체 안전) but 한 배치 실패가 응답을 막지 않도록 `.catch(()=>{})` 권장.

- [ ] **Step 4: PASS 확인**

Run: `npx vitest run src/app/api/cron/process-refunds/__tests__/batch-recompute.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**
```bash
git add src/app/api/cron/process-refunds
git commit -m "feat(cron): recompute cancellation batch status after refund drain (4B Task 5)"
```

---

## Task 6 — 관찰성 UI + force-cancel 버튼

> 🎨 Frontend: page.tsx `'use client'` 금지. 전이/재시도는 `<form action>`.

**Files:**
- Create: `src/app/(admin)/admin/departure-cancellations/page.tsx`
- Create: `src/app/(admin)/admin/departure-cancellations/[id]/page.tsx`
- Modify: `src/app/(admin)/admin/products/[id]/departures/[depId]/edit/page.tsx`
- Modify: `src/app/(admin)/admin/layout.tsx` (nav 링크)

- [ ] **Step 1: 배치 목록 페이지**

```tsx
// src/app/(admin)/admin/departure-cancellations/page.tsx
import Link from "next/link";
import { listCancellationBatches } from "@/entities/departure-cancellation";
import type { DepartureCancellationStatus } from "@/entities/departure-cancellation";

export const dynamic = "force-dynamic";

const BADGE: Record<DepartureCancellationStatus, string> = {
  PROCESSING: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-green-100 text-green-800",
  PARTIALLY_FAILED: "bg-red-100 text-red-800",
};
const LABEL: Record<DepartureCancellationStatus, string> = {
  PROCESSING: "처리 중", COMPLETED: "완료", PARTIALLY_FAILED: "부분 실패",
};

export default async function CancellationBatchesPage() {
  const rows = await listCancellationBatches();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">출발 취소 배치</h1>
      {rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-400">취소 배치가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-gray-600">
                <th className="px-4 py-3">출발일</th>
                <th className="px-4 py-3 text-center">상태</th>
                <th className="px-4 py-3 text-center">진척</th>
                <th className="px-4 py-3 text-center">실패</th>
                <th className="px-4 py-3">생성</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/departure-cancellations/${r.id}`} className="font-medium text-indigo-700 hover:underline">
                      {r.departureLabel}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE[r.status]}`}>{LABEL[r.status]}</span>
                  </td>
                  <td className="px-4 py-3 text-center">{r.immediateCancels + r.succeeded} / {r.totalBookings}</td>
                  <td className="px-4 py-3 text-center">{r.failed > 0 ? <span className="font-semibold text-red-600">{r.failed}</span> : "—"}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{new Date(r.createdAt).toLocaleString("ko-KR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 배치 상세 + 재시도 페이지**

```tsx
// src/app/(admin)/admin/departure-cancellations/[id]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCancellationBatchDetail } from "@/entities/departure-cancellation";
import { retryBatchRefundAction } from "@/features/admin-departure-cancel";
import type { RefundJobStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const JOB_BADGE: Record<RefundJobStatus, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  SUCCEEDED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
};

type PageProps = { params: Promise<{ id: string }> };

export default async function BatchDetailPage({ params }: PageProps) {
  const { id } = await params;
  const batch = await getCancellationBatchDetail(id);
  if (!batch) notFound();

  const hasFailed = batch.jobs.some((j) => j.status === "FAILED");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/departure-cancellations" className="text-sm text-gray-500 hover:text-gray-700">← 목록</Link>
        <h1 className="text-2xl font-bold text-gray-900">취소 배치 상세</h1>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm">
        <p>총 예약 {batch.totalBookings}건 · 즉시 취소(미결제) {batch.immediateCancels}건 · 환불 job {batch.jobs.length}건</p>
        {batch.reason && <p className="mt-1 text-gray-500">사유: {batch.reason}</p>}
      </div>

      {hasFailed && (
        <form action={retryBatchRefundAction}>
          <input type="hidden" name="batchId" value={batch.id} />
          <button type="submit" className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
            실패 건 전체 재시도
          </button>
        </form>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-600">
              <th className="px-4 py-3">예약 ID</th>
              <th className="px-4 py-3 text-center">환불 상태</th>
              <th className="px-4 py-3 text-center">시도</th>
              <th className="px-4 py-3">오류</th>
              <th className="px-4 py-3 text-center">재시도</th>
            </tr>
          </thead>
          <tbody>
            {batch.jobs.map((j) => (
              <tr key={j.id} className="border-b last:border-0">
                <td className="px-4 py-3 font-mono text-xs">{j.bookingId.slice(-8)}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${JOB_BADGE[j.status]}`}>{j.status}</span>
                </td>
                <td className="px-4 py-3 text-center">{j.attempts}</td>
                <td className="px-4 py-3 text-xs text-red-600">{j.lastError ? j.lastError.slice(0, 80) : "—"}</td>
                <td className="px-4 py-3 text-center">
                  {j.status === "FAILED" && (
                    <form action={retryBatchRefundAction}>
                      <input type="hidden" name="batchId" value={batch.id} />
                      <input type="hidden" name="jobId" value={j.id} />
                      <button type="submit" className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100">재시도</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: departure 편집 페이지 "강제 취소" 버튼**

`src/app/(admin)/admin/products/[id]/departures/[depId]/edit/page.tsx`의 상태 전이 패널에서, `bookedSeats > 0`일 때 비활성이던 취소 버튼을 **강제 취소 form**으로 교체. 파일 상단에 force-cancel 액션 래퍼 import 후 패널 내 CANCELED 분기 처리:

```tsx
// 상단 import
import { startDepartureCancellation } from "@/features/admin-departure-cancel";
import { auth } from "@/features/auth/server/auth";
import { redirect } from "next/navigation";

// 페이지 내부에 form action (서버 액션 인라인 — 'use server')
async function forceCancelAction(formData: FormData) {
  "use server";
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/admin/products");
  const depId = String(formData.get("depId"));
  const res = await startDepartureCancellation({ departureId: depId, actor: `admin:${session.user.id}` });
  redirect(`/admin/departure-cancellations/${res.batchId}`);
}
```

전이 패널의 `CANCELED` 버튼 분기를 다음으로 교체 (`bookedSeats > 0`이면 강제취소 form, 0이면 기존 transitionDepartureAction):
```tsx
{to === "CANCELED" && dep.bookedSeats > 0 ? (
  <form action={forceCancelAction}>
    <input type="hidden" name="depId" value={dep.id} />
    <button type="submit"
      className="w-full rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700">
      강제 취소 ({dep.bookedSeats}건 환불)
    </button>
  </form>
) : (
  /* 기존 transitionDepartureAction form (bookedSeats===0 일반 취소 포함) */
)}
```

> 기존 transitionDepartureAction 버튼 로직은 유지하되, 위 조건 분기만 추가. `cancelBlocked` disabled 로직은 강제취소로 대체되므로 제거.

- [ ] **Step 4: admin layout nav 링크 추가**

`src/app/(admin)/admin/layout.tsx` nav에 추가:
```tsx
<Link href="/admin/departure-cancellations" className="rounded-md px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-100">취소 배치</Link>
```

- [ ] **Step 5: typecheck + lint + 런타임 스모크**

Run:
```bash
npx tsc --noEmit && npx eslint "src/app/(admin)/admin/departure-cancellations" "src/features/admin-departure-cancel"
```
Expected: 0 에러.
런타임: admin 쿠키로 `/admin/departure-cancellations` 200 확인(Task 7 QA에서 수행 가능).

- [ ] **Step 6: 커밋**
```bash
git add "src/app/(admin)/admin/departure-cancellations" "src/app/(admin)/admin/products/[id]/departures/[depId]/edit/page.tsx" "src/app/(admin)/admin/layout.tsx"
git commit -m "feat(admin): cancellation batch observability UI + force-cancel button (4B Task 6)"
```

---

## Task 7 — 종합 QA (부분 실패 시뮬레이션·복구) + ADR + 문서

> 🔬 QA Engineer 강제 발동. **부분 실패 → 재시도 → 복구**가 핵심 evidence.

**Files:**
- Create: `scripts/qa/4b-cascade-qa.ts`
- Create: `docs/superpowers/adr/0028-departure-cancel-cascade-batch.md` (사용자 승인 시)
- Modify: `CLAUDE.md`

- [ ] **Step 1: 전체 typecheck / test / lint**

Run: `npm run typecheck && npx vitest run && npm run lint`
Expected: typecheck 0, 전체 테스트 PASS(신규 4B 포함), lint 에러 0. 출력 인용.

- [ ] **Step 2: 부분 실패 QA 스크립트 작성**

`scripts/qa/4b-cascade-qa.ts` — `4a-departure-qa.ts`의 section/assert 헬퍼 차용. 시나리오:

```
S1) seed product에 임시 departure 생성(SCHEDULED, capacity 10)
S2) 예약 3건 생성: 2건 PAID(synthetic payment + tossPaymentKey), 1건 미결제(DEPARTURE_CONFIRMED)
    — reserveSeats로 bookedSeats 반영
S3) startDepartureCancellation 호출:
    · departure status === CANCELED 확인 (force, bookedSeats>0였음)
    · 배치 생성: totalBookings=3, immediateCancels=1(미결제 즉시), enqueued=2(PAID)
    · 미결제 booking === CANCELED_BY_AGENCY 확인
    · 배치 status === PROCESSING
S4) **부분 실패 주입**: PAID job 2개 중 1개의 payment.tossPaymentKey를 제거(또는 PG mock 실패 유도)
    → process-refunds 1회 실행(retryRefundJob 직접 호출) →
      job A: SUCCEEDED (PG mock 정상) / job B: FAILED 또는 PENDING(backoff)
    → recomputeBatchStatus → PROCESSING 또는 PARTIALLY_FAILED
S5) job B를 강제 FAILED로 만든 뒤 recompute → 배치 PARTIALLY_FAILED 확인
S6) **재시도**: retryBatchRefundAction 경로(또는 updateMany FAILED→PENDING) → recompute → PROCESSING
    → job B 정상 처리(tossPaymentKey 복구) → SUCCEEDED → recompute → COMPLETED 확인
S7) 멱등: startDepartureCancellation 재호출 → DepartureNotCancelableError(이미 CANCELED, 신규 배치 0)
S8) 신규 예약 차단: reserveSeats(canceled dep) → InsufficientCapacityError
정리: 생성한 booking/payment/refundJob/batch/departure 삭제
```

각 단계 DB raw 값(status/count) 인용. assert로 PASS/FAIL 집계.

- [ ] **Step 3: 스크립트 실행 + evidence**

Run: `npx tsx scripts/qa/4b-cascade-qa.ts`
Expected: 전 시나리오 PASS. 특히 **PARTIALLY_FAILED → 재시도 → COMPLETED** 복구 흐름 raw evidence 인용.

- [ ] **Step 4: force-dynamic + 멱등 grep audit**

Run:
```bash
grep -rl "force-dynamic" "src/app/(admin)/admin/departure-cancellations"   # 2개 라우트
grep -n "status: { in: \[" src/features/admin-departure-cancel/server/actions.ts  # force CAS 가드 확인
```

- [ ] **Step 5: ADR-0028 작성** (사용자 승인 시)

`docs/superpowers/adr/0028-departure-cancel-cascade-batch.md` — template 채움:
- Context: 4-A가 막은 취소를 4-B가 fan-out으로 해소
- Decision: 부모 배치 + RefundJob batchId, 즉시 CANCELED(상태/프로세스 분리), enqueue-only로 ADR-0003 재사용, 파생 status
- Consequences: 부분실패 가시성·재시도, 외부 IO Tx 밖, 신규 테이블 1 + enqueue 함수
- Alternatives: 동기 루프(타임아웃)·파생 집계(미결제 누락)·새 CANCELING 상태(enum 비용)
`docs/superpowers/adr/README.md` 인덱스 + "향후 후보" 갱신.

- [ ] **Step 6: CLAUDE.md §8 + plan → done/**

- §8 "Phase 4-B 완료" 마킹 + 노트("출발 취소가 이제 어떻게 동작?", "배치 status는 파생", "부분 실패 재시도").
- `grep -n "\- \[ \]" docs/superpowers/plans/2026-06-02-phase-4b-cancel-cascade-plan.md` → 0 확인(백틱 예시 제외).
- `git mv docs/superpowers/plans/2026-06-02-phase-4b-cancel-cascade-plan.md docs/superpowers/plans/done/`

- [ ] **Step 7: 최종 커밋**
```bash
git add -A
git commit -m "docs(adr): 0028 cancel cascade batch; mark Phase 4-B complete + QA evidence"
```

---

## 종합 검증 체크리스트 (Task 7 inventory)

- [ ] typecheck / test / lint 3종 PASS
- [ ] 혼합 배치(PAID+미결제) 강제취소 → departure 즉시 CANCELED + 배치 PROCESSING
- [ ] 미결제 즉시 취소(immediateCancels) + PAID enqueue(RefundJob batchId)
- [ ] 부분 실패 주입 → 배치 PARTIALLY_FAILED
- [ ] 재시도(FAILED→PENDING) → cron drain → COMPLETED 복구
- [ ] 멱등: 재호출 DepartureNotCancelable (배치 1개)
- [ ] 이중 환불 차단: enqueueRefundJob 중복 게이트
- [ ] CANCELED 후 reserveSeats 신규예약 차단 + 좌석 환원(bookedSeats 감소)
- [ ] 단일 사용자 환불(batchId=null) recompute skip 확인
