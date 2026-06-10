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

  it("actual 랭킹의 꼬리가 0 라벨이면 무시 — 상위 k가 이상정렬이면 1.0", () => {
    // 전체 이상정렬 = [3,2,1,0,0], top3 = [3,2,1] = actual top3 → nDCG@3 = 1.0
    expect(ndcgAtK([3, 2, 1, 0, 0], 3)).toBeCloseTo(1.0, 10);
  });

  it("고관련 항목이 k 밖에 묻히면 nDCG@k가 떨어진다(표준 IDCG)", () => {
    // 라벨 3이 꼬리에 묻힘 → 이상정렬 [3,3,2,1,0]의 top3=[3,3,2]가 IDCG.
    // DCG@3([3,2,1]) / IDCG@3([3,3,2]) ≈ 0.7272 → 묻힌 우수 결과를 페널티.
    expect(ndcgAtK([3, 2, 1, 0, 3], 3)).toBeCloseTo(0.7272, 3);
    expect(ndcgAtK([3, 2, 1, 0, 3], 3)).toBeLessThan(1.0);
  });
});
