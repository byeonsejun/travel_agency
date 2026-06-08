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
 *   - booking 상태 전이는 transitionStatusTx가 kind별 후처리 Tx 안에서 처리 (좌석 환원 skipSeatReturn)
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/shared/lib/db";
import { tossClient } from "@/shared/lib/toss";
import {
  transitionStatusTx,
  releaseSeats,
  InvalidTransitionError,
} from "@/entities/booking";
import { logger, metrics, captureException } from "@/shared/lib/observability";
import { PaymentError } from "./errors";
import { backoff } from "./refund";
import { releaseRefund } from "./ledger";
import { enqueueEmailJob } from "@/shared/lib/email-job/enqueue";

// IN_PROGRESS인 채로 멈춰 있는 job을 stuck으로 판정하는 임계 시간.
// worker death / 배포 도중 중단 등으로 인한 영구 lock 회복용.
const STALE_IN_PROGRESS_MS = 10 * 60_000; // 10분

// PG 재시도 한계치 — 이 횟수 이상이면 영구 실패(FAILED)로 판정하고 ledger 예약 해제.
const MAX_ATTEMPTS = 8;

/**
 * 영구 실패 여부 판정. attempts >= MAX_ATTEMPTS이면 PG 재시도를 포기하고
 * reserveRefund로 잡아둔 ledger 예약을 releaseRefund로 환원한다.
 */
export function isPermanentFailure(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}

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
 * 단일 RefundJob을 재시도. 한 job의 실패가 다른 job에 영향을 주지 않도록
 * 호출 측(route handler)이 try-catch로 격리한다.
 */
export async function retryRefundJob(jobId: string): Promise<RetryRefundResult> {
  // ── Claim (CAS) ──────────────────────────────────────────────────
  const claimed = await db.$transaction((tx) => claimRefundJob(tx, jobId));
  if (!claimed) {
    return { type: "skipped", jobId, reason: "not_claimable" };
  }

  // ── Load job + related payment + booking ─────────────────────────
  const job = await db.refundJob.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      payment: {
        select: {
          id: true,
          tossPaymentKey: true,
          amount: true,
          status: true,
          refundedAmount: true,
        },
      },
      booking: { select: { departureId: true } },
    },
  });

  // ── Short-circuit 1: Payment가 이미 CANCELED 또는 PARTIAL_CANCELED ─
  // 다른 경로(webhook / 외부 reconcile / 부분 환불 선행 처리)로 이미 환불됐다면 job만 정리.
  if (job.payment.status === "CANCELED" || job.payment.status === "PARTIAL_CANCELED") {
    await db.refundJob.update({
      where: { id: jobId },
      data: {
        status: "SUCCEEDED",
        lastError: "payment already (partial-)canceled; cleaned up by retry worker",
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
  // cancelAmount = job.amount (enqueue 시점 동결 환불금) — payment.amount(원금)가 아님.
  // 부분 환불(위약금 존재)의 경우 원금보다 작은 금액만 취소해야 한다.
  // job.amount===0(100% 위약금)이면 Toss cancel은 거부되므로 skip → 곧장 Phase 3 settle.
  // 머니무브만 없고 settle·booking 전이는 정상 수행한다.
  if (job.amount > 0) {
    try {
      await tossClient.cancel({
        paymentKey: job.payment.tossPaymentKey,
        cancelReason: job.reason ?? "환불 처리 재시도",
        cancelAmount: job.amount,
      });
    } catch (cancelErr) {
      const newAttempts = job.attempts + 1;
      const lastError = String(cancelErr);

      // 영구 실패: ledger 예약 해제 후 FAILED 종료
      if (isPermanentFailure(newAttempts)) {
        await db.$transaction(async (tx) => {
          await tx.refundJob.update({
            where: { id: jobId },
            data: { status: "FAILED", attempts: { increment: 1 }, lastError },
          });
          await releaseRefund(tx, { paymentId: job.paymentId, amount: job.amount });
        });
        metrics.incr("payment.refund.retry.permanent_failed");
        captureException(cancelErr, {
          bookingId: job.bookingId,
          paymentId: job.paymentId,
          extras: { jobId, permanent: true },
        });
        return { type: "failed", jobId, reason: "permanent_failure" };
      }

      // 일시 실패: 재시도 스케줄링
      const nextRunAt = backoff(newAttempts);
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
  } else {
    metrics.incr("payment.refund.retry.zero_amount_skip");
  }

  // ── Phase 3: Payment 상태 갱신 + RefundJob SUCCEEDED + PaymentEvent ─
  // refundedAmount >= amount면 전액 환불 → CANCELED, 아니면 부분 환불 → PARTIAL_CANCELED.
  // refundedAmount는 Phase 1 reserveRefund에서 이미 increment된 동결 스냅샷 — 재계산 금지.
  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: job.paymentId },
      data: {
        status:
          job.payment.refundedAmount >= job.payment.amount
            ? "CANCELED"
            : "PARTIAL_CANCELED",
        canceledAt: new Date(),
      },
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
          penaltyAmount: job.penaltyAmount,
          refundAmount: job.amount,
        } as unknown as Prisma.InputJsonValue,
        result: "PROCESSED",
      },
    });
    if (job.kind !== "FULL_CANCEL") {
      await enqueueEmailJob(tx, {
        type: "PARTIAL_REFUND_COMPLETED",
        dedupeKey: `partial-refund-completed:${jobId}`,
        bookingId: job.bookingId,
        refundJobId: jobId,
      });
    }
  });

  // ── kind별 후처리: traveler 표식 + 좌석 환원 + FULL_CANCEL terminal 전이 ──
  // DISCRETIONARY는 후처리 없음.
  // TRAVELER_CANCEL / FULL_CANCEL: 최초 enqueue(refundTraveler) 단계에서
  //   onSettled가 실행되지 못한 경우(PG 실패→재시도 경로)를 cron이 여기서 보정.
  //   canceledAt IS NULL 가드로 멱등 — 이미 처리됐으면 marked.count=0 → skip.
  if (job.kind === "TRAVELER_CANCEL" || job.kind === "FULL_CANCEL") {
    await db.$transaction(async (tx) => {
      const marked = await tx.traveler.updateMany({
        where: { canceledByRefundJobId: job.id, canceledAt: null },
        data: { canceledAt: new Date() },
      });
      if (marked.count > 0 && job.seatsReleased > 0 && job.booking) {
        await releaseSeats(tx, job.booking.departureId, job.seatsReleased);
      }
      if (job.kind === "FULL_CANCEL") {
        await transitionStatusTx(tx, {
          bookingId: job.bookingId,
          to: job.actor?.startsWith("user:")
            ? "CANCELED_BY_USER"
            : "CANCELED_BY_AGENCY",
          actor: job.actor ?? "system:cron",
          skipSeatReturn: true,
        }).catch((e: unknown) => {
          if (!(e instanceof InvalidTransitionError)) {
            logger.error(
              "payment.refund.retry.transition_failed",
              e instanceof Error ? e : new Error(String(e)),
              { jobId }
            );
          }
          // booking이 이미 종료 상태인 경우는 정상 — silent ignore
        });
      }
    });
  }

  metrics.incr("payment.refund.retry.success");
  return { type: "succeeded", jobId };
}

// PaymentError를 호출 측에서 구분할 수 있도록 re-export (사용 안 해도 무방)
export { PaymentError };
