import type { Prisma } from "@prisma/client";
import { reserveRefund } from "./ledger";
import { PaymentError } from "./errors";

export interface EnqueueRefundJobArgs {
  bookingId: string;
  paymentId: string;
  /** payment 총액(paid.amount). 잔여 환불가능액 산출의 기준. */
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
 * 원장 정합(reserveRefund): saga refund.ts:65 Phase 1 을 그대로 미러 — enqueue Tx 안,
 * PG 호출 전에 Payment.refundedAmount 를 조건부 예약한다. 이로써
 *   (a) cron 영구실패의 releaseRefund 와 짝이 맞아 refundedAmount 음수 잠복 버그가 닫히고
 *   (b) 부분환불 잔액이 있으면 잔여액만 예약/환불해 과환불을 차단한다.
 * 환불 결과(전액환불·Payment CANCELED·좌석 환원)는 불변 — refundedAmount 기록만 정합화.
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

  // 잔여 환불가능액 = payment 총액 − 기 환불액.
  // refundedAmount=0(현 cascade 실동작 케이스)이면 전액과 동일 → 동작 무변경.
  const payment = await tx.payment.findUniqueOrThrow({
    where: { id: args.paymentId },
    select: { refundedAmount: true },
  });
  const requestedRefund = args.amount - payment.refundedAmount;

  // 원장 예약(조건부 CAS). lte 가드가 Σ환불 ≤ amount 불변식을 보장.
  // 실패(경합/한도초과) 시 throw → 배치 fan-out 단일 Tx 전체 롤백(saga 동일 정책).
  const reserved = await reserveRefund(tx, {
    paymentId: args.paymentId,
    amount: args.amount,
    requestedRefund,
  });
  if (!reserved) {
    throw new PaymentError("REFUND_EXCEEDS_REFUNDABLE", { requestedRefund });
  }

  await tx.refundJob.create({
    data: {
      bookingId: args.bookingId,
      paymentId: args.paymentId,
      // job.amount = cron Toss cancelAmount = 잔여 환불액(전액 케이스면 전액과 동일).
      amount: requestedRefund,
      reason: args.reason ?? null,
      actor: args.actor,
      status: "PENDING",
      cancellationBatchId: args.cancellationBatchId ?? null,
    },
    select: { id: true },
  });
  return { enqueued: true };
}
