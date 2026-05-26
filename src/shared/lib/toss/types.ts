/**
 * Toss Payments v2 API DTO 타입.
 *
 * 모든 amount 필드는 원 단위 정수(int)이다 — Toss API 사양.
 * 런타임 검증(z.number().int().positive())은 entities/payment 모델 스키마에서 수행한다.
 * 본 파일은 외부 응답 형태를 표현하는 순수 타입 선언만 포함한다.
 */

export type TossConfirmStatus =
  | "READY"
  | "IN_PROGRESS"
  | "WAITING_FOR_DEPOSIT"
  | "DONE"
  | "CANCELED"
  | "PARTIAL_CANCELED"
  | "ABORTED"
  | "EXPIRED"
  | "FAILED";

export interface TossFailureInfo {
  code: string;
  message: string;
}

export interface TossReceiptInfo {
  url: string;
}

export interface TossConfirmResponse {
  paymentKey: string;
  orderId: string;
  status: TossConfirmStatus;
  /** 원 단위 정수. Toss 응답 totalAmount는 항상 int. */
  totalAmount: number;
  approvedAt: string;
  receipt?: TossReceiptInfo;
  failure?: TossFailureInfo;
}

export type TossCancelStatus = "CANCELED" | "PARTIAL_CANCELED";

export interface TossCancelEntry {
  /** 원 단위 정수. */
  cancelAmount: number;
  canceledAt: string;
  transactionKey: string;
}

export interface TossCancelResponse {
  paymentKey: string;
  status: TossCancelStatus;
  cancels: TossCancelEntry[];
}

/**
 * Toss 결제 조회 API (`GET /v1/payments/{paymentKey}`) 응답.
 *
 * webhook cross-check 용 (ADR-0016) — payload 의 paymentKey 로 조회해
 * orderId/totalAmount/status 가 일치하는지 검증한다.
 */
export interface TossPaymentResponse {
  paymentKey: string;
  orderId: string;
  status: TossConfirmStatus;
  /** 원 단위 정수. */
  totalAmount: number;
  approvedAt?: string;
  receipt?: TossReceiptInfo;
  failure?: TossFailureInfo;
}

/**
 * Toss 웹훅 페이로드.
 *
 * `eventId`는 PG 측 고유 식별자로, `entities/payment`에서 `providerEventId` 멱등 키로 사용한다.
 * `type`은 알 수 없는 값이 올 수 있으므로 string 그대로 표현 — 분기 처리는 핸들러에서 IGNORED 폴백.
 */
export interface TossWebhookPayload {
  eventId: string;
  orderId: string;
  paymentKey?: string;
  type: string;
  /** 원 단위 정수(옵셔널). 결제 완료/취소 이벤트에서만 동봉. */
  totalAmount?: number;
  approvedAt?: string;
  canceledAt?: string;
  failure?: TossFailureInfo;
  receipt?: TossReceiptInfo;
}
