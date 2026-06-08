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

// payment 슬라이스에서 이전된 D-day 경계 커버리지 (KST daysUntil + tier 임계).
// 주입식 시그니처(tiers: OVERSEAS_PENALTY_TIERS)로 재작성. 신규 catch-all(-99999)에서도
// D=0/D<0이 0.5 tier로 해소되는지 함께 검증.
describe("computePenalty — 국외여행 표준약관 구간 (OVERSEAS_PENALTY_TIERS 주입)", () => {
  // 출발일 2026-07-01 (UTC 자정) — Prisma @db.Date 역직렬화 방식과 동일.
  const departureDate = new Date("2026-07-01T00:00:00.000Z");
  const base = 1_000_000; // 100만원

  function at(daysBefore: number): Date {
    // 출발일 KST 자정(= UTC 전날 15:00)에서 daysBefore일 전의 정오(자정 경계 오차 회피)
    const kstMidnightUtcMs = departureDate.getTime() - 9 * 3_600_000;
    return new Date(kstMidnightUtcMs - daysBefore * 86_400_000 + 12 * 3_600_000);
  }
  const compute = (now: Date, baseAmount: number = base) =>
    computePenalty({ baseAmount, departureDate, now, tiers: OVERSEAS_PENALTY_TIERS });

  it("D≥30: 위약금 0%", () => {
    const r = compute(at(30));
    expect(r.rate).toBe(0);
    expect(r.penaltyAmount).toBe(0);
    expect(r.refundAmount).toBe(base);
  });
  it("D=29: 10%", () => expect(compute(at(29)).rate).toBe(0.1));
  it("D=20: 10%", () => expect(compute(at(20)).rate).toBe(0.1));
  it("D=19: 15%", () => expect(compute(at(19)).rate).toBe(0.15));
  it("D=10: 15%", () => expect(compute(at(10)).rate).toBe(0.15));
  it("D=9: 20%", () => expect(compute(at(9)).rate).toBe(0.2));
  it("D=8: 20%", () => expect(compute(at(8)).rate).toBe(0.2));
  it("D=7: 30%", () => expect(compute(at(7)).rate).toBe(0.3));
  it("D=1: 30%", () => expect(compute(at(1)).rate).toBe(0.3));
  it("D=0 (당일): 50%", () => {
    const r = compute(at(0));
    expect(r.rate).toBe(0.5);
    expect(r.penaltyAmount).toBe(500_000);
    expect(r.refundAmount).toBe(500_000);
  });
  it("D<0 (출발 후): 50% (catch-all -99999 해소)", () => {
    expect(compute(at(-3)).rate).toBe(0.5);
  });
  it("불변식: penalty + refund === base, 모두 정수", () => {
    const r = compute(at(5), 999_999); // 30%
    expect(Number.isInteger(r.penaltyAmount)).toBe(true);
    expect(Number.isInteger(r.refundAmount)).toBe(true);
    expect(r.penaltyAmount + r.refundAmount).toBe(999_999);
    // floor: 999999 * 0.3 = 299999.7 → 299999
    expect(r.penaltyAmount).toBe(299_999);
    expect(r.refundAmount).toBe(700_000);
  });
});
