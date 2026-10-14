/**
 * worker.ts — AnalyticsJob 배치 처리 워커 (ADR-0062).
 *
 * EmailJob 워커 동형:
 *  - CAS claim(updateMany status guard) — 다중 cron 인스턴스 동시 안전
 *  - 외부 IO(GA4 MP)는 DB Tx 바깥 (ADR-0003)
 *  - per-job try/catch 격리, stale IN_PROGRESS reaper(10분), MAX_ATTEMPTS=5, 지수 백오프
 *  - 72h 백데이트 한도 초과는 발송 없이 SKIPPED (MP 가 어차피 버림)
 *  - GA4 는 purchase 를 transaction_id 로 중복제거 → at-least-once 재시도가 안전
 *
 * hydration 은 동결 스냅샷만 읽는다: Booking.totalPrice·Traveler.unitPrice / RefundJob.amount.
 * 허용 import: @prisma/client, @/shared/lib/db, @/shared/lib/observability, ./mp
 * 금지: features/, widgets/, app/
 */

import { AnalyticsJobStatus } from "@prisma/client";
import type { AnalyticsEventType, Prisma } from "@prisma/client";
import { db } from "@/shared/lib/db";
import { logger, metrics, captureException } from "@/shared/lib/observability";
import {
  buildMpBody,
  buildPurchaseEvent,
  buildRefundEvent,
  isBeyondBackdateLimit,
  sendToGa4,
  toPurchaseItems,
  type MpEvent,
} from "./mp";

export interface AnalyticsBatchResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

const STALE_IN_PROGRESS_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

function computeBackoff(newAttempts: number): Date {
  const n = Math.max(1, newAttempts);
  const delayMs = Math.min(2 ** n * 60_000, 3_600_000);
  return new Date(Date.now() + delayMs);
}

function dueWhere(now: Date): Prisma.AnalyticsJobWhereInput {
  const staleBoundary = new Date(now.getTime() - STALE_IN_PROGRESS_MS);
  return {
    OR: [
      { status: AnalyticsJobStatus.PENDING, nextRunAt: { lte: now } },
      { status: AnalyticsJobStatus.IN_PROGRESS, updatedAt: { lt: staleBoundary } },
    ],
  };
}

async function claim(tx: Prisma.TransactionClient, jobId: string): Promise<boolean> {
  const result = await tx.analyticsJob.updateMany({
    where: { id: jobId, ...dueWhere(new Date()) },
    data: { status: AnalyticsJobStatus.IN_PROGRESS },
  });
  return result.count > 0;
}

async function hydrate(job: {
  type: AnalyticsEventType;
  bookingId: string;
  refundJobId: string | null;
}): Promise<{ clientId: string | null; event: MpEvent } | null> {
  const booking = await db.booking.findUnique({
    where: { id: job.bookingId },
    select: {
      id: true,
      totalPrice: true,
      gaClientId: true,
      departure: { select: { product: { select: { id: true, title: true, destination: true } } } },
      travelers: { select: { paxType: true, unitPrice: true } },
    },
  });
  if (!booking) return null;

  if (job.type === "PURCHASE") {
    const product = booking.departure.product;
    const items = toPurchaseItems(
      { productId: product.id, title: product.title, destination: product.destination },
      booking.totalPrice,
      booking.travelers,
    );
    return {
      clientId: booking.gaClientId,
      event: buildPurchaseEvent({ bookingId: booking.id, value: booking.totalPrice, items }),
    };
  }

  if (job.refundJobId === null) return null;
  const refund = await db.refundJob.findUnique({
    where: { id: job.refundJobId },
    select: { amount: true },
  });
  if (!refund) return null;
  return {
    clientId: booking.gaClientId,
    event: buildRefundEvent({ bookingId: booking.id, value: refund.amount }),
  };
}

async function processOneJob(jobId: string): Promise<"succeeded" | "failed" | "skipped"> {
  const claimed = await db.$transaction((tx) => claim(tx, jobId));
  if (!claimed) return "skipped";

  const job = await db.analyticsJob.findUniqueOrThrow({
    where: { id: jobId },
    select: { id: true, type: true, bookingId: true, refundJobId: true, occurredAt: true, attempts: true },
  });

  if (isBeyondBackdateLimit(job.occurredAt)) {
    await db.analyticsJob.update({
      where: { id: jobId },
      data: { status: AnalyticsJobStatus.SKIPPED, lastError: "occurredAt beyond MP 72h backdate limit" },
    });
    metrics.incr("cron.analytics-job.skipped_backdate");
    return "skipped";
  }

  const data = await hydrate(job);
  if (!data) {
    await db.analyticsJob.update({
      where: { id: jobId },
      data: { status: AnalyticsJobStatus.FAILED, lastError: "hydration data not found" },
    });
    metrics.incr("cron.analytics-job.hydration_missing");
    return "failed";
  }

  try {
    await sendToGa4(
      buildMpBody({ clientId: data.clientId, bookingId: job.bookingId, occurredAt: job.occurredAt, event: data.event }),
    );
    await db.analyticsJob.update({
      where: { id: jobId },
      data: { status: AnalyticsJobStatus.SUCCEEDED, lastError: null },
    });
    return "succeeded";
  } catch (err) {
    const newAttempts = job.attempts + 1;
    const lastError = String(err);
    captureException(err, { extras: { jobId, retry: true } });

    await db.analyticsJob.update({
      where: { id: jobId },
      data:
        newAttempts >= MAX_ATTEMPTS
          ? { status: AnalyticsJobStatus.FAILED, attempts: { increment: 1 }, lastError }
          : {
              status: AnalyticsJobStatus.PENDING,
              attempts: { increment: 1 },
              nextRunAt: computeBackoff(newAttempts),
              lastError,
            },
    });
    return "failed";
  }
}

export async function processAnalyticsJobBatch(opts: { limit: number }): Promise<AnalyticsBatchResult> {
  const jobs = await db.analyticsJob.findMany({
    where: dueWhere(new Date()),
    orderBy: { nextRunAt: "asc" },
    take: opts.limit,
    select: { id: true },
  });
  if (jobs.length === 0) return { processed: 0, succeeded: 0, failed: 0, skipped: 0 };

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  for (const { id } of jobs) {
    try {
      const outcome = await processOneJob(id);
      if (outcome === "succeeded") succeeded++;
      else if (outcome === "failed") failed++;
      else skipped++;
    } catch (err) {
      // claim 후 미처리 예외 → IN_PROGRESS 로 남아 stale reaper 가 회수.
      logger.error(
        "cron.analytics-job.unexpected",
        err instanceof Error ? err : new Error(String(err)),
        { jobId: id },
      );
      failed++;
    }
  }
  return { processed: jobs.length, succeeded, failed, skipped };
}
