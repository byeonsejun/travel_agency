import type { Prisma } from "@prisma/client";

/**
 * 환불 예약(reserve) — Payment.refundedAmount 조건부 차감(원자적 CAS).
 * Postgres row lock이 동시 요청을 직렬화 → Σ 환불 ≤ amount 불변식을 retry 루프 없이 보장.
 * (좌석 reserveSeats와 동형) 반환 false = 경합 패자 또는 한도초과.
 */
export async function reserveRefund(
  tx: Prisma.TransactionClient,
  { paymentId, amount, requestedRefund }: { paymentId: string; amount: number; requestedRefund: number }
): Promise<boolean> {
  const res = await tx.payment.updateMany({
    where: {
      id: paymentId,
      status: { in: ["PAID", "PARTIAL_CANCELED"] },
      refundedAmount: { lte: amount - requestedRefund },
    },
    data: { refundedAmount: { increment: requestedRefund } },
  });
  return res.count > 0;
}

/** 예약 해제(release) — PG 영구 실패 시 refundedAmount 복원. */
export async function releaseRefund(
  tx: Prisma.TransactionClient,
  { paymentId, amount }: { paymentId: string; amount: number }
): Promise<void> {
  await tx.payment.updateMany({
    where: { id: paymentId },
    data: { refundedAmount: { decrement: amount } },
  });
}
