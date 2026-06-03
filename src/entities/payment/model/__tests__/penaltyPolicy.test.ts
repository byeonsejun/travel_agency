import { describe, it, expect } from "vitest";
import { computePenalty } from "../penaltyPolicy";

// 출발일 2026-07-01 (UTC 자정) — Prisma @db.Date 역직렬화 방식과 동일.
const departureDate = new Date("2026-07-01T00:00:00.000Z");
const base = 1_000_000; // 100만원

function at(daysBefore: number): Date {
  // 출발일 KST 자정(= UTC 전날 15:00)에서 daysBefore일 전의 정오(자정 경계 오차 회피)
  // KST 자정 UTC = departureDate - 9h = 2026-06-30T15:00:00Z
  // D=N 정오 = KST 자정 UTC - N*86400s + 12h
  const kstMidnightUtcMs = departureDate.getTime() - 9 * 3_600_000;
  return new Date(kstMidnightUtcMs - daysBefore * 86_400_000 + 12 * 3_600_000);
}

describe("computePenalty — 국외여행 표준약관 구간", () => {
  it("D≥30: 위약금 0%", () => {
    const r = computePenalty({ baseAmount: base, departureDate, now: at(30) });
    expect(r.rate).toBe(0);
    expect(r.penaltyAmount).toBe(0);
    expect(r.refundAmount).toBe(base);
  });

  it("D=29: 10%", () => {
    expect(computePenalty({ baseAmount: base, departureDate, now: at(29) }).rate).toBe(0.1);
  });

  it("D=20: 10%", () => {
    expect(computePenalty({ baseAmount: base, departureDate, now: at(20) }).rate).toBe(0.1);
  });

  it("D=19: 15%", () => {
    expect(computePenalty({ baseAmount: base, departureDate, now: at(19) }).rate).toBe(0.15);
  });

  it("D=10: 15%", () => {
    expect(computePenalty({ baseAmount: base, departureDate, now: at(10) }).rate).toBe(0.15);
  });

  it("D=9: 20%", () => {
    expect(computePenalty({ baseAmount: base, departureDate, now: at(9) }).rate).toBe(0.2);
  });

  it("D=8: 20%", () => {
    expect(computePenalty({ baseAmount: base, departureDate, now: at(8) }).rate).toBe(0.2);
  });

  it("D=7: 30%", () => {
    expect(computePenalty({ baseAmount: base, departureDate, now: at(7) }).rate).toBe(0.3);
  });

  it("D=1: 30%", () => {
    expect(computePenalty({ baseAmount: base, departureDate, now: at(1) }).rate).toBe(0.3);
  });

  it("D=0 (당일): 50%", () => {
    const r = computePenalty({ baseAmount: base, departureDate, now: at(0) });
    expect(r.rate).toBe(0.5);
    expect(r.penaltyAmount).toBe(500_000);
    expect(r.refundAmount).toBe(500_000);
  });

  it("D<0 (출발 후): 50%", () => {
    expect(computePenalty({ baseAmount: base, departureDate, now: at(-3) }).rate).toBe(0.5);
  });

  it("불변식: penalty + refund === base, 모두 정수", () => {
    const r = computePenalty({ baseAmount: 999_999, departureDate, now: at(5) }); // 30%
    expect(Number.isInteger(r.penaltyAmount)).toBe(true);
    expect(Number.isInteger(r.refundAmount)).toBe(true);
    expect(r.penaltyAmount + r.refundAmount).toBe(999_999);
    // floor: 999999 * 0.3 = 299999.7 → 299999
    expect(r.penaltyAmount).toBe(299_999);
    expect(r.refundAmount).toBe(700_000);
  });
});
