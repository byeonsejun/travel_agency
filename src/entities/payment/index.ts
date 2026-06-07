/**
 * entities/payment 공개 API (barrel) — spec §6.3, architect R2
 *
 * 외부 레이어(features/checkout, app/api/payments, widgets)는
 * 반드시 이 파일을 통해서만 payment 슬라이스에 접근한다.
 *
 * 규칙:
 *  - export * 금지 (architect R2)
 *  - 내부 헬퍼(compensateCancel, parseBookingIdFromOrderId, assertAmountMatches, backoff)는 미노출
 *  - buildOrderId는 M-CHECKOUT 결제창 orderId 생성에 필요하므로 예외적으로 노출 (spec §6.3 note)
 */

// ── Zod 스키마 ───────────────────────────────────────────────────
export {
  ConfirmPaymentRequestSchema,
  TossWebhookV2EventSchema,
  PaymentStatusChangedDataSchema,
  RefundRequestSchema,
} from "./model/schemas";

// ── 도메인 타입 ──────────────────────────────────────────────────
export type {
  ConfirmPaymentRequest,
  TossWebhookV2Event,
  TossPaymentStatusChangedData,
  RefundRequest,
} from "./model/schemas";

export type { PaymentSafe, PaymentDetail } from "./model/types";

// ── API 함수 ────────────────────────────────────────────────────
export { confirmPayment } from "./api/confirm";
export type { ConfirmResult } from "./api/confirm";

export { handleTossWebhook } from "./api/webhook";

export { refundBooking, refundDiscretionary, refundTraveler, computeCanceledBase } from "./api/refund";
export { listDueRefundJobs, retryRefundJob } from "./api/refundRetry";
export type { RetryRefundResult } from "./api/refundRetry";

export { buildOrderId } from "./api/orderId";

// ── 에러 클래스 ─────────────────────────────────────────────────
export { PaymentError, InvalidSignatureError } from "./api/errors";
export type { PaymentErrorCode } from "./api/errors";

// ── 운영 관측 쿼리 (read-only) ──────────────────────────────────
export {
  listRecentPaymentEvents,
  summarizeRefundJobs,
  findActiveRefundJob,
  listRefundJobs,
} from "./api/observability";
export type { ActiveRefundJob, RefundJobRow } from "./api/observability";

// ── 환불 enqueue (Phase 4-B fan-out — Phase 1 only) ─────────────
export { enqueueRefundJob } from "./api/enqueueRefundJob";
export type { EnqueueRefundJobArgs } from "./api/enqueueRefundJob";

// ── 위약금 정책 (순수) ─────────────────────────────────────────
export { computePenalty, OVERSEAS_PENALTY_TIERS } from "./model/penaltyPolicy";
export type { PenaltyResult, PenaltyInput } from "./model/penaltyPolicy";

// ── 잔여 환불가능액 (순수) ─────────────────────────────────────
export { refundableAmount } from "./model/refundable";

// ── UI ──────────────────────────────────────────────────────────
export { PaymentStatusBadge, PAYMENT_STATUS_LABEL } from "./ui/PaymentStatusBadge";

export { getRefundCompletedEmailData } from "./api/getRefundCompletedEmailData";
export type { RefundCompletedEmailData } from "./api/getRefundCompletedEmailData";

export { getPartialRefundCompletedEmailData } from "./api/getPartialRefundCompletedEmailData";
export type { PartialRefundCompletedEmailData } from "./api/getPartialRefundCompletedEmailData";
