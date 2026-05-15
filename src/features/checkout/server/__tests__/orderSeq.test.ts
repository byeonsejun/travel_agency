import { describe, it, expect } from "vitest";
import { nextOrderSeq } from "../orderSeq";

describe("nextOrderSeq", () => {
  it("기존 payment 0건 → seq 1", () => {
    expect(nextOrderSeq(0)).toBe(1);
  });

  it("기존 payment 1건 → seq 2", () => {
    expect(nextOrderSeq(1)).toBe(2);
  });

  it("기존 payment N건 → seq N+1", () => {
    expect(nextOrderSeq(5)).toBe(6);
  });

  it("seq는 항상 양의 정수 (≥1) — buildOrderId 계약 호환", () => {
    for (const n of [0, 1, 3, 10]) {
      const seq = nextOrderSeq(n);
      expect(Number.isInteger(seq)).toBe(true);
      expect(seq).toBeGreaterThanOrEqual(1);
    }
  });
});
