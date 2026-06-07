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

  describe("PARTIAL_REFUND_COMPLETED", () => {
    it("penaltyAmount > 0: subject + 세 금액 모두 포함", async () => {
      const out = await renderEmail("PARTIAL_REFUND_COMPLETED", {
        customerName: "이부분",
        bookingId: "clbk3",
        productTitle: "방콕 5박6일",
        originalAmount: 1500000,
        penaltyAmount: 300000,
        refundAmount: 1200000,
        paymentMethod: "카드",
      });
      expect(out.subject).toContain("부분 환불");
      expect(out.html).toContain("방콕 5박6일");
      expect(out.html).toContain("1,500,000");
      expect(out.html).toContain("300,000");
      expect(out.html).toContain("1,200,000");
    });

    it("penaltyAmount === 0: 위약금 행 미노출", async () => {
      const out = await renderEmail("PARTIAL_REFUND_COMPLETED", {
        customerName: "이부분",
        bookingId: "clbk4",
        productTitle: "발리 7박8일",
        originalAmount: 2000000,
        penaltyAmount: 0,
        refundAmount: 2000000,
        paymentMethod: "카드",
      });
      expect(out.subject).toContain("부분 환불");
      expect(out.html).toContain("발리 7박8일");
      expect(out.html).not.toContain("공제 위약금");
    });
  });
});
