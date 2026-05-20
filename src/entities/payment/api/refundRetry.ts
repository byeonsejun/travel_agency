/**
 * RefundJob 재시도 도메인 (자가 치유 큐의 worker side).
 *
 * 첫 진입의 refundBooking(refund.ts)이 Phase 1+2+3 saga를 모두 다루는 반면,
 * 이쪽은 이미 enqueue된 RefundJob을 cron worker가 다시 들고 Phase 2+3만
 * 재시도한다. (Phase 1 = enqueue는 이미 끝났음)
 *
 * 트랜잭션 격리 (Domain R3, ADR-0003):
 *   - 외부 PG 호출(Phase 2)은 DB Tx 바깥
 *   - Phase 3는 단일 Tx (Payment + RefundJob + PaymentEvent)
 *   - booking 상태 전이는 transitionStatus가 단일 Tx로 책임 (좌석 환원 자동)
 */

import type { BookingStatus, Prisma } from "@prisma/client";
import { db } from "@/shared/lib/db";
import { tossClient } from "@/shared/lib/toss";
import { transitionStatus, InvalidTransitionError } from "@/entities/booking";
import { logger, metrics, captureException } from "@/shared/lib/observability";
import { PaymentError } from "./errors";
import { backoff } from "./refund";

// IN_PROGRESS인 채로 멈춰 있는 job을 stuck으로 판정하는 임계 시간.
// worker death / 배포 도중 중단 등으로 인한 영구 lock 회복용.
const STALE_IN_PROGRESS_MS = 10 * 60_000; // 10분

export type RetryRefundResult =
  | { type: "succeeded"; jobId: string }
  | {
      type: "deferred";
      jobId: string;
      attempts: number;
      nextRunAt: Date;
      lastError: string;
    }
  | { type: "skipped"; jobId: string; reason: string }
  | { type: "failed"; jobId: string; reason: string };

/**
 * 처리 대기 중인 RefundJob 후보 조회. 두 가지 경로:
 *   - PENDING + nextRunAt <= now: 정상 backoff 도래
 *   - IN_PROGRESS + updatedAt < now - 10min: stuck job 회복(reaper)
 *
 * 정렬은 nextRunAt asc — 가장 오래 대기한 job 우선.
 */
export async function listDueRefundJobs(
  limit: number = 10
): Promise<{ id: string }[]> {
  const now = new Date();
  const staleBoundary = new Date(now.getTime() - STALE_IN_PROGRESS_MS);
  return db.refundJob.findMany({
    where: {
      OR: [
        { status: "PENDING", nextRunAt: { lte: now } },
        { status: "IN_PROGRESS", updatedAt: { lt: staleBoundary } },
      ],
    },
    orderBy: { nextRunAt: "asc" },
    take: limit,
    select: { id: true },
  });
}

/**
 * 단일 job을 atomic CAS로 claim — 동시에 실행되는 다른 worker / 중복 cron 호출에
 * 안전. claim 성공해도 다른 worker가 같은 시점에 같은 row를 잡을 수 없다.
 *
 * affected=1: 이 worker가 처리 권한 획득
 * affected=0: 다른 worker가 먼저 가져갔거나, 상태가 바뀜 → skip
 */
async function claimRefundJob(
  tx: Prisma.TransactionClient,
  jobId: string
): Promise<boolean> {
  const now = new Date();
  const staleBoundary = new Date(now.getTime() - STALE_IN_PROGRESS_MS);
  const result = await tx.refundJob.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: "PENDING", nextRunAt: { lte: now } },
        { status: "IN_PROGRESS", updatedAt: { lt: staleBoundary } },
      ],
    },
    data: { status: "IN_PROGRESS" }, // updatedAt은 @updatedAt이 자동
  });
  return result.count > 0;
}

/**
 * actor 문자열에서 booking 전이 대상을 도출.
 * - "user:..." → CANCELED_BY_USER
 * - "admin:...", "system:..." 등 → CANCELED_BY_AGENCY
 *
 * actor가 null(기존 row, migration 전 생성)이면 CANCELED_BY_USER로 fallback —
 * 보수적 선택(대부분 사용자 자가 취소가 환불 대상).
 */
function deriveCancelStatus(actor: string | null): BookingStatus {
  if (actor && actor.startsWith("user:")) return "CANCELED_BY_USER";
  return "CANCELED_BY_AGENCY";
}

/**
 * 단일 RefundJob을 재시도. 한 job의 실패가 다른 job에 영향을 주지 않도록
 * 호출 측(route handler)이 try-catch로 격리한다.
 */
export async function retryRefundJob(jobId: string): Promise<RetryRefundResult> {
  // ── Claim (CAS) ──────────────────────────────────────────────────
  const claimed = await db.$transaction((tx) => claimRefundJob(tx, jobId));
  if (!claimed) {
    return { type: "skipped", jobId, reason: "not_claimable" };
  }

  // ── Load job + related payment ────────────────────────────────────
  const job = await db.refundJob.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      payment: {
        select: {
          id: true,
          tossPaymentKey: true,
          amount: true,
          status: true,
        },
      },
    },
  });

  // ── Short-circuit 1: Payment가 이미 CANCELED ─────────────────────
  // 다른 경로(webhook / 외부 reconcile)로 이미 환불됐다면 job만 정리.
  if (job.payment.status === "CANCELED") {
    await db.refundJob.update({
      where: { id: jobId },
      data: {
        status: "SUCCEEDED",
        lastError: "payment already CANCELED; cleaned up by retry worker",
      },
    });
    metrics.incr("payment.refund.retry.already_canceled");
    return { type: "skipped", jobId, reason: "payment_already_canceled" };
  }

  // ── Short-circuit 2: tossPaymentKey 부재 — 데이터 이상, FAILED 종료 ─
  if (!job.payment.tossPaymentKey) {
    await db.refundJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        lastError: "tossPaymentKey missing on payment",
      },
    });
    metrics.incr("payment.refund.retry.no_toss_key");
    return { type: "failed", jobId, reason: "no_toss_key" };
  }

  // ── Phase 2: 외부 PG 취소 (Tx 바깥, ADR-0003) ─────────────────────
  try {
    await tossClient.cancel({
      paymentKey: job.payment.tossPaymentKey,
      cancelReason: job.reason ?? "환불 처리 재시도",
      cancelAmount: job.payment.amount,
    });
  } catch (cancelErr) {
    const newAttempts = job.attempts + 1;
    const nextRunAt = backoff(newAttempts);
    const lastError = String(cancelErr);
    await db.refundJob.update({
      where: { id: jobId },
      data: {
        status: "PENDING",
        attempts: { increment: 1 },
        nextRunAt,
        lastError,
      },
    });
    logger.warn("payment.refund.retry.pg_failed", {
      jobId,
      attempts: newAttempts,
      nextRunAt: nextRunAt.toISOString(),
    });
    metrics.incr("payment.refund.retry.deferred");
    captureException(cancelErr, {
      bookingId: job.bookingId,
      paymentId: job.paymentId,
      extras: { jobId, retry: true },
    });
    return {
      type: "deferred",
      jobId,
      attempts: newAttempts,
      nextRunAt,
      lastError,
    };
  }

  // ── Phase 3: Payment CANCELED + RefundJob SUCCEEDED + PaymentEvent ─
  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: job.paymentId },
      data: { status: "CANCELED", canceledAt: new Date() },
    });
    await tx.refundJob.update({
      where: { id: jobId },
      data: { status: "SUCCEEDED" },
    });
    await tx.paymentEvent.create({
      data: {
        providerEventId: `refund-retry:${job.paymentId}:${Date.now()}`,
        bookingId: job.bookingId,
        paymentId: job.paymentId,
        type: "REFUND_REQUEST",
        payload: {
          bookingId: job.bookingId,
          reason: job.reason,
          actor: job.actor ?? "system:refund-retry",
          retryAttempt: job.attempts,
        } as unknown as Prisma.InputJsonValue,
        result: "PROCESSED",
      },
    });
  });

  // ── booking 상태 전이 (좌석 환원은 shouldReturnSeats 자동 처리) ───
  // 이미 다른 경로로 CANCELED 되었다면 InvalidTransitionError가 발생할 수 있다.
  // 그 경우 환불은 성공했으므로 결과는 그대로 succeeded — silent ignore.
  const targetStatus = deriveCancelStatus(job.actor);
  try {
    await transitionStatus({
      bookingId: job.bookingId,
      to: targetStatus,
      actor: job.actor ?? "system:refund-retry",
      reason: job.reason ?? "환불 처리 완료 (재시도)",
    });
  } catch (transitionErr) {
    if (!(transitionErr instanceof InvalidTransitionError)) {
      logger.error(
        "payment.refund.retry.transition_failed",
        transitionErr instanceof Error
          ? transitionErr
          : new Error(String(transitionErr)),
        { jobId, bookingId: job.bookingId, targetStatus }
      );
    }
    // booking이 이미 종료 상태인 경우는 정상 — refund 자체는 완료됨
  }

  metrics.incr("payment.refund.retry.success");
  return { type: "succeeded", jobId };
}

// PaymentError를 호출 측에서 구분할 수 있도록 re-export (사용 안 해도 무방)
export { PaymentError };
