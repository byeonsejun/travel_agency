import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  db: { booking: { findUnique: vi.fn() } },
}));
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));

import { getRefundCompletedEmailData } from "../getRefundCompletedEmailData";

describe("getRefundCompletedEmailData", () => {
  beforeEach(() => vi.clearAllMocks());

  it("환불 금액·수단 조립 후 props 반환", async () => {
    mocks.db.booking.findUnique.mockResolvedValue({
      id: "clbk2",
      user: { email: "kim@nextour.test", name: "김여행" },
      departure: { product: { title: "다낭 4박5일" } },
      payments: [{ amount: 880000, method: "CARD", status: "CANCELED" }],
    });

    const out = await getRefundCompletedEmailData("clbk2");
    expect(out).toEqual({
      recipientEmail: "kim@nextour.test",
      props: {
        customerName: "김여행",
        bookingId: "clbk2",
        productTitle: "다낭 4박5일",
        refundAmount: 880000,
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
    });
    expect(await getRefundCompletedEmailData("clbk2")).toBeNull();
  });
});
