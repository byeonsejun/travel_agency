import { describe, it, expect } from "vitest";
import { renderEmail } from "../render";

describe("renderEmail", () => {
  it("BOOKING_CONFIRMATION: subject + 핵심 데이터 포함", async () => {
    const out = await renderEmail("BOOKING_CONFIRMATION", {
      customerName: "홍길동",
      bookingId: "clbk1",
      productTitle: "오사카 3박4일",
      departureDate: "2026-08-15",
      travelerCount: 2,
      totalPrice: 1290000,
      receiptUrl: "https://receipt.example/abc",
    });
    expect(out.subject).toContain("예약");
    expect(out.html).toContain("오사카 3박4일");
    expect(out.html).toContain("1,290,000");
    expect(out.html).toContain("https://receipt.example/abc");
    expect(out.text).toContain("오사카 3박4일");
  });

  it("REFUND_COMPLETED: subject + 환불 금액 포함", async () => {
    const out = await renderEmail("REFUND_COMPLETED", {
      customerName: "김여행",
      bookingId: "clbk2",
      productTitle: "다낭 4박5일",
      refundAmount: 880000,
      penaltyAmount: 0,
      paymentMethod: "카드",
    });
    expect(out.subject).toContain("환불");
    expect(out.html).toContain("880,000");
    expect(out.html).toContain("다낭 4박5일");
  });
});
