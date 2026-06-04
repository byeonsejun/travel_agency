/**
 * 환불완료 메일 데이터 단일쿼리 조립.
 * CANCELED 또는 PARTIAL_CANCELED payment + SUCCEEDED RefundJob 1건에서
 * 실제 환불액(위약금 차감 후)·위약금·수단을 읽는다. 없으면 null.
 */

import { db } from "@/shared/lib/db";
import type { RefundCompletedEmailProps } from "@/shared/email";

export interface RefundCompletedEmailData {
  recipientEmail: string;
  props: RefundCompletedEmailProps;
}

const METHOD_LABEL: Record<string, string> = {
  CARD: "카드",
  TRANSFER: "계좌이체",
  VIRTUAL_ACCOUNT: "가상계좌",
};

export async function getRefundCompletedEmailData(
  bookingId: string,
): Promise<RefundCompletedEmailData | null> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      user: { select: { email: true, name: true } },
      departure: { select: { product: { select: { title: true } } } },
      payments: {
        where: { status: { in: ["CANCELED", "PARTIAL_CANCELED"] } },
        select: { method: true },
        orderBy: { canceledAt: "desc" },
        take: 1,
      },
      refundJobs: {
        where: { status: "SUCCEEDED" },
        select: { amount: true, penaltyAmount: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
  });

  const refundedPayment = booking?.payments[0];
  const refundJob = booking?.refundJobs[0];
  if (!booking || !refundedPayment || !refundJob) return null;

  return {
    recipientEmail: booking.user.email,
    props: {
      customerName: booking.user.name ?? "고객",
      bookingId: booking.id,
      productTitle: booking.departure.product.title,
      refundAmount: refundJob.amount,          // 실제 환불액 (위약금 차감 후)
      penaltyAmount: refundJob.penaltyAmount,  // 위약금 (0이면 전액 환불)
      paymentMethod: METHOD_LABEL[refundedPayment.method] ?? refundedPayment.method,
    },
  };
}
