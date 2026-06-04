/**
 * worker.ts — EmbeddingJob 배치 처리 워커 (B3 Task 4)
 *
 * 3-layer 멱등성:
 *  L1: CAS claim (`updateMany` with status=PENDING guard) — TOCTOU 차단
 *  L2: contentHash + modelVersion 비교 — 불필요한 OpenAI 호출 skip
 *  L3: INSERT ... ON CONFLICT DO UPDATE — 중복 ProductEmbedding 행 차단
 *
 * 외부 IO(provider.embed)는 DB Tx 바깥 (ADR-0003 정책 동일).
 * 실패 격리: for...of + try/catch per-job → 한 job 실패가 배치 전체를 막지 않음.
 * provider: getEmbeddingProvider()는 배치 당 한 번만 호출.
 *
 * 허용 import: @prisma/client, @/shared/lib/db, @/shared/lib/embedding, @/entities/product
 * 금지: features/, widgets/, app/
 */

import { Prisma, EmbeddingJobStatus } from "@prisma/client";
import { db } from "@/shared/lib/db";
import { getEmbeddingProvider, EMBEDDING_DIM } from "@/shared/lib/embedding";
import { buildEmbeddingText } from "@/entities/product";

export interface BatchResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

// IN_PROGRESS 채로 멈춘 job을 stuck으로 판정하는 임계 — worker death/배포 중단 회복용 (refundRetry 동일).
const STALE_IN_PROGRESS_MS = 10 * 60_000;

const MAX_ATTEMPTS = 5;

// 지수 백오프 — 2^newAttempts * 60_000ms, max 1h. newAttempts는 호출자 계약상 항상 >= 1.
function computeBackoff(newAttempts: number): Date {
  const n = Math.max(1, newAttempts);
  const delayMs = Math.min(2 ** n * 60_000, 3_600_000);
  return new Date(Date.now() + delayMs);
}

async function listDueEmbeddingJobs(
  limit: number,
): Promise<{ id: string; productId: string }[]> {
  const now = new Date();
  const staleBoundary = new Date(now.getTime() - STALE_IN_PROGRESS_MS);
  return db.embeddingJob.findMany({
    where: {
      OR: [
        { status: EmbeddingJobStatus.PENDING, nextRunAt: { lte: now } },
        {
          status: EmbeddingJobStatus.IN_PROGRESS,
          updatedAt: { lt: staleBoundary },
        },
      ],
    },
    orderBy: { nextRunAt: "asc" },
    take: limit,
    select: { id: true, productId: true },
  });
}

// affected=1: 처리 권한 획득. affected=0: 다른 worker가 먼저 잡음 → skip.
async function claimEmbeddingJob(
  tx: Prisma.TransactionClient,
  jobId: string,
): Promise<boolean> {
  const now = new Date();
  const staleBoundary = new Date(now.getTime() - STALE_IN_PROGRESS_MS);
  const result = await tx.embeddingJob.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: EmbeddingJobStatus.PENDING, nextRunAt: { lte: now } },
        {
          status: EmbeddingJobStatus.IN_PROGRESS,
          updatedAt: { lt: staleBoundary },
        },
      ],
    },
    data: { status: EmbeddingJobStatus.IN_PROGRESS },
  });
  return result.count > 0;
}

/**
 * 단일 EmbeddingJob 처리. 반환: "succeeded" | "failed" | "skipped"
 *  - claim 실패 → "skipped" (not_claimable)
 *  - product 없음 → FAILED 영구 + "failed"
 *  - contentHash+modelVersion 일치 → updatedAt만 갱신 + SUCCEEDED + "skipped"
 *  - 불일치/row 없음 → embed + upsert + SUCCEEDED + "succeeded"
 *  - embed 실패 → attempts<MAX: PENDING+backoff / attempts>=MAX: FAILED 영구, "failed"
 */
async function processOneJob(
  jobId: string,
  provider: ReturnType<typeof getEmbeddingProvider>,
): Promise<"succeeded" | "failed" | "skipped"> {
  const claimed = await db.$transaction((tx) => claimEmbeddingJob(tx, jobId));
  if (!claimed) {
    return "skipped";
  }

  const job = await db.embeddingJob.findUniqueOrThrow({
    where: { id: jobId },
    select: { attempts: true, productId: true },
  });

  const product = await db.product.findUnique({
    where: { id: job.productId },
    include: {
      tags: true,
      inclusions: true,
      itineraryDays: {
        include: {
          stops: { orderBy: { order: "asc" } },
        },
        orderBy: { dayNumber: "asc" },
      },
    },
  });

  if (!product) {
    // orphan job — product 하드 삭제 또는 FK cascade 타이밍 이슈. 영구 FAILED (재시도 의미 없음).
    await db.embeddingJob.update({
      where: { id: jobId },
      data: {
        status: EmbeddingJobStatus.FAILED,
        lastError: "product not found",
      },
    });
    return "failed";
  }

  const { text, contentHash } = buildEmbeddingText(product);

  const existingEmbedding = await db.productEmbedding.findUnique({
    where: { productId: job.productId },
    select: { modelVersion: true, contentHash: true },
  });

  const needsEmbed =
    existingEmbedding === null ||
    existingEmbedding.modelVersion !== provider.modelVersion ||
    existingEmbedding.contentHash !== contentHash;

  if (!needsEmbed) {
    await db.productEmbedding.update({
      where: { productId: job.productId },
      data: { updatedAt: new Date() },
    });
    await db.embeddingJob.update({
      where: { id: jobId },
      data: {
        status: EmbeddingJobStatus.SUCCEEDED,
        contentHash,
      },
    });
    return "skipped";
  }

  // provider.embed는 의도적으로 Tx 바깥 (ADR-0003). 실패해도 claim Tx 손상 없음.
  try {
    const vec = await provider.embed(text);

    if (vec.length !== EMBEDDING_DIM) {
      throw new Error(`embedding 차원 불일치: ${vec.length} (기대 ${EMBEDDING_DIM})`);
    }

    // vecLiteral은 `Prisma.sql` 파라미터 binding이 아닌 직접 문자열 주입이다 (::vector 캐스트
    // 때문에 불가피). vec은 우리가 생성한 number[]이므로 외부 입력 경로 0 → 인젝션 안전.
    // 다음 작업자가 "Prisma 파라미터로 바꿔야 하지 않나"라고 시도하지 않도록 명시.
    const vecLiteral = `[${vec.join(",")}]`;
    await db.$executeRaw(Prisma.sql`
      INSERT INTO "ProductEmbedding" ("productId", "vector", "modelVersion", "contentHash", "updatedAt")
      VALUES (${job.productId}, ${vecLiteral}::vector, ${provider.modelVersion}, ${contentHash}, now())
      ON CONFLICT ("productId") DO UPDATE
        SET "vector" = EXCLUDED."vector",
            "modelVersion" = EXCLUDED."modelVersion",
            "contentHash" = EXCLUDED."contentHash",
            "updatedAt" = now()
    `);

    await db.embeddingJob.update({
      where: { id: jobId },
      data: {
        status: EmbeddingJobStatus.SUCCEEDED,
        contentHash,
      },
    });
    return "succeeded";
  } catch (err) {
    const newAttempts = job.attempts + 1;
    const lastError = String(err);

    if (newAttempts >= MAX_ATTEMPTS) {
      // 영구 FAILED — 수동 재시도만 허용 (admin이 FAILED job을 reset).
      await db.embeddingJob.update({
        where: { id: jobId },
        data: {
          status: EmbeddingJobStatus.FAILED,
          attempts: { increment: 1 },
          lastError,
        },
      });
      return "failed";
    }

    await db.embeddingJob.update({
      where: { id: jobId },
      data: {
        status: EmbeddingJobStatus.PENDING,
        attempts: { increment: 1 },
        nextRunAt: computeBackoff(newAttempts),
        lastError,
      },
    });
    return "failed";
  }
}

/**
 * EmbeddingJob 배치 처리 진입점 — Vercel Cron 엔드포인트(Task 5)가 호출.
 *
 * `for...of` (not `Promise.allSettled`): 직렬 처리가 DB connection 압박 면에서 안전하고
 * cron 특성상 지연보다 안정성이 우선. provider는 배치 당 한 번만 초기화.
 */
export async function processEmbeddingJobBatch(opts: {
  limit: number;
}): Promise<BatchResult> {
  const jobs = await listDueEmbeddingJobs(opts.limit);

  if (jobs.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0 };
  }

  const provider = getEmbeddingProvider();

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const { id: jobId } of jobs) {
    try {
      const outcome = await processOneJob(jobId, provider);
      if (outcome === "succeeded") succeeded++;
      else if (outcome === "failed") failed++;
      else skipped++;
    } catch {
      // processOneJob 내부 catch가 핸들하지 못한 예외 (예: findUniqueOrThrow의 DB 오류).
      // job은 IN_PROGRESS인 채 남아 stale reaper가 10분 후 회수 → 데이터 손상 없음.
      // 의도된 fallback이며, 더 정교한 retry 분기는 stale 회복 경로에 위임.
      failed++;
    }
  }

  return { processed: jobs.length, succeeded, failed, skipped };
}
