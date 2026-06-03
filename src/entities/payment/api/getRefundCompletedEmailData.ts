/**
 * 환불완료 메일 데이터 단일쿼리 조립.
 * CANCELED payment 1건에서 환불 금액·수단을 읽는다. 없으면 null.
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
        where: { status: "CANCELED" },
        select: { amount: true, method: true },
        orderBy: { canceledAt: "desc" },
        take: 1,
      },
    },
  });

  const refunded = booking?.payments[0];
  if (!booking || !refunded) return null;

  return {
    recipientEmail: booking.user.email,
    props: {
      customerName: booking.user.name ?? "고객",
      bookingId: booking.id,
      productTitle: booking.departure.product.title,
      refundAmount: refunded.amount,
      paymentMethod: METHOD_LABEL[refunded.method] ?? refunded.method,
    },
  };
}
