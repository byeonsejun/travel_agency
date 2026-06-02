import { describe, it, expect } from "vitest";
import {
  normalizeRatingDistribution,
  type RatingGroupRow,
} from "../ratingDistribution";

describe("normalizeRatingDistribution", () => {
  it("groupBy 결과를 1~5 전 키로 정규화 (누락은 0)", () => {
    const rows: RatingGroupRow[] = [
      { rating: 5, _count: { _all: 3 } },
      { rating: 3, _count: { _all: 1 } },
    ];
    expect(normalizeRatingDistribution(rows)).toEqual({
      1: 0,
      2: 0,
      3: 1,
      4: 0,
      5: 3,
    });
  });

  it("빈 입력은 전부 0", () => {
    expect(normalizeRatingDistribution([])).toEqual({
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    });
  });
});
