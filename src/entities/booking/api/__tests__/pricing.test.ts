import { describe, it, expect } from "vitest";
import { computeTotalPrice } from "../pricing";

describe("computeTotalPrice", () => {
  it("성인 2 + 아동 1 + 영아 1 → 정확한 합산", () => {
    const result = computeTotalPrice({
      priceAdult: 100_000,
      priceChild: 70_000,
      priceInfant: 0,
      adultCount: 2,
      childCount: 1,
      infantCount: 1,
    });
    expect(result).toBe(270_000);
  });

  it("모든 인원 0 → 0", () => {
    const result = computeTotalPrice({
      priceAdult: 500_000,
      priceChild: 300_000,
      priceInfant: 50_000,
      adultCount: 0,
      childCount: 0,
      infantCount: 0,
    });
    expect(result).toBe(0);
  });

  it("결과가 정수(Number.isInteger) 보장", () => {
    const result = computeTotalPrice({
      priceAdult: 123_456,
      priceChild: 78_901,
      priceInfant: 10_000,
      adultCount: 3,
      childCount: 2,
      infantCount: 1,
    });
    expect(Number.isInteger(result)).toBe(true);
  });

  it("영아 가격이 0인 경우 영아 인원 반영 안 됨", () => {
    const result = computeTotalPrice({
      priceAdult: 200_000,
      priceChild: 0,
      priceInfant: 0,
      adultCount: 1,
      childCount: 0,
      infantCount: 5,
    });
    expect(result).toBe(200_000);
  });

  it("성인만 존재 — 아동·영아 0명", () => {
    const result = computeTotalPrice({
      priceAdult: 500_000,
      priceChild: 300_000,
      priceInfant: 50_000,
      adultCount: 2,
      childCount: 0,
      infantCount: 0,
    });
    expect(result).toBe(1_000_000);
  });
});
