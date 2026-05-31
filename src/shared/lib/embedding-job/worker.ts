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

import { Prisma } from "@prisma/client";
import type { EmbeddingJobStatus } from "@prisma/client";
import { db } from "@/shared/lib/db";
import { getEmbeddingProvider, EMBEDDING_DIM } from "@/shared/lib/embedding";
import { buildEmbeddingText } from "@/entities/product";

export interface BatchResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

// IN_PROGRESS인 채로 멈춰 있는 job을 stuck으로 판정하는 임계 시간 (refundRetry 패턴 동일)
const STALE_IN_PROGRESS_MS = 10 * 60_000; // 10분

// 영구 실패 임계 시도 횟수
const MAX_ATTEMPTS = 5;

// 지수 백오프 — 2^newAttempts * 60_000ms, max 1h (spec 명시)
function computeBackoff(newAttempts: number): Date {
  const delayMs = Math.min(2 ** newAttempts * 60_000, 3_600_000);
  return new Date(Date.now() + delayMs);
}

/**
 * 처리 대기 중인 EmbeddingJob 후보 조회.
 * - PENDING + nextRunAt <= now: 정상 backoff 도래
 * - IN_PROGRESS + updatedAt < now - 10min: stuck job 회복(reaper)
 */
async function listDueEmbeddingJobs(
  limit: number,
): Promise<{ id: string; productId: string }[]> {
  const now = new Date();
  const staleBoundary = new Date(now.getTime() - STALE_IN_PROGRESS_MS);
  return db.embeddingJob.findMany({
    where: {
      OR: [
        { status: "PENDING" as EmbeddingJobStatus, nextRunAt: { lte: now } },
        {
          status: "IN_PROGRESS" as EmbeddingJobStatus,
          updatedAt: { lt: staleBoundary },
        },
      ],
    },
    orderBy: { nextRunAt: "asc" },
    take: limit,
    select: { id: true, productId: true },
  });
}

/**
 * 단일 job을 atomic CAS로 claim.
 * affected=1: 이 worker가 처리 권한 획득.
 * affected=0: 다른 worker가 먼저 가져갔거나 상태가 바뀜 → skip.
 */
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
        { status: "PENDING" as EmbeddingJobStatus, nextRunAt: { lte: now } },
        {
          status: "IN_PROGRESS" as EmbeddingJobStatus,
          updatedAt: { lt: staleBoundary },
        },
      ],
    },
    data: { status: "IN_PROGRESS" }, // @updatedAt 자동
  });
  return result.count > 0;
}

/**
 * 단일 EmbeddingJob을 처리.
 * 반환: "succeeded" | "failed" | "skipped"
 *
 * 각 결과 경로:
 *  - claim 실패 → "skipped" (not_claimable)
 *  - product 없음 → FAILED 영구 + "failed"
 *  - contentHash+modelVersion 일치 → updatedAt만 갱신 + SUCCEEDED + "skipped"
 *  - contentHash/modelVersion 불일치 또는 row 없음 → embed + upsert + SUCCEEDED + "succeeded"
 *  - embed 실패 → attempts<MAX: PENDING+backoff / attempts>=MAX: FAILED 영구, "failed"
 */
async function processOneJob(
  jobId: string,
  provider: ReturnType<typeof getEmbeddingProvider>,
): Promise<"succeeded" | "failed" | "skipped"> {
  // ── L1: CAS Claim ─────────────────────────────────────────────────────────
  const claimed = await db.$transaction((tx) => claimEmbeddingJob(tx, jobId));
  if (!claimed) {
    return "skipped";
  }

  // ── 현재 job 상태 로드 (attempts, productId) ──────────────────────────────
  const job = await db.embeddingJob.findUniqueOrThrow({
    where: { id: jobId },
    select: { attempts: true, productId: true },
  });

  // ── Product 로드 (full relations for buildEmbeddingText) ──────────────────
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
    // orphan job — product 하드 삭제 혹은 FK cascade 타이밍 이슈. 영구 FAILED.
    await db.embeddingJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        lastError: "product not found",
      },
    });
    return "failed";
  }

  // ── 콘텐츠 텍스트 + hash 생성 ────────────────────────────────────────────
  const { text, contentHash } = buildEmbeddingText(product);

  // ── L2: 현재 ProductEmbedding 조회 ───────────────────────────────────────
  const existingEmbedding = await db.productEmbedding.findUnique({
    where: { productId: job.productId },
    select: { modelVersion: true, contentHash: true },
  });

  const needsEmbed =
    existingEmbedding === null ||
    existingEmbedding.modelVersion !== provider.modelVersion ||
    existingEmbedding.contentHash !== contentHash;

  if (!needsEmbed) {
    // contentHash + modelVersion 모두 일치 → updatedAt만 갱신 (임베딩 호출 0회)
    await db.productEmbedding.update({
      where: { productId: job.productId },
      data: { updatedAt: new Date() },
    });
    await db.embeddingJob.update({
      where: { id: jobId },
      data: {
        status: "SUCCEEDED",
        contentHash,
      },
    });
    return "skipped";
  }

  // ── provider.embed (외부 IO — Tx 바깥, ADR-0003) ──────────────────────────
  try {
    const vec = await provider.embed(text);

    if (vec.length !== EMBEDDING_DIM) {
      throw new Error(`embedding 차원 불일치: ${vec.length} (기대 ${EMBEDDING_DIM})`);
    }

    // ── L3: pgvector upsert (injection-safe: vecLiteral은 our own number[]) ──
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
        status: "SUCCEEDED",
        contentHash,
      },
    });
    return "succeeded";
  } catch (err) {
    const newAttempts = job.attempts + 1;
    const lastError = String(err);

    if (newAttempts >= MAX_ATTEMPTS) {
      // 영구 FAILED — 수동 재시도만 허용 (admin이 FAILED job을 reset)
      await db.embeddingJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          attempts: { increment: 1 },
          lastError,
        },
      });
      return "failed";
    }

    // 일시적 실패 → PENDING + 지수 백오프
    const nextRunAt = computeBackoff(newAttempts);
    await db.embeddingJob.update({
      where: { id: jobId },
      data: {
        status: "PENDING",
        attempts: { increment: 1 },
        nextRunAt,
        lastError,
      },
    });
    return "failed";
  }
}

/**
 * EmbeddingJob 배치 처리 진입점.
 * Vercel Cron 엔드포인트(Task 5)에서 호출.
 *
 * @param opts.limit 한 번에 처리할 최대 job 수
 */
export async function processEmbeddingJobBatch(opts: {
  limit: number;
}): Promise<BatchResult> {
  const jobs = await listDueEmbeddingJobs(opts.limit);

  if (jobs.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0 };
  }

  // provider는 배치 당 한 번만 초기화 (안정적 factory)
  const provider = getEmbeddingProvider();

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  // for...of: 직렬 처리 + per-job 실패 격리. 한 job 실패가 배치 전체를 중단시키지 않음.
  // (Promise.allSettled 사용 가능하나 직렬이 DB connection 압박 면에서 안전하고
  //  cron 특성상 지연보다 안정성이 우선임.)
  for (const { id: jobId } of jobs) {
    try {
      const outcome = await processOneJob(jobId, provider);
      if (outcome === "succeeded") succeeded++;
      else if (outcome === "failed") failed++;
      else skipped++;
    } catch (unexpectedErr) {
      // processOneJob 내부 catch가 핸들하지 못한 예외 (findUniqueOrThrow 등)
      // job은 IN_PROGRESS인 채로 남아 stale reaper에 의해 10분 후 재시도됨.
      failed++;
    }
  }

  return { processed: jobs.length, succeeded, failed, skipped };
}
