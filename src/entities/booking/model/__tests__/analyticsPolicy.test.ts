import { describe, expect, it } from "vitest";
import { analyticsJobForTransition } from "../analyticsPolicy";

describe("analyticsJobForTransition (ADR-0062)", () => {
  it("→ PAID 전이는 PURCHASE (dedupeKey = ga-purchase:<bookingId>)", () => {
    expect(analyticsJobForTransition("DEPARTURE_CONFIRMED", "PAID", "clbk1")).toEqual({
      type: "PURCHASE",
      dedupeKey: "ga-purchase:clbk1",
    });
  });

  it("그 외 전이는 null — 환불은 RefundJob settle 에서 직접 적재(부분환불은 전이가 없음)", () => {
    expect(analyticsJobForTransition("PAID", "CANCELED_BY_USER", "clbk1")).toBeNull();
    expect(analyticsJobForTransition("PAID", "READY", "clbk1")).toBeNull();
    expect(analyticsJobForTransition("RECEIVED", "DEPARTURE_CONFIRMED", "clbk1")).toBeNull();
  });
});
