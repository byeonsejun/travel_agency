import { z } from "zod";

export const ConfirmPaymentRequestSchema = z.object({
  paymentKey: z.string().min(1),
  orderId: z.string().min(1),
  // R6: 정수 원 단위. 0·음수·소수·NaN 모두 거부.
  amount: z.number().int().positive(),
});

export type ConfirmPaymentRequest = z.infer<typeof ConfirmPaymentRequestSchema>;

export const TossWebhookEventSchema = z.object({
  eventId: z.string().min(1),
  orderId: z.string().min(1),
  // 미지원 type도 string으로 수용 — 핸들러에서 IGNORED 폴백
  type: z.string().min(1),
  paymentKey: z.string().optional(),
  // 정수 원 단위, 옵셔널 (결제 완료/취소 이벤트에서만 동봉)
  totalAmount: z.number().int().positive().optional(),
  approvedAt: z.string().optional(),
  canceledAt: z.string().optional(),
  failure: z
    .object({ code: z.string(), message: z.string() })
    .optional(),
  receipt: z.object({ url: z.string() }).optional(),
});

export type TossWebhookEvent = z.infer<typeof TossWebhookEventSchema>;

export const RefundRequestSchema = z.object({
  bookingId: z.string().min(1),
  reason: z.string().max(100).optional(),
});

export type RefundRequest = z.infer<typeof RefundRequestSchema>;
