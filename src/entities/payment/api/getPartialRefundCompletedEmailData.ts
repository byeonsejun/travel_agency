/**
 * 부분환불 완료 메일 데이터 단일쿼리 조립.
 * RefundJob.id 를 기준으로 단일 refundJob 에서 환불액·위약금·원결제액·수단을 읽는다.
 * refundJob(또는 연관 booking/payment) 이 없으면 null.
 */

import { db } from "@/shared/lib/db";
import type { PartialRefundCompletedEmailProps } from "@/shared/email";

export interface PartialRefundCompletedEmailData {
  recipientEmail: string;
  props: PartialRefundCompletedEmailProps;
}

const METHOD_LABEL: Record<string, string> = {
  CARD: "카드",
  TRANSFER: "계좌이체",
  VIRTUAL_ACCOUNT: "가상계좌",
};

export async function getPartialRefundCompletedEmailData(
  refundJobId: string,
): Promise<PartialRefundCompletedEmailData | null> {
  const refundJob = await db.refundJob.findUnique({
    where: { id: refundJobId },
    select: {
      amount: true,
      penaltyAmount: true,
      payment: { select: { amount: true, method: true } },
      booking: {
        select: {
          id: true,
          user: { select: { email: true, name: true } },
          departure: { select: { product: { select: { title: true } } } },
        },
      },
    },
  });

  if (!refundJob || !refundJob.booking || !refundJob.payment) return null;

  const { booking, payment } = refundJob;

  return {
    recipientEmail: booking.user.email,
    props: {
      customerName: booking.user.name ?? "고객",
      bookingId: booking.id,
      productTitle: booking.departure.product.title,
      originalAmount: payment.amount,            // 원결제 금액
      penaltyAmount: refundJob.penaltyAmount,    // 위약금 (0이면 템플릿에서 라인 숨김)
      refundAmount: refundJob.amount,            // 실제 환불액 (위약금 차감 후)
      paymentMethod: METHOD_LABEL[payment.method] ?? payment.method,
    },
  };
}
