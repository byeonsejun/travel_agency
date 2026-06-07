/**
 * worker.ts — EmailJob 배치 처리 워커.
 *
 * EmbeddingJob/RefundJob 동형:
 *  - CAS claim(updateMany status guard) — 다중 cron 인스턴스 동시 안전(TOCTOU 차단)
 *  - 외부 IO(sendEmail=Resend)는 DB Tx 바깥 (ADR-0003)
 *  - per-job try/catch 격리, stale IN_PROGRESS reaper(10분), MAX_ATTEMPTS=5
 *  - 발송 멱등: idempotencyKey=dedupeKey → at-least-once가 effectively-once
 *
 * 허용 import: @prisma/client, @/shared/lib/db, @/shared/email,
 *   @/entities/booking·@/entities/payment (hydration 로더 —
 *   EmbeddingJob 워커가 @/entities/product를 쓰는 것과 동일한 백그라운드 워커 예외).
 * 금지: features/, widgets/, app/
 */

import { EmailJobStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { db } from "@/shared/lib/db";
import { getBookingConfirmationEmailData } from "@/entities/booking";
import { getRefundCompletedEmailData } from "@/entities/payment";
import { renderEmail, sendEmail } from "@/shared/email";
import { logger, metrics, captureException } from "@/shared/lib/observability";

export interface BatchResult {
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

async function listDueEmailJobs(limit: number): Promise<{ id: string }[]> {
  const now = new Date();
  const staleBoundary = new Date(now.getTime() - STALE_IN_PROGRESS_MS);
  return db.emailJob.findMany({
    where: {
      OR: [
        { status: EmailJobStatus.PENDING, nextRunAt: { lte: now } },
        { status: EmailJobStatus.IN_PROGRESS, updatedAt: { lt: staleBoundary } },
      ],
    },
    orderBy: { nextRunAt: "asc" },
    take: limit,
    select: { id: true },
  });
}

async function claimEmailJob(
  tx: Prisma.TransactionClient,
  jobId: string,
): Promise<boolean> {
  const now = new Date();
  const staleBoundary = new Date(now.getTime() - STALE_IN_PROGRESS_MS);
  const result = await tx.emailJob.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: EmailJobStatus.PENDING, nextRunAt: { lte: now } },
        { status: EmailJobStatus.IN_PROGRESS, updatedAt: { lt: staleBoundary } },
      ],
    },
    data: { status: EmailJobStatus.IN_PROGRESS },
  });
  return result.count > 0;
}

async function hydrate(
  type: "BOOKING_CONFIRMATION" | "REFUND_COMPLETED" | "PARTIAL_REFUND_COMPLETED",
  bookingId: string,
): Promise<{ recipientEmail: string; props: unknown } | null> {
  if (type === "BOOKING_CONFIRMATION") {
    return getBookingConfirmationEmailData(bookingId);
  }
  // NOTE: PARTIAL_REFUND_COMPLETED hydration loader is wired in Task 3.
  return getRefundCompletedEmailData(bookingId);
}

async function processOneJob(
  jobId: string,
): Promise<"succeeded" | "failed" | "skipped"> {
  const claimed = await db.$transaction((tx) => claimEmailJob(tx, jobId));
  if (!claimed) return "skipped";

  const job = await db.emailJob.findUniqueOrThrow({
    where: { id: jobId },
    select: { id: true, type: true, dedupeKey: true, bookingId: true, attempts: true },
  });

  const data = await hydrate(job.type, job.bookingId);
  if (!data) {
    await db.emailJob.update({
      where: { id: jobId },
      data: { status: EmailJobStatus.FAILED, lastError: "hydration data not found" },
    });
    metrics.incr("cron.email-job.hydration_missing");
    return "failed";
  }

  // render + send는 Tx 바깥 (ADR-0003). 실패해도 claim 손상 없음.
  try {
    const rendered = await renderEmail(job.type, data.props as never);
    const sent = await sendEmail({
      to: data.recipientEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: job.dedupeKey,
    });

    await db.emailJob.update({
      where: { id: jobId },
      data: {
        status: EmailJobStatus.SUCCEEDED,
        sentTo: data.recipientEmail,
        providerId: sent.id,
      },
    });
    return "succeeded";
  } catch (err) {
    const newAttempts = job.attempts + 1;
    const lastError = String(err);
    captureException(err, { extras: { jobId, retry: true } });

    if (newAttempts >= MAX_ATTEMPTS) {
      await db.emailJob.update({
        where: { id: jobId },
        data: {
          status: EmailJobStatus.FAILED,
          attempts: { increment: 1 },
          lastError,
        },
      });
      return "failed";
    }

    await db.emailJob.update({
      where: { id: jobId },
      data: {
        status: EmailJobStatus.PENDING,
        attempts: { increment: 1 },
        nextRunAt: computeBackoff(newAttempts),
        lastError,
      },
    });
    return "failed";
  }
}

export async function processEmailJobBatch(opts: {
  limit: number;
}): Promise<BatchResult> {
  const jobs = await listDueEmailJobs(opts.limit);
  if (jobs.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0 };
  }

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
      // claim 후 미처리 예외 → IN_PROGRESS로 남아 stale reaper가 회수.
      logger.error(
        "cron.email-job.unexpected",
        err instanceof Error ? err : new Error(String(err)),
        { jobId: id },
      );
      failed++;
    }
  }

  return { processed: jobs.length, succeeded, failed, skipped };
}
