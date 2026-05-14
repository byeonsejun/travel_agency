import { describe, it, expect } from "vitest";
import { PaymentError, InvalidSignatureError } from "../errors";

// ── PaymentError ─────────────────────────────────────────────────────────────

describe("PaymentError", () => {
  it("code와 context를 담는다", () => {
    const err = new PaymentError("PG_HTTP", { status: 400, paymentKey: "pk_x" });
    expect(err.code).toBe("PG_HTTP");
    expect(err.context).toMatchObject({ status: 400, paymentKey: "pk_x" });
  });

  it("Error를 extends한다 (instanceof 체크)", () => {
    const err = new PaymentError("BOOKING_NOT_FOUND");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PaymentError);
  });

  it("name 필드가 'PaymentError'이다", () => {
    expect(new PaymentError("FORBIDDEN").name).toBe("PaymentError");
  });

  it("message에 code가 포함된다", () => {
    expect(new PaymentError("DB_UPDATE_FAILED").message).toContain("DB_UPDATE_FAILED");
  });

  // ── 에러 분류 (사용자 요구사항: 롤백 큐 판단 근거) ─────────────────────────

  it("PG_NETWORK_ERROR → isPgError true", () => {
    expect(new PaymentError("PG_NETWORK_ERROR").isPgError()).toBe(true);
  });

  it("PG_HTTP → isPgError true", () => {
    expect(new PaymentError("PG_HTTP").isPgError()).toBe(true);
  });

  it("DB_UPDATE_FAILED → isDbError true", () => {
    expect(new PaymentError("DB_UPDATE_FAILED").isDbError()).toBe(true);
  });

  it("비즈니스 에러는 isPgError·isDbError 모두 false, isBusinessError true", () => {
    const codes = [
      "BOOKING_NOT_FOUND",
      "FORBIDDEN",
      "BOOKING_NOT_PAYABLE",
      "AMOUNT_MISMATCH_REQUEST",
      "AMOUNT_MISMATCH_PG_RESPONSE",
      "AMOUNT_NOT_INTEGER",
      "REFUND_ALREADY_REQUESTED",
      "REFUND_DEFERRED",
      "PAID_PAYMENT_NOT_FOUND",
      "BOOKING_NOT_REFUNDABLE",
      "WEBHOOK_AMOUNT_MISMATCH",
    ] as const;

    for (const code of codes) {
      const err = new PaymentError(code);
      expect(err.isPgError(), `${code} isPgError`).toBe(false);
      expect(err.isDbError(), `${code} isDbError`).toBe(false);
      expect(err.isBusinessError(), `${code} isBusinessError`).toBe(true);
    }
  });

  it("context에 paymentKey·orderId를 담아 RefundJob 복구 데이터로 활용 가능", () => {
    const ctx = { paymentKey: "pk_abc", orderId: "ord_abc__1", bookingId: "bk_123" };
    const err = new PaymentError("PG_NETWORK_ERROR", ctx);
    expect(err.context?.paymentKey).toBe("pk_abc");
    expect(err.context?.orderId).toBe("ord_abc__1");
  });
});

// ── InvalidSignatureError ─────────────────────────────────────────────────────

describe("InvalidSignatureError", () => {
  it("Error를 extends한다", () => {
    expect(new InvalidSignatureError()).toBeInstanceOf(Error);
  });

  it("name 필드가 'InvalidSignatureError'이다", () => {
    expect(new InvalidSignatureError().name).toBe("InvalidSignatureError");
  });

  it("메시지를 커스터마이즈할 수 있다", () => {
    const err = new InvalidSignatureError("tampered");
    expect(err.message).toBe("tampered");
  });

  it("기본 메시지가 존재한다", () => {
    expect(new InvalidSignatureError().message.length).toBeGreaterThan(0);
  });
});
