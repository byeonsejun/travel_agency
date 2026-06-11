import { describe, it, expect } from "vitest";
import { cosineSim, scoreCandidate, rankCandidates } from "../scoreReplica";
import type { CorpusProduct, GoldenQuery } from "../types";
import { SEARCH_WEIGHTS } from "@/entities/product";

describe("cosineSim", () => {
  it("동일 단위벡터는 1.0", () => {
    expect(cosineSim([1, 0], [1, 0])).toBeCloseTo(1.0, 10);
  });
  it("직교 벡터는 0", () => {
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });
  it("정규화 안 된 동방향 벡터도 1.0(노름으로 나눔)", () => {
    expect(cosineSim([2, 0], [5, 0])).toBeCloseTo(1.0, 10);
  });
});

const product: CorpusProduct = {
  title: "테스트 상품",
  destination: "오사카, 일본",
  summary: "가족 온천 여행",
  tags: ["#가족", "#온천"],
  basePriceAdult: 800000,
  durationNights: 3,
  embedding: [1, 0],
};

const query: GoldenQuery = {
  query: "오사카 가족 온천",
  cleanedQuery: "오사카",          // destination에 부분일치 → 키워드 적중
  themeTags: ["#가족", "#온천"],   // 2/2 적중
  geoTerms: ["오사카"],            // destination 적중
  embedding: [1, 0],               // cosine = 1
};

describe("scoreCandidate (drift 핀)", () => {
  it("모든 시그널 만점 + 운영 가중치 → 1.0", () => {
    // cosine1×0.5 + kw0.2 + geo0.2 + theme(2/2×0.1)=0.1 = 1.0
    expect(scoreCandidate(product, query, SEARCH_WEIGHTS)).toBeCloseTo(1.0, 10);
  });

  it("테마 천장은 주입 가중치를 따른다(sweep)", () => {
    const w = { vector: 0.4, keyword: 0.2, geo: 0.2, theme: 0.2 };
    // 0.4 + 0.2 + 0.2 + (2/2×0.2)=0.2 = 1.0
    expect(scoreCandidate(product, query, w)).toBeCloseTo(1.0, 10);
  });

  it("부분 테마 커버리지는 비율 가산", () => {
    const q2: GoldenQuery = { ...query, themeTags: ["#가족", "#설경"] }; // 1/2 적중
    // cosine0.5 + kw0.2 + geo0.2 + (1/2×0.1)=0.05 = 0.95
    expect(scoreCandidate(product, q2, SEARCH_WEIGHTS)).toBeCloseTo(0.95, 10);
  });
});

describe("rankCandidates", () => {
  it("hard filter: priceMax 초과 상품 배제", () => {
    const q3: GoldenQuery = { ...query, priceMax: 500000 };
    expect(rankCandidates([product], q3, SEARCH_WEIGHTS)).toHaveLength(0);
  });

  it("hard filter: durationNights는 max+1까지 허용(±1박)", () => {
    const q4: GoldenQuery = { ...query, durationNights: { min: 2, max: 2 } };
    // 상품 3박 ≤ max(2)+1=3 → 통과
    expect(rankCandidates([product], q4, SEARCH_WEIGHTS)).toHaveLength(1);
  });

  it("점수 내림차순 정렬", () => {
    const low: CorpusProduct = { ...product, title: "무관 상품", destination: "파리, 프랑스", summary: "", tags: [], embedding: [0, 1] };
    const ranked = rankCandidates([low, product], query, SEARCH_WEIGHTS);
    expect(ranked[0].title).toBe("테스트 상품");
  });
});
