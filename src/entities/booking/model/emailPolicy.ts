/**
 * booking 상태전이 → 거래 종료 메일 매핑 (순수 정책).
 *
 * transitionStatusTx(아웃박스)가 이 함수로 판단해 EmailJob을 적재한다.
 * 환불 메일은 from ∈ {PAID, READY}(돈이 오간 상태)에서 취소될 때만 —
 * 결제 전 단계(RECEIVED/AWAITING_GROUP/DEPARTURE_CONFIRMED) 취소엔 보내지 않는다.
 * (refund.ts의 REFUNDABLE_STATUSES와 동일 기준.)
 */

import type { BookingStatus, EmailType } from "@prisma/client";

export interface EmailJobDescriptor {
  type: EmailType;
  dedupeKey: string;
}

export function emailJobForTransition(
  from: BookingStatus,
  to: BookingStatus,
  bookingId: string,
): EmailJobDescriptor | null {
  if (to === "PAID") {
    return {
      type: "BOOKING_CONFIRMATION",
      dedupeKey: `booking-confirmation:${bookingId}`,
    };
  }

  const wasPaid = from === "PAID" || from === "READY";
  const isCancel = to === "CANCELED_BY_USER" || to === "CANCELED_BY_AGENCY";
  if (wasPaid && isCancel) {
    return {
      type: "REFUND_COMPLETED",
      dedupeKey: `refund-completed:${bookingId}`,
    };
  }

  return null;
}
