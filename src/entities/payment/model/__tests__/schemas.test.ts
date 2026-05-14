import { describe, it, expect } from "vitest";
import {
  ConfirmPaymentRequestSchema,
  TossWebhookEventSchema,
  RefundRequestSchema,
} from "../schemas";

// ── ConfirmPaymentRequestSchema ──────────────────────────────────────────────

describe("ConfirmPaymentRequestSchema", () => {
  const valid = { paymentKey: "pk_test_abc", orderId: "ord_abc__1", amount: 10000 };

  it("정상 케이스 통과", () => {
    expect(ConfirmPaymentRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("paymentKey 빈 문자열 거부", () => {
    expect(
      ConfirmPaymentRequestSchema.safeParse({ ...valid, paymentKey: "" }).success
    ).toBe(false);
  });

  it("orderId 빈 문자열 거부", () => {
    expect(
      ConfirmPaymentRequestSchema.safeParse({ ...valid, orderId: "" }).success
    ).toBe(false);
  });

  it("amount 음수 거부", () => {
    expect(
      ConfirmPaymentRequestSchema.safeParse({ ...valid, amount: -1 }).success
    ).toBe(false);
  });

  it("amount 0 거부", () => {
    expect(
      ConfirmPaymentRequestSchema.safeParse({ ...valid, amount: 0 }).success
    ).toBe(false);
  });

  it("amount 소수(float) 거부", () => {
    expect(
      ConfirmPaymentRequestSchema.safeParse({ ...valid, amount: 1.5 }).success
    ).toBe(false);
  });

  it("amount NaN 거부", () => {
    expect(
      ConfirmPaymentRequestSchema.safeParse({ ...valid, amount: NaN }).success
    ).toBe(false);
  });
});

// ── TossWebhookEventSchema ───────────────────────────────────────────────────

describe("TossWebhookEventSchema", () => {
  const valid = {
    eventId: "evt_abc123",
    orderId: "ord_abc__1",
    type: "PAYMENT_DONE",
    totalAmount: 10000,
  };

  it("정상 케이스 통과", () => {
    expect(TossWebhookEventSchema.safeParse(valid).success).toBe(true);
  });

  it("eventId 누락 거부", () => {
    const { eventId: _, ...rest } = valid;
    expect(TossWebhookEventSchema.safeParse(rest).success).toBe(false);
  });

  it("orderId 누락 거부", () => {
    const { orderId: _, ...rest } = valid;
    expect(TossWebhookEventSchema.safeParse(rest).success).toBe(false);
  });

  it("type 누락 거부", () => {
    const { type: _, ...rest } = valid;
    expect(TossWebhookEventSchema.safeParse(rest).success).toBe(false);
  });

  it("미지원 type 값도 통과 (string이면 OK)", () => {
    expect(
      TossWebhookEventSchema.safeParse({ ...valid, type: "FUTURE_UNKNOWN_EVENT" }).success
    ).toBe(true);
  });

  it("totalAmount 없어도 통과 (optional)", () => {
    const { totalAmount: _, ...rest } = valid;
    expect(TossWebhookEventSchema.safeParse(rest).success).toBe(true);
  });

  it("totalAmount 소수이면 거부", () => {
    expect(
      TossWebhookEventSchema.safeParse({ ...valid, totalAmount: 10000.5 }).success
    ).toBe(false);
  });

  it("totalAmount 음수이면 거부", () => {
    expect(
      TossWebhookEventSchema.safeParse({ ...valid, totalAmount: -1 }).success
    ).toBe(false);
  });
});

// ── RefundRequestSchema ──────────────────────────────────────────────────────

describe("RefundRequestSchema", () => {
  const valid = { bookingId: "bk_abc123", reason: "단순 변심" };

  it("정상 케이스 통과", () => {
    expect(RefundRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("bookingId 누락 거부", () => {
    expect(RefundRequestSchema.safeParse({ reason: "test" }).success).toBe(false);
  });

  it("reason 100자 초과 거부", () => {
    expect(
      RefundRequestSchema.safeParse({ ...valid, reason: "가".repeat(101) }).success
    ).toBe(false);
  });

  it("reason 100자 정확히 통과", () => {
    expect(
      RefundRequestSchema.safeParse({ ...valid, reason: "가".repeat(100) }).success
    ).toBe(true);
  });

  it("reason 없어도 통과 (optional)", () => {
    expect(RefundRequestSchema.safeParse({ bookingId: "bk_abc123" }).success).toBe(true);
  });
});
