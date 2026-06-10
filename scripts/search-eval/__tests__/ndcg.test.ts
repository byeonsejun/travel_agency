import { describe, it, expect } from "vitest";
import { dcgAtK, ndcgAtK } from "../ndcg";

describe("dcgAtK", () => {
  it("랭크1=log2(2)=1로 나눠 첫 항은 (2^rel - 1)", () => {
    // rel=[3] → (2^3-1)/log2(2) = 7/1 = 7
    expect(dcgAtK([3], 1)).toBeCloseTo(7, 10);
  });

  it("k가 길이보다 크면 길이까지만 합산", () => {
    expect(dcgAtK([1, 1], 5)).toBeCloseTo(1 / Math.log2(2) + 1 / Math.log2(3), 10);
  });
});

describe("ndcgAtK", () => {
  it("이상 정렬은 1.0", () => {
    expect(ndcgAtK([3, 2, 1, 0], 4)).toBeCloseTo(1.0, 10);
  });

  it("역순 정렬은 1.0 미만", () => {
    expect(ndcgAtK([0, 1, 2, 3], 4)).toBeLessThan(1.0);
  });

  it("전부 무관(라벨 0)이면 IDCG 0 → 0 반환", () => {
    expect(ndcgAtK([0, 0, 0], 3)).toBe(0);
  });

  it("빈 결과는 0", () => {
    expect(ndcgAtK([], 5)).toBe(0);
  });

  it("@k는 상위 k만 평가(꼬리 무관항 무시)", () => {
    // 상위 3개가 이상정렬이면 뒤가 어떻든 nDCG@3 = 1.0
    expect(ndcgAtK([3, 2, 1, 0, 3], 3)).toBeCloseTo(1.0, 10);
  });
});
