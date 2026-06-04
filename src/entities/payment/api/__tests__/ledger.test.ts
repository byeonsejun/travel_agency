import { describe, it, expect, vi } from "vitest";
import { reserveRefund, releaseRefund } from "../ledger";

function mockTx(updateManyCount: number) {
  return {
    payment: { updateMany: vi.fn().mockResolvedValue({ count: updateManyCount }) },
  } as never;
}

describe("reserveRefund", () => {
  it("조건부 차감 성공(count=1) → true, where에 refundedAmount lte 가드 포함", async () => {
    const tx = mockTx(1);
    const ok = await reserveRefund(tx, { paymentId: "p1", amount: 1000, requestedRefund: 300 });
    expect(ok).toBe(true);
    const call = (tx as never as { payment: { updateMany: { mock: { calls: unknown[][] } } } })
      .payment.updateMany.mock.calls[0][0] as {
      where: { refundedAmount: { lte: number }; status: { in: string[] } };
      data: { refundedAmount: { increment: number } };
    };
    expect(call.where.refundedAmount.lte).toBe(700); // amount - requested
    expect(call.where.status.in).toEqual(["PAID", "PARTIAL_CANCELED"]);
    expect(call.data.refundedAmount.increment).toBe(300);
  });

  it("경합/한도초과(count=0) → false", async () => {
    const ok = await reserveRefund(mockTx(0), { paymentId: "p1", amount: 1000, requestedRefund: 300 });
    expect(ok).toBe(false);
  });
});

describe("releaseRefund", () => {
  it("refundedAmount decrement 복원", async () => {
    const tx = mockTx(1);
    await releaseRefund(tx, { paymentId: "p1", amount: 300 });
    const call = (tx as never as { payment: { updateMany: { mock: { calls: unknown[][] } } } })
      .payment.updateMany.mock.calls[0][0] as { data: { refundedAmount: { decrement: number } } };
    expect(call.data.refundedAmount.decrement).toBe(300);
  });
});
