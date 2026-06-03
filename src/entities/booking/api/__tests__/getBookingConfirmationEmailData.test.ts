import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  db: { booking: { findUnique: vi.fn() } },
}));
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));

import { getBookingConfirmationEmailData } from "../getBookingConfirmationEmailData";

describe("getBookingConfirmationEmailData", () => {
  beforeEach(() => vi.clearAllMocks());

  it("booking→user/departure/product/payment 조립 후 props 반환", async () => {
    mocks.db.booking.findUnique.mockResolvedValue({
      id: "clbk1",
      adultCount: 2,
      childCount: 1,
      infantCount: 0,
      totalPrice: 1290000,
      user: { email: "go@nextour.test", name: "홍길동" },
      departure: {
        departureDate: new Date("2026-08-15T00:00:00Z"),
        product: { title: "오사카 3박4일" },
      },
      payments: [{ receiptUrl: "https://r.example/x", status: "PAID" }],
    });

    const out = await getBookingConfirmationEmailData("clbk1");
    expect(out).toEqual({
      recipientEmail: "go@nextour.test",
      props: {
        customerName: "홍길동",
        bookingId: "clbk1",
        productTitle: "오사카 3박4일",
        departureDate: "2026-08-15",
        travelerCount: 3,
        totalPrice: 1290000,
        receiptUrl: "https://r.example/x",
      },
    });
  });

  it("booking 없으면 null", async () => {
    mocks.db.booking.findUnique.mockResolvedValue(null);
    expect(await getBookingConfirmationEmailData("missing")).toBeNull();
  });
});
