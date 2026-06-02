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
 * RefundJob Phase 1 enqueue (PG 호출 없음 — cron이 Phase 2/3 수행). [ADR-0003/0028]
 *
 * 기존 active job(PENDING/IN_PROGRESS/SUCCEEDED) 존재 시 skip — 이중 환불 차단
 * (refundBooking의 Phase 1 멱등 게이트와 동일 규칙).
 * nextRunAt은 default(now())라 다음 cron tick에 즉시 후보가 된다.
 *
 * tx를 받아 호출자(배치 fan-out)의 단일 트랜잭션에 합류 — 외부 IO 0.
 */
export async function enqueueRefundJob(
  tx: Prisma.TransactionClient,
  args: EnqueueRefundJobArgs,
): Promise<{ enqueued: boolean }> {
  const existing = await tx.refundJob.findFirst({
    where: {
      bookingId: args.bookingId,
      status: { in: ["PENDING", "IN_PROGRESS", "SUCCEEDED"] },
    },
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
