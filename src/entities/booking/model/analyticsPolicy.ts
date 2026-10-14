/**
 * booking 상태전이 → GA4 서버 이벤트(AnalyticsJob) 매핑 (순수 정책, ADR-0062).
 *
 * transitionStatusTx(아웃박스)가 emailPolicy 와 나란히 이 함수로 판단해 같은 Tx 에 적재한다.
 * PAID 전이 = purchase. 환불(refund)은 여기서 다루지 않는다 — 부분환불은 booking 전이 없이
 * 발생하므로 RefundJob settle 지점(refund.ts / refundRetry.ts)에서 직접 적재한다.
 */

import type { AnalyticsEventType, BookingStatus } from "@prisma/client";

export interface AnalyticsJobDescriptor {
  type: AnalyticsEventType;
  dedupeKey: string;
}

export function analyticsJobForTransition(
  _from: BookingStatus,
  to: BookingStatus,
  bookingId: string,
): AnalyticsJobDescriptor | null {
  if (to === "PAID") {
    return { type: "PURCHASE", dedupeKey: `ga-purchase:${bookingId}` };
  }
  return null;
}
