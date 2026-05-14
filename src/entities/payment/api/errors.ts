/**
 * 결제 도메인 에러 클래스.
 *
 * code로 실패 지점을 식별하고, isPgError / isDbError / isBusinessError로
 * 롤백 전략(compensateCancel vs RefundJob enqueue)을 결정한다.
 *
 * context에는 복구에 필요한 최소 데이터(paymentKey, orderId, bookingId 등)를 담는다.
 *
 * ⚠️ shared/lib/toss/errors.ts의 PaymentError(HTTP 클라이언트 전용)와 별개.
 *    tossClient가 던진 에러는 entities/payment 내부에서 이 클래스로 래핑·재throw된다.
 */

export type PaymentErrorCode =
  // 비즈니스 로직 에러
  | "BOOKING_NOT_FOUND"
  | "FORBIDDEN"
  | "BOOKING_NOT_PAYABLE"
  | "AMOUNT_MISMATCH_REQUEST"
  | "AMOUNT_MISMATCH_PG_RESPONSE"
  | "AMOUNT_NOT_INTEGER"
  | "REFUND_ALREADY_REQUESTED"
  | "REFUND_DEFERRED"
  | "PAID_PAYMENT_NOT_FOUND"
  | "BOOKING_NOT_REFUNDABLE"
  | "WEBHOOK_AMOUNT_MISMATCH"
  // 외부 PG(Toss) 통신 에러 → compensateCancel / RefundJob 트리거 판단 기준
  | "PG_NETWORK_ERROR"
  | "PG_HTTP"
  // 내부 DB 에러 → compensateCancel 실패 시 RefundJob enqueue 필수
  | "DB_UPDATE_FAILED";

const PG_ERROR_CODES = new Set<PaymentErrorCode>(["PG_NETWORK_ERROR", "PG_HTTP"]);
const DB_ERROR_CODES = new Set<PaymentErrorCode>(["DB_UPDATE_FAILED"]);

export class PaymentError extends Error {
  readonly name = "PaymentError";

  constructor(
    public readonly code: PaymentErrorCode,
    public readonly context?: Record<string, unknown>
  ) {
    super(`PaymentError: ${code}`);
  }

  /** 외부 PG(Toss) 네트워크/HTTP 에러 — compensateCancel 후 RefundJob 판단 */
  isPgError(): boolean {
    return PG_ERROR_CODES.has(this.code);
  }

  /** 내부 DB 처리 실패 — compensateCancel 성공 여부와 무관하게 RefundJob enqueue 권장 */
  isDbError(): boolean {
    return DB_ERROR_CODES.has(this.code);
  }

  /** 비즈니스 규칙 위반 — 롤백 불필요, 사용자에게 즉시 응답 */
  isBusinessError(): boolean {
    return !this.isPgError() && !this.isDbError();
  }
}

export class InvalidSignatureError extends Error {
  readonly name = "InvalidSignatureError";

  constructor(message = "Invalid Toss webhook signature") {
    super(message);
  }
}
