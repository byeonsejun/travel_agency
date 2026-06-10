import { describe, it, expect } from "vitest";
import { SEARCH_WEIGHTS, themeBoost } from "../searchWeights";

describe("SEARCH_WEIGHTS", () => {
  it("운영 가중치는 0.5/0.2/0.2/0.1, 합은 1.0", () => {
    expect(SEARCH_WEIGHTS).toEqual({ vector: 0.5, keyword: 0.2, geo: 0.2, theme: 0.1 });
    const sum = SEARCH_WEIGHTS.vector + SEARCH_WEIGHTS.keyword + SEARCH_WEIGHTS.geo + SEARCH_WEIGHTS.theme;
    expect(sum).toBeCloseTo(1.0, 10);
  });
});

describe("themeBoost", () => {
  it("requested 0/음수/NaN은 0 반환", () => {
    expect(themeBoost(0, 0)).toBe(0);
    expect(themeBoost(3, -1)).toBe(0);
    expect(themeBoost(1, Number.NaN)).toBe(0);
  });

  it("기본 천장(0.1)으로 커버리지 비율 가산", () => {
    expect(themeBoost(1, 2)).toBeCloseTo(0.05, 10);
    expect(themeBoost(2, 2)).toBeCloseTo(0.1, 10);
  });

  it("ceiling 주입 시 가변 천장 적용(sweep 경로)", () => {
    expect(themeBoost(1, 2, 0.3)).toBeCloseTo(0.15, 10);
    expect(themeBoost(2, 2, 0.3)).toBeCloseTo(0.3, 10);
  });
});
