import { describe, it, expect } from "vitest";
import {
  PenaltyTiersSchema, resolvePenaltyPolicyKey, computePenalty, OVERSEAS_PENALTY_TIERS,
} from "../tiers";

describe("PenaltyTiersSchema", () => {
  it("정상 tiers 통과", () => {
    expect(PenaltyTiersSchema.safeParse([
      { minDaysBefore: 30, rate: 0 }, { minDaysBefore: -99999, rate: 0.5 },
    ]).success).toBe(true);
  });
  it("rate>1 reject", () => {
    expect(PenaltyTiersSchema.safeParse([{ minDaysBefore: -99999, rate: 1.5 }]).success).toBe(false);
  });
  it("rate=1(100%) 허용 (D4)", () => {
    expect(PenaltyTiersSchema.safeParse([{ minDaysBefore: -99999, rate: 1 }]).success).toBe(true);
  });
  it("minDaysBefore 내림차순 아니면 reject", () => {
    expect(PenaltyTiersSchema.safeParse([
      { minDaysBefore: 10, rate: 0 }, { minDaysBefore: 30, rate: 0.5 },
    ]).success).toBe(false);
  });
  it("빈 배열 reject", () => {
    expect(PenaltyTiersSchema.safeParse([]).success).toBe(false);
  });
});

describe("resolvePenaltyPolicyKey", () => {
  it("departure 우선", () => {
    expect(resolvePenaltyPolicyKey("prod_k", "dep_k")).toBe("dep_k");
  });
  it("departure 없으면 product", () => {
    expect(resolvePenaltyPolicyKey("prod_k", null)).toBe("prod_k");
  });
  it("둘 다 없으면 시스템 기본", () => {
    expect(resolvePenaltyPolicyKey(null, null)).toBe("standard_overseas");
  });
});

describe("computePenalty (tiers 주입)", () => {
  it("100% tier → refundAmount 0", () => {
    const r = computePenalty({
      baseAmount: 100000, departureDate: new Date("2026-01-02T00:00:00Z"),
      now: new Date("2026-01-01T12:00:00Z"), tiers: [{ minDaysBefore: -99999, rate: 1 }],
    });
    expect(r.penaltyAmount).toBe(100000);
    expect(r.refundAmount).toBe(0);
  });
  it("기본 상수로 30일 전 무료취소", () => {
    const r = computePenalty({
      baseAmount: 100000, departureDate: new Date("2026-12-31T00:00:00Z"),
      now: new Date("2026-01-01T12:00:00Z"), tiers: OVERSEAS_PENALTY_TIERS,
    });
    expect(r.rate).toBe(0);
    expect(r.refundAmount).toBe(100000);
  });
});
