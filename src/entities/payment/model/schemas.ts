import { z } from "zod";

export const ConfirmPaymentRequestSchema = z.object({
  paymentKey: z.string().min(1),
  orderId: z.string().min(1),
  // R6: 정수 원 단위. 0·음수·소수·NaN 모두 거부.
  amount: z.number().int().positive(),
});

export type ConfirmPaymentRequest = z.infer<typeof ConfirmPaymentRequestSchema>;

// ─────────────────────────────────────────────────────────────
// Toss Webhook v2024-06-01 (v2)
// ─────────────────────────────────────────────────────────────
// 토스 v2 가이드: https://docs.tosspayments.com/guides/webhook
//
// 마이그레이션 1차 범위 (plan 2026-05-24-toss-webhook-v2):
//   - PAYMENT_STATUS_CHANGED + data.status === "DONE" 만 처리
//   - 그 외 eventType / status 는 envelope 단계에서 통과, dispatch 에서 IGNORED
//
// passthrough() 로 미사용 필드 수용 — 토스가 향후 새 필드 추가해도 schema parse
// 실패로 500 떨어지지 않음(안정성 우선).

/** PAYMENT_STATUS_CHANGED 이벤트의 data.* 필드 (가이드 §1 표). */
export const PaymentStatusChangedDataSchema = z
  .object({
    paymentKey: z.string().min(1),
    orderId: z.string().min(1),
    status: z.enum([
      "READY",
      "IN_PROGRESS",
      "WAITING_FOR_DEPOSIT",
      "DONE",
      "CANCELED",
      "PARTIAL_CANCELED",
      "ABORTED",
      "EXPIRED",
    ]),
    totalAmount: z.number().int().nonnegative(),
    approvedAt: z.string().nullable().optional(),
    receipt: z.object({ url: z.string() }).nullable().optional(),
    failure: z
      .object({ code: z.string(), message: z.string() })
      .nullable()
      .optional(),
  })
  .passthrough();

export type TossPaymentStatusChangedData = z.infer<
  typeof PaymentStatusChangedDataSchema
>;

/**
 * v2 webhook envelope — 모든 eventType 의 공통 형태.
 *
 * `eventType` 은 string 으로 받고(가이드 §1 목록 8종 + 향후 신규), `data` 는
 * 내부 검증을 dispatch 시점에 type 별 schema 로 위임한다. 미지원 eventType 은
 * envelope 단계에서 통과 → dispatch 에서 IGNORED no-op + PaymentEvent 기록.
 */
export const TossWebhookV2EventSchema = z
  .object({
    eventType: z.string().min(1),
    createdAt: z.string().optional(),
    data: z.record(z.unknown()),
  })
  .passthrough();

export type TossWebhookV2Event = z.infer<typeof TossWebhookV2EventSchema>;

export const RefundRequestSchema = z.object({
  bookingId: z.string().min(1),
  reason: z.string().max(100).optional(),
});

export type RefundRequest = z.infer<typeof RefundRequestSchema>;
