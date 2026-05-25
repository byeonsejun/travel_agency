import { describe, it, expect } from "vitest";
import {
  ConfirmPaymentRequestSchema,
  TossWebhookV2EventSchema,
  PaymentStatusChangedDataSchema,
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

// ── TossWebhookV2EventSchema (v2024-06-01 envelope) ──────────────────────────

describe("TossWebhookV2EventSchema", () => {
  const valid = {
    eventType: "PAYMENT_STATUS_CHANGED",
    createdAt: "2026-05-24T01:18:13.957Z",
    data: { paymentKey: "pk", orderId: "ord__1", status: "DONE", totalAmount: 100 },
  };

  it("정상 케이스 통과", () => {
    expect(TossWebhookV2EventSchema.safeParse(valid).success).toBe(true);
  });

  it("eventType 누락 거부", () => {
    const { eventType: _eventType, ...rest } = valid;
    void _eventType;
    expect(TossWebhookV2EventSchema.safeParse(rest).success).toBe(false);
  });

  it("data 누락 거부", () => {
    const { data: _data, ...rest } = valid;
    void _data;
    expect(TossWebhookV2EventSchema.safeParse(rest).success).toBe(false);
  });

  it("미지원 eventType 값도 통과 (안정성 우선 — dispatch 에서 IGNORED)", () => {
    expect(
      TossWebhookV2EventSchema.safeParse({ ...valid, eventType: "FUTURE_UNKNOWN_EVENT" })
        .success,
    ).toBe(true);
  });

  it("createdAt 없어도 통과 (optional)", () => {
    const { createdAt: _createdAt, ...rest } = valid;
    void _createdAt;
    expect(TossWebhookV2EventSchema.safeParse(rest).success).toBe(true);
  });

  it("data 가 빈 객체여도 envelope 단계에선 통과 (내부는 dispatch 에서 parse)", () => {
    expect(
      TossWebhookV2EventSchema.safeParse({ ...valid, data: {} }).success,
    ).toBe(true);
  });
});

// ── PaymentStatusChangedDataSchema (내부 정밀 검증) ─────────────────────────

describe("PaymentStatusChangedDataSchema", () => {
  const valid = {
    paymentKey: "tviva_payment_key",
    orderId: "ord__1",
    status: "DONE" as const,
    totalAmount: 100,
    approvedAt: "2026-05-24T01:18:13+09:00",
    receipt: { url: "https://dashboard-sandbox.tosspayments.com/receipt/x" },
  };

  it("정상 DONE 통과", () => {
    expect(PaymentStatusChangedDataSchema.safeParse(valid).success).toBe(true);
  });

  it("paymentKey 빈 거부", () => {
    expect(
      PaymentStatusChangedDataSchema.safeParse({ ...valid, paymentKey: "" }).success,
    ).toBe(false);
  });

  it("orderId 빈 거부", () => {
    expect(
      PaymentStatusChangedDataSchema.safeParse({ ...valid, orderId: "" }).success,
    ).toBe(false);
  });

  it("status enum 외 값 거부", () => {
    expect(
      PaymentStatusChangedDataSchema.safeParse({ ...valid, status: "UNKNOWN" }).success,
    ).toBe(false);
  });

  it.each(["READY", "IN_PROGRESS", "WAITING_FOR_DEPOSIT", "DONE", "CANCELED", "PARTIAL_CANCELED", "ABORTED", "EXPIRED"] as const)(
    "status %s 통과",
    (status) => {
      expect(
        PaymentStatusChangedDataSchema.safeParse({ ...valid, status }).success,
      ).toBe(true);
    },
  );

  it("totalAmount 소수 거부", () => {
    expect(
      PaymentStatusChangedDataSchema.safeParse({ ...valid, totalAmount: 100.5 }).success,
    ).toBe(false);
  });

  it("totalAmount 음수 거부", () => {
    expect(
      PaymentStatusChangedDataSchema.safeParse({ ...valid, totalAmount: -1 }).success,
    ).toBe(false);
  });

  it("approvedAt/receipt null 도 허용", () => {
    expect(
      PaymentStatusChangedDataSchema.safeParse({
        ...valid,
        approvedAt: null,
        receipt: null,
      }).success,
    ).toBe(true);
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
