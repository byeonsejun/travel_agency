import { describe, it, expect, vi, afterEach } from "vitest";
import { tossClient } from "../client";
import { PaymentError } from "../errors";

describe("tossClient.getPayment", () => {
  const PAYMENT_KEY = "tpayments_test_pk_001";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("성공: GET /v1/payments/{paymentKey} 호출 + 응답 파싱", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          paymentKey: PAYMENT_KEY,
          orderId: "order_001",
          status: "DONE",
          totalAmount: 120_000,
          approvedAt: "2026-05-26T00:00:00+09:00",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await tossClient.getPayment(PAYMENT_KEY);

    expect(result.paymentKey).toBe(PAYMENT_KEY);
    expect(result.totalAmount).toBe(120_000);
    expect(result.status).toBe("DONE");

    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toMatch(/\/v1\/payments\/tpayments_test_pk_001$/);
    expect((call[1] as RequestInit).method).toBe("GET");
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Basic /);
  });

  it("HTTP 404: PaymentError(PG_HTTP) throw — body 포함", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "NOT_FOUND_PAYMENT" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(tossClient.getPayment(PAYMENT_KEY)).rejects.toMatchObject({
      code: "PG_HTTP",
      context: expect.objectContaining({ status: 404 }),
    });
  });

  it("네트워크 에러: PaymentError(PG_NETWORK_ERROR) throw", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"));

    await expect(tossClient.getPayment(PAYMENT_KEY)).rejects.toBeInstanceOf(
      PaymentError,
    );
    await expect(tossClient.getPayment(PAYMENT_KEY)).rejects.toMatchObject({
      code: "PG_NETWORK_ERROR",
    });
  });
});
