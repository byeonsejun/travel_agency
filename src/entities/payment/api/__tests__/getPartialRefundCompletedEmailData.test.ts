import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  db: { refundJob: { findUnique: vi.fn() } },
}));
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));

import { getPartialRefundCompletedEmailData } from "../getPartialRefundCompletedEmailData";

describe("getPartialRefundCompletedEmailData", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path: refundJob 조회 후 props 반환 (originalAmount=payment.amount, 위약금 포함)", async () => {
    mocks.db.refundJob.findUnique.mockResolvedValue({
      amount: 700000,
      penaltyAmount: 300000,
      payment: { amount: 1_000_000, method: "CARD" },
      booking: {
        id: "clbk-partial",
        user: { email: "kim@nextour.test", name: "김부분" },
        departure: { product: { title: "발리 5박6일" } },
      },
    });

    const out = await getPartialRefundCompletedEmailData("clrj-001");

    expect(out).toEqual({
      recipientEmail: "kim@nextour.test",
      props: {
        customerName: "김부분",
        bookingId: "clbk-partial",
        productTitle: "발리 5박6일",
        originalAmount: 1_000_000,
        penaltyAmount: 300000,
        refundAmount: 700000,
        paymentMethod: "카드",
      },
    });
  });

  it("customerName 폴백: user.name=null → '고객'", async () => {
    mocks.db.refundJob.findUnique.mockResolvedValue({
      amount: 500000,
      penaltyAmount: 0,
      payment: { amount: 500000, method: "TRANSFER" },
      booking: {
        id: "clbk-noname",
        user: { email: "anon@nextour.test", name: null },
        departure: { product: { title: "오사카 3박4일" } },
      },
    });

    const out = await getPartialRefundCompletedEmailData("clrj-002");

    expect(out).not.toBeNull();
    expect(out!.props.customerName).toBe("고객");
    expect(out!.props.paymentMethod).toBe("계좌이체");
  });

  it("METHOD_LABEL 매핑: VIRTUAL_ACCOUNT → '가상계좌'", async () => {
    mocks.db.refundJob.findUnique.mockResolvedValue({
      amount: 200000,
      penaltyAmount: 0,
      payment: { amount: 200000, method: "VIRTUAL_ACCOUNT" },
      booking: {
        id: "clbk-va",
        user: { email: "va@nextour.test", name: "이가상" },
        departure: { product: { title: "제주 2박3일" } },
      },
    });

    const out = await getPartialRefundCompletedEmailData("clrj-003");

    expect(out).not.toBeNull();
    expect(out!.props.paymentMethod).toBe("가상계좌");
  });

  it("refundJob not found: findUnique → null 반환 시 null 반환", async () => {
    mocks.db.refundJob.findUnique.mockResolvedValue(null);

    expect(await getPartialRefundCompletedEmailData("clrj-missing")).toBeNull();
  });
});
