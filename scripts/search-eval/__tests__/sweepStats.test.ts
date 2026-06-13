/**
 * sweepStats.test.ts — catalog 평가 핵심(sweepStats)이 순수·오프라인임을 증명.
 *
 * 합성 코퍼스/쿼리(인메모리)로 286 격자 전수 평가가 DB·LLM·네트워크 없이
 * 동작함을 보인다 = run-eval --catalog의 회귀 가드(LLM 미호출 계약).
 */
import { describe, it, expect } from "vitest";
import { sweepStats, meanNdcg, type LabeledCase } from "../run-eval";
import type { CorpusProduct, GoldenQuery } from "../types";

const corpus: CorpusProduct[] = [
  {
    title: "A",
    destination: "오사카, 일본",
    summary: "도심 자유",
    tags: ["#도심"],
    basePriceAdult: 1000000,
    durationNights: 3,
    embedding: [1, 0],
  },
  {
    title: "B",
    destination: "발리, 인도네시아",
    summary: "휴양",
    tags: ["#휴양"],
    basePriceAdult: 900000,
    durationNights: 4,
    embedding: [0, 1],
  },
];

const queries: GoldenQuery[] = [
  {
    query: "q1",
    cleanedQuery: "도심",
    themeTags: ["#도심"],
    geoTerms: ["오사카"],
    embedding: [1, 0],
  },
];
const byText = new Map(queries.map((q) => [q.query, q]));
const cases: LabeledCase[] = [{ query: "q1", labels: { A: 3, B: 1 } }];

describe("sweepStats (순수·오프라인)", () => {
  it("286 격자를 평가하고 변별력 통계를 반환", () => {
    const s = sweepStats(corpus, byText, cases);
    expect(s.scored).toHaveLength(286);
    expect(s.rank).toBeGreaterThanOrEqual(1);
    expect(s.rank).toBeLessThanOrEqual(286);
    expect(s.max).toBeGreaterThanOrEqual(s.min);
    expect(s.spread).toBeCloseTo(s.max - s.min, 9);
    expect(Number.isFinite(s.baseline)).toBe(true);
  });

  it("scored는 nDCG@5 내림차순 정렬", () => {
    const s = sweepStats(corpus, byText, cases);
    for (let i = 1; i < s.scored.length; i++) {
      expect(s.scored[i - 1].m5).toBeGreaterThanOrEqual(s.scored[i].m5);
    }
  });

  it("meanNdcg는 [0,1] 범위", () => {
    const m = meanNdcg(corpus, byText, cases, { vector: 0.5, keyword: 0.2, geo: 0.2, theme: 0.1 }, 5);
    expect(m).toBeGreaterThanOrEqual(0);
    expect(m).toBeLessThanOrEqual(1);
  });
});
