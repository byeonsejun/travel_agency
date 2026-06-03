import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  db: { booking: { findUnique: vi.fn() } },
}));
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));

import { getRefundCompletedEmailData } from "../getRefundCompletedEmailData";

describe("getRefundCompletedEmailData", () => {
  beforeEach(() => vi.clearAllMocks());

  it("환불 금액·수단 조립 후 props 반환 (CANCELED + RefundJob 기반)", async () => {
    mocks.db.booking.findUnique.mockResolvedValue({
      id: "clbk2",
      user: { email: "kim@nextour.test", name: "김여행" },
      departure: { product: { title: "다낭 4박5일" } },
      payments: [{ method: "CARD" }],
      refundJobs: [{ amount: 880000, penaltyAmount: 0 }],
    });

    const out = await getRefundCompletedEmailData("clbk2");
    expect(out).toEqual({
      recipientEmail: "kim@nextour.test",
      props: {
        customerName: "김여행",
        bookingId: "clbk2",
        productTitle: "다낭 4박5일",
        refundAmount: 880000,
        penaltyAmount: 0,
        paymentMethod: "카드",
      },
    });
  });

  it("환불 대상 payment 없으면 null", async () => {
    mocks.db.booking.findUnique.mockResolvedValue({
      id: "clbk2",
      user: { email: "x@y.test", name: null },
      departure: { product: { title: "t" } },
      payments: [],
      refundJobs: [],
    });
    expect(await getRefundCompletedEmailData("clbk2")).toBeNull();
  });

  it("SUCCEEDED RefundJob 없으면 null (환불 미완료)", async () => {
    mocks.db.booking.findUnique.mockResolvedValue({
      id: "clbk2",
      user: { email: "x@y.test", name: null },
      departure: { product: { title: "t" } },
      payments: [{ method: "CARD" }],
      refundJobs: [], // SUCCEEDED job 없음
    });
    expect(await getRefundCompletedEmailData("clbk2")).toBeNull();
  });
});

describe("getRefundCompletedEmailData — 부분 환불", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Case A — PARTIAL_CANCELED: refundAmount는 RefundJob.amount(700000), penaltyAmount는 300000", async () => {
    mocks.db.booking.findUnique.mockResolvedValue({
      id: "clbk-partial",
      user: { email: "partial@nextour.test", name: "박부분" },
      departure: { product: { title: "발리 5박6일" } },
      // PARTIAL_CANCELED payment — amount(원래 결제액 1,000,000)는 더 이상 읽지 않는다
      payments: [{ method: "CARD" }],
      refundJobs: [{ amount: 700000, penaltyAmount: 300000 }],
    });

    const out = await getRefundCompletedEmailData("clbk-partial");

    expect(out).not.toBeNull();
    // 실제 환불액은 RefundJob.amount (원래 결제액 1,000,000 이 아님)
    expect(out!.props.refundAmount).toBe(700000);
    expect(out!.props.penaltyAmount).toBe(300000);
    expect(out!.props.paymentMethod).toBe("카드");
  });

  it("Case B — CANCELED(전액): refundAmount 500000, penaltyAmount 0", async () => {
    mocks.db.booking.findUnique.mockResolvedValue({
      id: "clbk-full",
      user: { email: "full@nextour.test", name: "이전액" },
      departure: { product: { title: "오사카 3박4일" } },
      payments: [{ method: "TRANSFER" }],
      refundJobs: [{ amount: 500000, penaltyAmount: 0 }],
    });

    const out = await getRefundCompletedEmailData("clbk-full");

    expect(out).not.toBeNull();
    expect(out!.props.refundAmount).toBe(500000);
    expect(out!.props.penaltyAmount).toBe(0);
    expect(out!.props.paymentMethod).toBe("계좌이체");
  });
});
