# Cron Master Dispatcher 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3개 분리된 cron(refund/email/embedding)을 단일 dispatcher 1개로 통합해 Vercel Hobby cron 제한(2개·1일1회)을 우회하고 배포 체크를 초록으로 만든다.

**Architecture:** refund 인라인 로직을 `shared/lib/refund-job/worker.ts` 순수 워커로 추출하고, 공통 `isCronAuthorized` 가드를 분리한 뒤, 3개 라우트를 얇은 래퍼로 남기고, 신설 dispatcher가 3개 워커를 `Promise.allSettled` 병렬 호출한다. `vercel.json`은 dispatcher 1개 daily cron만 둔다(실시간 2분은 외부 트리거 담당).

**Tech Stack:** Next.js 15 route handler · Prisma 5 · Vitest 2(TDD) · Vercel Cron.

> 참조 스펙: `docs/superpowers/specs/2026-06-04-cron-dispatcher-consolidation-design.md`

---

## File Structure (decomposition)

```
src/shared/lib/cron/authorize.ts                 # 신설: isCronAuthorized(req) 공통 가드
src/shared/lib/cron/__tests__/authorize.test.ts
src/shared/lib/refund-job/worker.ts              # 신설: processRefundJobBatch (route 인라인 추출)
src/shared/lib/refund-job/index.ts               # barrel
src/shared/lib/refund-job/__tests__/worker.test.ts
src/app/api/cron/process-refunds/route.ts        # modify: 얇은 래퍼로 축소
src/app/api/cron/process-refunds/__tests__/route.test.ts   # batch-recompute.test.ts 대체
src/app/api/cron/email-job/route.ts              # modify: isCronAuthorized로 교체
src/app/api/cron/embedding-job/route.ts          # modify: isCronAuthorized로 교체
src/app/api/cron/dispatcher/route.ts             # 신설: Promise.allSettled 3 워커
src/app/api/cron/dispatcher/__tests__/route.test.ts
vercel.json                                      # modify: dispatcher 1개 daily cron
```

---

## Task 1: 공통 cron 가드 `isCronAuthorized` (TDD)

**Files:**
- Create: `src/shared/lib/cron/authorize.ts`
- Test: `src/shared/lib/cron/__tests__/authorize.test.ts`

- [x] **Step 1: 실패하는 테스트**

`src/shared/lib/cron/__tests__/authorize.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({ env: { CRON_SECRET: "x".repeat(32) } }));
vi.mock("@/shared/lib/env", () => ({ env: mocks.env }));

import { isCronAuthorized } from "../authorize";

function req(auth?: string) {
  return {
    headers: {
      get: (k: string) =>
        k.toLowerCase() === "authorization" && auth ? auth : null,
    },
  } as unknown as import("next/server").NextRequest;
}

describe("isCronAuthorized", () => {
  it("올바른 Bearer → true", () => {
    expect(isCronAuthorized(req(`Bearer ${"x".repeat(32)}`))).toBe(true);
  });
  it("틀린 토큰 → false", () => {
    expect(isCronAuthorized(req("Bearer wrong"))).toBe(false);
  });
  it("authorization 헤더 없음 → false", () => {
    expect(isCronAuthorized(req())).toBe(false);
  });
});
```

- [x] **Step 2: 테스트 실패 확인**

Run: `npm run test -- src/shared/lib/cron/__tests__/authorize.test.ts`
Expected: FAIL — `../authorize` 모듈 미존재.

- [x] **Step 3: 구현**

`src/shared/lib/cron/authorize.ts`:
```typescript
import type { NextRequest } from "next/server";
import { env } from "@/shared/lib/env";

// 공통 cron Bearer 가드 (기존 3개 라우트의 isAuthorized 복제 제거).
// CRON_SECRET 미설정이면 어떤 호출도 거부 — production은 env superRefine으로
// 부팅 거부, dev는 호출이 401로 떨어진다.
export function isCronAuthorized(req: NextRequest): boolean {
  if (!env.CRON_SECRET) return false;
  return req.headers.get("authorization") === `Bearer ${env.CRON_SECRET}`;
}
```

- [x] **Step 4: 테스트 통과 확인**

Run: `npm run test -- src/shared/lib/cron/__tests__/authorize.test.ts`
Expected: PASS (3 tests).

- [x] **Step 5: Commit**

```bash
git add src/shared/lib/cron
git commit -m "refactor(cron): extract shared isCronAuthorized guard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: refund 워커 추출 `processRefundJobBatch` (TDD)

`process-refunds/route.ts`의 인라인 로직(~75줄)을 순수 워커로 이전. 동작 보존(배치 recompute·격리 포함).

**Files:**
- Create: `src/shared/lib/refund-job/worker.ts`
- Create: `src/shared/lib/refund-job/index.ts`
- Test: `src/shared/lib/refund-job/__tests__/worker.test.ts`

- [x] **Step 1: 실패하는 테스트** (기존 batch-recompute 검증을 워커 대상으로 이전 + 격리 케이스 추가)

`src/shared/lib/refund-job/__tests__/worker.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  listDueRefundJobs: vi.fn(),
  retryRefundJob: vi.fn(),
  recomputeBatchStatus: vi.fn(),
  db: { refundJob: { findMany: vi.fn() } },
}));
vi.mock("@/entities/payment", () => ({
  listDueRefundJobs: mocks.listDueRefundJobs,
  retryRefundJob: mocks.retryRefundJob,
}));
vi.mock("@/entities/departure-cancellation", () => ({
  recomputeBatchStatus: mocks.recomputeBatchStatus,
}));
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
vi.mock("@/shared/lib/observability", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  metrics: { incr: vi.fn() },
}));

import { processRefundJobBatch } from "../worker";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recomputeBatchStatus.mockResolvedValue("COMPLETED");
});

describe("processRefundJobBatch", () => {
  it("drain한 job들의 distinct batchId에 recompute 호출 (null=단일 사용자 환불 skip)", async () => {
    mocks.listDueRefundJobs.mockResolvedValue([{ id: "j1" }, { id: "j2" }, { id: "j3" }]);
    mocks.retryRefundJob.mockResolvedValue({ type: "succeeded", jobId: "x" });
    mocks.db.refundJob.findMany.mockResolvedValue([
      { cancellationBatchId: "batchA" },
      { cancellationBatchId: "batchA" },
      { cancellationBatchId: null },
    ]);

    const result = await processRefundJobBatch({ limit: 10 });

    expect(result.processed).toBe(3);
    expect(mocks.recomputeBatchStatus).toHaveBeenCalledTimes(1);
    expect(mocks.recomputeBatchStatus).toHaveBeenCalledWith("batchA");
  });

  it("due job 0건이면 recompute 미호출 + processed 0", async () => {
    mocks.listDueRefundJobs.mockResolvedValue([]);
    const result = await processRefundJobBatch({ limit: 10 });
    expect(result.processed).toBe(0);
    expect(result.results).toEqual([]);
    expect(mocks.recomputeBatchStatus).not.toHaveBeenCalled();
  });

  it("한 job throw → 격리(error 결과) + 루프 계속", async () => {
    mocks.listDueRefundJobs.mockResolvedValue([{ id: "j1" }, { id: "j2" }]);
    mocks.retryRefundJob
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce({ type: "succeeded", jobId: "j2" });
    mocks.db.refundJob.findMany.mockResolvedValue([
      { cancellationBatchId: null },
      { cancellationBatchId: null },
    ]);

    const result = await processRefundJobBatch({ limit: 10 });

    expect(result.processed).toBe(2);
    expect(result.results.some((r) => r.type === "error")).toBe(true);
  });
});
```

- [x] **Step 2: 테스트 실패 확인**

Run: `npm run test -- src/shared/lib/refund-job/__tests__/worker.test.ts`
Expected: FAIL — `../worker` 미존재.

- [x] **Step 3: 워커 구현** (route 인라인 로직 그대로 이전)

`src/shared/lib/refund-job/worker.ts`:
```typescript
/**
 * RefundJob backoff 큐 워커 — process-refunds 라우트에서 추출.
 * email/embedding 워커와 동형(shared/lib/*-job/worker.ts). 백그라운드 워커
 * 레이어의 FSD 예외로 @/entities/* 직접 import 허용(ADR-0026/0030 선례).
 */
import {
  listDueRefundJobs,
  retryRefundJob,
  type RetryRefundResult,
} from "@/entities/payment";
import { recomputeBatchStatus } from "@/entities/departure-cancellation";
import { db } from "@/shared/lib/db";
import { logger, metrics } from "@/shared/lib/observability";

export interface RefundBatchResult {
  processed: number;
  summary: Record<string, number>;
  results: (RetryRefundResult | { type: "error"; jobId: string; error: string })[];
}

export async function processRefundJobBatch(opts: {
  limit: number;
}): Promise<RefundBatchResult> {
  const due = await listDueRefundJobs(opts.limit);
  if (due.length === 0) {
    return { processed: 0, summary: {}, results: [] };
  }

  const results: RefundBatchResult["results"] = [];
  for (const job of due) {
    try {
      results.push(await retryRefundJob(job.id));
    } catch (err) {
      // 격리: 한 job의 예측 못한 예외가 루프를 막지 않게. retryRefundJob 내부는
      // 이미 PaymentError 처리 → 이 catch는 진짜 예상 밖(DB 단절 등) 전용.
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        "cron.refund.job_unexpected_error",
        err instanceof Error ? err : new Error(msg),
        { jobId: job.id },
      );
      metrics.incr("cron.refund.unexpected_error");
      results.push({ type: "error", jobId: job.id, error: msg });
    }
  }

  // 처리된 job들이 속한 출발-취소 배치를 distinct하게 모아 status 재계산. [ADR-0028]
  // null(단일 사용자 환불)은 skip. recompute 실패가 응답을 막지 않도록 격리(.catch).
  const processedIds = due.map((j) => j.id);
  const processedJobs = await db.refundJob.findMany({
    where: { id: { in: processedIds } },
    select: { cancellationBatchId: true },
  });
  const batchIds = [
    ...new Set(
      processedJobs
        .map((j) => j.cancellationBatchId)
        .filter((x): x is string => x !== null),
    ),
  ];
  for (const batchId of batchIds) {
    await recomputeBatchStatus(batchId).catch((err) => {
      logger.error(
        "cron.refund.batch_recompute_failed",
        err instanceof Error ? err : new Error(String(err)),
        { batchId },
      );
    });
  }

  const summary = results.reduce(
    (acc, r) => {
      acc[r.type] = (acc[r.type] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  logger.info("cron.refund.run", { processed: results.length, summary });
  return { processed: results.length, summary, results };
}
```

- [x] **Step 4: barrel**

`src/shared/lib/refund-job/index.ts`:
```typescript
export { processRefundJobBatch } from "./worker";
export type { RefundBatchResult } from "./worker";
```

- [x] **Step 5: 테스트 통과 + typecheck**

Run: `npm run test -- src/shared/lib/refund-job/__tests__/worker.test.ts && npm run typecheck`
Expected: PASS (3 tests) + typecheck clean.

- [x] **Step 6: Commit**

```bash
git add src/shared/lib/refund-job
git commit -m "refactor(refund): extract processRefundJobBatch worker from cron route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 3개 라우트를 얇은 래퍼로 정리

**Files:**
- Modify: `src/app/api/cron/process-refunds/route.ts`
- Delete: `src/app/api/cron/process-refunds/__tests__/batch-recompute.test.ts`
- Create: `src/app/api/cron/process-refunds/__tests__/route.test.ts`
- Modify: `src/app/api/cron/email-job/route.ts`
- Modify: `src/app/api/cron/embedding-job/route.ts`

- [x] **Step 1: process-refunds 라우트를 얇은 래퍼로 교체**

`src/app/api/cron/process-refunds/route.ts` 전체를 다음으로 교체:
```typescript
/**
 * RefundJob 큐 cron worker — 얇은 래퍼. 로직은 shared/lib/refund-job/worker.
 * 외부 트리거의 per-worker 개별 호출 진입점으로 유지(dispatcher와 별개).
 */
import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/shared/lib/cron/authorize";
import { processRefundJobBatch } from "@/shared/lib/refund-job/worker";
import { logger, metrics } from "@/shared/lib/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await processRefundJobBatch({ limit: 10 });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      "cron.refund.unexpected_error",
      err instanceof Error ? err : new Error(msg),
    );
    metrics.incr("cron.refund.unexpected_error");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
```

- [x] **Step 2: 기존 batch-recompute 테스트 삭제 + 얇은 래퍼 테스트 생성**

Run: `git rm src/app/api/cron/process-refunds/__tests__/batch-recompute.test.ts`
(배치 recompute 검증은 Task 2 워커 테스트로 이전됨.)

`src/app/api/cron/process-refunds/__tests__/route.test.ts` 생성:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  processRefundJobBatch: vi.fn(),
  env: { CRON_SECRET: "x".repeat(32) },
}));
vi.mock("@/shared/lib/refund-job/worker", () => ({
  processRefundJobBatch: mocks.processRefundJobBatch,
}));
vi.mock("@/shared/lib/env", () => ({ env: mocks.env }));
vi.mock("@/shared/lib/observability", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  metrics: { incr: vi.fn() },
}));

import { GET } from "../route";

function req(auth?: string) {
  return new NextRequest("http://localhost/api/cron/process-refunds", {
    headers: auth ? { authorization: auth } : {},
  });
}

describe("GET /api/cron/process-refunds (얇은 래퍼)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("CRON_SECRET 불일치 → 401, 워커 미호출", async () => {
    const res = await GET(req("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(mocks.processRefundJobBatch).not.toHaveBeenCalled();
  });

  it("인증 통과 → 워커 위임(limit 10) + 결과 JSON", async () => {
    mocks.processRefundJobBatch.mockResolvedValue({
      processed: 1,
      summary: { succeeded: 1 },
      results: [],
    });
    const res = await GET(req(`Bearer ${"x".repeat(32)}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ processed: 1 });
    expect(mocks.processRefundJobBatch).toHaveBeenCalledWith({ limit: 10 });
  });
});
```

- [x] **Step 3: email-job 라우트를 공통 가드로 교체**

`src/app/api/cron/email-job/route.ts`에서 로컬 `isAuthorized` 함수를 제거하고 공통 가드를 import. import 블록과 호출부를 다음과 같이 변경:
- import 추가: `import { isCronAuthorized } from "@/shared/lib/cron/authorize";`
- 기존 `function isAuthorized(req: NextRequest): boolean { ... }` 블록 **전체 삭제**.
- 핸들러의 `if (!isAuthorized(req))` → `if (!isCronAuthorized(req))`.

변경 후 `email-job/route.ts` 전체는 다음과 같다:
```typescript
/**
 * EmailJob 배치 처리 cron worker — 얇은 래퍼.
 * force-dynamic: ADR-0020 안전 도메인(cron). runtime=nodejs: Prisma/Resend 사용.
 */
import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/shared/lib/cron/authorize";
import { processEmailJobBatch } from "@/shared/lib/email-job/worker";
import { logger, metrics } from "@/shared/lib/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await processEmailJobBatch({ limit: 10 });
    logger.info("cron.email-job.run", { ...result });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      "cron.email-job.unexpected_error",
      err instanceof Error ? err : new Error(msg),
    );
    metrics.incr("cron.email-job.unexpected_error");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
```

- [x] **Step 4: embedding-job 라우트를 공통 가드로 교체**

`src/app/api/cron/embedding-job/route.ts`에서 로컬 `isAuthorized` 제거 + 공통 가드 사용. 변경 후 전체:
```typescript
/**
 * EmbeddingJob 배치 처리 cron worker — 얇은 래퍼.
 * force-dynamic: ADR-0020 안전 도메인(cron). runtime=nodejs: worker가 Prisma 사용.
 */
import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/shared/lib/cron/authorize";
import { processEmbeddingJobBatch } from "@/shared/lib/embedding-job/worker";
import { logger, metrics } from "@/shared/lib/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await processEmbeddingJobBatch({ limit: 5 });
    logger.info("cron.embedding-job.run", {
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
      skipped: result.skipped,
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      "cron.embedding-job.unexpected_error",
      err instanceof Error ? err : new Error(msg),
    );
    metrics.incr("cron.embedding-job.unexpected_error");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
```

- [x] **Step 5: 테스트 + typecheck**

Run: `npm run test -- src/app/api/cron && npm run typecheck`
Expected: PASS — process-refunds route.test(2) + email route.test(2) + embedding route.test(기존) 모두 그린. email/embedding 테스트는 `@/shared/lib/env` mock으로 `isCronAuthorized`가 통과(가드가 env 읽음).

- [x] **Step 6: Commit**

```bash
git add src/app/api/cron/process-refunds src/app/api/cron/email-job/route.ts src/app/api/cron/embedding-job/route.ts
git commit -m "refactor(cron): thin-wrap 3 routes over shared workers + guard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Master Dispatcher 신설 (TDD)

**Files:**
- Create: `src/app/api/cron/dispatcher/route.ts`
- Test: `src/app/api/cron/dispatcher/__tests__/route.test.ts`

- [x] **Step 1: 실패하는 테스트**

`src/app/api/cron/dispatcher/__tests__/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  processRefundJobBatch: vi.fn(),
  processEmailJobBatch: vi.fn(),
  processEmbeddingJobBatch: vi.fn(),
  env: { CRON_SECRET: "x".repeat(32) },
}));
vi.mock("@/shared/lib/refund-job/worker", () => ({
  processRefundJobBatch: mocks.processRefundJobBatch,
}));
vi.mock("@/shared/lib/email-job/worker", () => ({
  processEmailJobBatch: mocks.processEmailJobBatch,
}));
vi.mock("@/shared/lib/embedding-job/worker", () => ({
  processEmbeddingJobBatch: mocks.processEmbeddingJobBatch,
}));
vi.mock("@/shared/lib/env", () => ({ env: mocks.env }));
vi.mock("@/shared/lib/observability", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  metrics: { incr: vi.fn() },
}));

import { GET } from "../route";

const AUTH = `Bearer ${"x".repeat(32)}`;
function req(auth?: string) {
  return new NextRequest("http://localhost/api/cron/dispatcher", {
    headers: auth ? { authorization: auth } : {},
  });
}

describe("GET /api/cron/dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.processRefundJobBatch.mockResolvedValue({ processed: 0, summary: {}, results: [] });
    mocks.processEmailJobBatch.mockResolvedValue({ processed: 2, succeeded: 2, failed: 0, skipped: 0 });
    mocks.processEmbeddingJobBatch.mockResolvedValue({ processed: 1, succeeded: 1, failed: 0, skipped: 0 });
  });

  it("미인증 → 401, 어떤 워커도 미호출", async () => {
    const res = await GET(req("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(mocks.processRefundJobBatch).not.toHaveBeenCalled();
    expect(mocks.processEmailJobBatch).not.toHaveBeenCalled();
    expect(mocks.processEmbeddingJobBatch).not.toHaveBeenCalled();
  });

  it("인증 통과 → 3개 워커 모두 호출(limit 보존) + 통합 결과", async () => {
    const res = await GET(req(AUTH));
    expect(res.status).toBe(200);
    expect(mocks.processRefundJobBatch).toHaveBeenCalledWith({ limit: 10 });
    expect(mocks.processEmailJobBatch).toHaveBeenCalledWith({ limit: 10 });
    expect(mocks.processEmbeddingJobBatch).toHaveBeenCalledWith({ limit: 5 });
    const body = await res.json();
    expect(body.workers).toHaveLength(3);
    expect(body.workers.map((w: { worker: string }) => w.worker)).toEqual([
      "refund",
      "email",
      "embedding",
    ]);
  });

  it("한 워커 reject → 200 유지, 해당 워커만 rejected (allSettled 격리)", async () => {
    mocks.processEmbeddingJobBatch.mockRejectedValue(new Error("openai down"));
    const res = await GET(req(AUTH));
    expect(res.status).toBe(200);
    const body = await res.json();
    const emb = body.workers.find((w: { worker: string }) => w.worker === "embedding");
    expect(emb.status).toBe("rejected");
    expect(emb.error).toContain("openai down");
    const email = body.workers.find((w: { worker: string }) => w.worker === "email");
    expect(email.status).toBe("fulfilled");
  });
});
```

- [x] **Step 2: 테스트 실패 확인**

Run: `npm run test -- src/app/api/cron/dispatcher/__tests__/route.test.ts`
Expected: FAIL — `../route` 미존재.

- [x] **Step 3: dispatcher 구현**

`src/app/api/cron/dispatcher/route.ts`:
```typescript
/**
 * Master cron Dispatcher — 단일 진입점. refund/email/embedding 워커를
 * Promise.allSettled로 병렬 실행(워커 단위 격리). 한 워커 throw가 전체를
 * 죽이지 않음(각 워커는 내부에서 per-job 격리). Vercel cron은 이 1개만 호출
 * (Hobby 제한 우회), 실시간 2분 주기는 외부 트리거가 담당.
 *
 * force-dynamic: ADR-0020 안전 도메인(cron). runtime=nodejs: 워커가 Prisma/Resend 사용.
 */
import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/shared/lib/cron/authorize";
import { processRefundJobBatch } from "@/shared/lib/refund-job/worker";
import { processEmailJobBatch } from "@/shared/lib/email-job/worker";
import { processEmbeddingJobBatch } from "@/shared/lib/embedding-job/worker";
import { logger } from "@/shared/lib/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKERS = [
  { name: "refund", run: () => processRefundJobBatch({ limit: 10 }) },
  { name: "email", run: () => processEmailJobBatch({ limit: 10 }) },
  { name: "embedding", run: () => processEmbeddingJobBatch({ limit: 5 }) },
] as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settled = await Promise.allSettled(WORKERS.map((w) => w.run()));
  const workers = settled.map((s, i) => {
    const worker = WORKERS[i].name;
    if (s.status === "fulfilled") {
      return { worker, status: "fulfilled" as const, ...s.value };
    }
    const error = s.reason instanceof Error ? s.reason.message : String(s.reason);
    return { worker, status: "rejected" as const, error };
  });

  logger.info("cron.dispatcher.run", {
    workers: workers.map((w) => ({ worker: w.worker, status: w.status })),
  });
  return NextResponse.json({ ranAt: new Date().toISOString(), workers });
}
```

- [x] **Step 4: 테스트 통과 + typecheck**

Run: `npm run test -- src/app/api/cron/dispatcher/__tests__/route.test.ts && npm run typecheck`
Expected: PASS (3 tests) + typecheck clean. (`...s.value` union spread는 strict에서 허용 — `any` 불요. 만약 spread 타입 오류가 나면 `...(s.value as Record<string, unknown>)` 대신 명시적으로 `result: s.value` 중첩으로 변경하되 `any` 금지.)

- [x] **Step 5: Commit**

```bash
git add src/app/api/cron/dispatcher
git commit -m "feat(cron): Master Dispatcher — Promise.allSettled over 3 workers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `vercel.json` 단일 daily cron

**Files:**
- Modify: `vercel.json`

- [x] **Step 1: crons 배열 교체**

`vercel.json`의 `"crons"` 배열을 다음 단일 항목으로 교체(다른 키는 보존):
```json
  "crons": [
    { "path": "/api/cron/dispatcher", "schedule": "0 0 * * *" }
  ]
```
(기존 process-refunds/embedding-job/email-job 3개 항목 제거. Vercel Hobby: cron ≤2개 + 1일1회 제약 충족 → 배포 통과. 실시간 2분 주기는 외부 트리거가 dispatcher 또는 개별 래퍼 라우트를 호출.)

- [x] **Step 2: JSON 유효성 + cron 1개 확인**

Run: `node -e "const c=require('./vercel.json'); console.log('crons:', JSON.stringify(c.crons)); if(c.crons.length!==1) process.exit(1); if(c.crons[0].schedule!=='0 0 * * *') process.exit(1); console.log('OK')"`
Expected: `crons: [{"path":"/api/cron/dispatcher","schedule":"0 0 * * *"}]` + `OK`.

- [x] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "build(cron): single daily dispatcher cron (Vercel Hobby limit fix)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 통합 검증 (QA)

**Files:** 없음(검증 전용).

- [x] **Step 1: 전체 게이트**

Run: `npm run typecheck && npm run test && npm run lint`
Expected: typecheck clean · 전체 test PASS(신규 authorize 3 + refund worker 3 + dispatcher 3 + process-refunds route 2 포함) · lint 신규 오류 0.

- [x] **Step 2: 로컬 통합 검증 — dispatcher가 3개 워커 모두 실행 (Mock/seed 데이터)**

Run:
```bash
SECRET=$(grep -E '^CRON_SECRET=' .env* 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
(npm run dev > /tmp/cron-dev.log 2>&1 &) ; sleep 9
echo "--- 미인증(401) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/cron/dispatcher"
echo "--- 인증 호출 ---"
curl -s -H "Authorization: Bearer $SECRET" "http://localhost:3000/api/cron/dispatcher" | tee /tmp/cron-dispatch.json
echo ""
pkill -f "next dev" || true
```
Expected: 미인증 401. 인증 응답 JSON에 `"workers"` 3개(refund/email/embedding) 모두 포함, 각 `status:"fulfilled"`(pending job 없으면 processed:0). 500 아님.
판정: `node -e "const r=require('/tmp/cron-dispatch.json'); const n=r.workers.map(w=>w.worker).sort().join(','); console.log(n); if(n!=='email,embedding,refund') process.exit(1); console.log('3 workers OK')"`

- [x] **Step 3: 개별 래퍼 라우트 생존 확인 (외부 트리거 진입점)**

Run:
```bash
(npm run dev > /tmp/cron-dev2.log 2>&1 &) ; sleep 9
for p in process-refunds email-job embedding-job; do
  curl -s -o /dev/null -w "$p -> %{http_code}\n" -H "Authorization: Bearer $SECRET" "http://localhost:3000/api/cron/$p"
done
pkill -f "next dev" || true
```
Expected: 3개 모두 200(인증 통과, 워커 위임). 라우트가 삭제되지 않고 얇은 래퍼로 살아있음 확인.

- [x] **Step 4: 미체크 박스 잔존 점검**

Run: `grep -n "\- \[ \]" docs/superpowers/plans/2026-06-04-cron-dispatcher-consolidation.md`
Expected: 완료 시 헤더 prose 줄 외 출력 없음.

- [x] **Step 5: 최종 커밋/상태 확인**

Run: `git log --oneline -7 && git status --short`
Expected: Task 1~5 커밋 존재, working tree clean.

---

## Self-Review 메모 (작성자 점검 완료)

- **Spec 커버리지:** isCronAuthorized 추출(T1) / refund 워커 추출(T2) / 얇은 래퍼 3개(T3) / dispatcher allSettled(T4) / vercel.json 단일 daily(T5) / 통합 검증(T6) — 전 항목 매핑.
- **타입 일관성:** `processRefundJobBatch({limit})`·`RefundBatchResult`는 T2 정의, T3·T4가 동일 시그니처 참조. dispatcher 워커 limit(10/10/5)은 기존 개별 라우트 값 보존.
- **테스트 이전:** 기존 `batch-recompute.test.ts`(라우트 GET 대상)의 검증을 T2 워커 테스트로 이전 + T3에서 라우트 테스트는 얇은 래퍼용으로 재작성. email/embedding 라우트 테스트는 env mock 덕에 무변경 통과.
- **ADR 후보:** 단일 dispatcher + daily Vercel + 외부 트리거 분리(workaround) — 구현 후 발행 제안(spec §6).
```
