import { describe, it, expect } from "vitest";
import { travelerCancelKey, discretionaryKey, fullCancelKey } from "../refundKeys";
import { refundableAmount } from "../refundable";

describe("refundKeys", () => {
  it("travelerCancelKey는 traveler id 정렬에 무관하게 동일 (멱등)", () => {
    const a = travelerCancelKey("bk1", ["t3", "t1", "t2"]);
    const b = travelerCancelKey("bk1", ["t1", "t2", "t3"]);
    expect(a).toBe(b);
    expect(a).toBe("traveler-cancel:bk1:t1,t2,t3");
  });
  it("discretionaryKey는 requestId 기반", () => {
    expect(discretionaryKey("bk1", "req-9")).toBe("discretionary:bk1:req-9");
  });
  it("fullCancelKey는 booking당 1개", () => {
    expect(fullCancelKey("bk1")).toBe("full-cancel:bk1");
  });
});

describe("refundableAmount", () => {
  it("amount - refundedAmount", () => {
    expect(refundableAmount({ amount: 1000, refundedAmount: 300 })).toBe(700);
  });
  it("음수 방지(0 하한)", () => {
    expect(refundableAmount({ amount: 1000, refundedAmount: 1200 })).toBe(0);
  });
});
