// scripts/search-eval/__tests__/rerankEval.test.ts
import { describe, it, expect } from "vitest";
import { rerankRelevances } from "../run-eval";
import { ndcgAtK } from "../ndcg";

// 하이브리드 순서: [B(label0), A(label3)] — 좋은 답이 2위(약한 랭킹).
const hybrid = [
  { title: "A", score: 0.5 },
  { title: "B", score: 0.9 },
];
const labels: Record<string, number> = { A: 3, B: 0 };

describe("rerankRelevances", () => {
  it("재정렬이 라벨 높은 항목을 1위로 올리면 relevance 순서가 개선된다", () => {
    // 하이브리드 점수 순서는 B,A → relevances [0,3]
    // 재정렬 스냅샷이 A를 1위로 → relevances [3,0]
    const reranked = rerankRelevances(hybrid, ["A", "B"], labels);
    expect(reranked).toEqual([3, 0]);
    expect(ndcgAtK(reranked, 5)).toBeGreaterThan(
      ndcgAtK([0, 3], 5), // 하이브리드 원순서
    );
  });

  it("환각/누락 title은 applyRerankOrder가 흡수(길이 보존)", () => {
    const r = rerankRelevances(hybrid, ["A", "ZZZ"], labels);
    expect(r).toHaveLength(2);
    expect(r[0]).toBe(3); // A 먼저, B는 누락분 append
  });
});
