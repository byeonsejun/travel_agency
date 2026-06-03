import { describe, it, expect } from "vitest";
import { emailJobForTransition } from "../emailPolicy";

const BID = "clbk000000000000000001";

describe("emailJobForTransition", () => {
  it("any → PAID 는 예약확정 메일 descriptor", () => {
    expect(emailJobForTransition("DEPARTURE_CONFIRMED", "PAID", BID)).toEqual({
      type: "BOOKING_CONFIRMATION",
      dedupeKey: `booking-confirmation:${BID}`,
    });
  });

  it("PAID → CANCELED_BY_USER 는 환불 메일 descriptor", () => {
    expect(emailJobForTransition("PAID", "CANCELED_BY_USER", BID)).toEqual({
      type: "REFUND_COMPLETED",
      dedupeKey: `refund-completed:${BID}`,
    });
  });

  it("READY → CANCELED_BY_AGENCY 도 환불 메일 (돈이 오간 상태)", () => {
    expect(emailJobForTransition("READY", "CANCELED_BY_AGENCY", BID)).toEqual({
      type: "REFUND_COMPLETED",
      dedupeKey: `refund-completed:${BID}`,
    });
  });

  it("DEPARTURE_CONFIRMED → CANCELED 는 환불 메일 없음 (결제 전 단계)", () => {
    expect(
      emailJobForTransition("DEPARTURE_CONFIRMED", "CANCELED_BY_USER", BID),
    ).toBeNull();
  });

  it("RECEIVED → CANCELED 는 메일 없음", () => {
    expect(emailJobForTransition("RECEIVED", "CANCELED_BY_AGENCY", BID)).toBeNull();
  });

  it("PAID → READY (eticket) 는 메일 없음", () => {
    expect(emailJobForTransition("PAID", "READY", BID)).toBeNull();
  });
});
