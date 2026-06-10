/**
 * searchByVector.test.ts — 코사인 벡터 검색 + 키워드 폴백 (M-AI-SEARCH Task 6)
 *
 * 검증 축 (spec §5 / D2·D3·D4·D5·R6):
 *  1. pgvector 가용 → 코사인 정렬 결과를 SearchResultCard[](score)로 매핑
 *  2. modelVersion 게이트·동적 필터가 바인딩 파라미터로 전달(인젝션 안전)
 *  3. pgvector 불가 → ILIKE 키워드 폴백 (500 금지, 항상 배열 반환)
 *  4. 벡터 쿼리 예외 → 키워드 폴백으로 흡수 (절대 throw 안 함)
 *
 * db는 경계에서 모킹 — 순수 쿼리 조립/폴백 분기 행위를 검증한다.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDb = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  product: { findMany: vi.fn() },
}));

vi.mock("@/shared/lib/db", () => ({ db: mockDb }));

import {
  searchProductsByVector,
  __resetPgvectorCacheForTest,
} from "../searchByVector";
import { themeBoost } from "../../model/searchWeights";

const MODEL = "dev-deterministic:v1:1536";
const qVec = Array.from({ length: 4 }, (_, i) => i * 0.1);

function fakeProduct(id: string) {
  return {
    id,
    title: `상품 ${id}`,
    destination: "오사카, 일본",
    durationNights: 3,
    durationDays: 4,
    heroImageUrl: null,
    basePriceAdult: 100000,
    aiSummary: null,
    tags: [{ tag: "#온천" }],
    departures: [{ priceAdult: 90000 }],
  };
}

beforeEach(() => {
  __resetPgvectorCacheForTest();
  mockDb.$queryRaw.mockReset();
  mockDb.product.findMany.mockReset();
});

describe("searchProductsByVector — 벡터 경로", () => {
  it("pgvector 가용 시 score 포함 카드를 순서대로 반환한다", async () => {
    mockDb.$queryRaw
      .mockResolvedValueOnce([{ one: 1 }]) // 가용성 체크
      .mockResolvedValueOnce([
        { id: "p1", score: 0.92 },
        { id: "p2", score: 0.81 },
      ]); // 코사인 검색
    mockDb.product.findMany.mockResolvedValueOnce([
      fakeProduct("p2"),
      fakeProduct("p1"),
    ]);

    const res = await searchProductsByVector(qVec, {}, MODEL, "온천");

    expect(res.map((r) => r.id)).toEqual(["p1", "p2"]); // 검색 순서 보존
    expect(res[0].score).toBe(0.92);
    expect(res[0].lowestPrice).toBe(90000);
  });

  it("modelVersion·필터가 바인딩 파라미터로 전달된다(인젝션 안전)", async () => {
    mockDb.$queryRaw
      .mockResolvedValueOnce([{ one: 1 }])
      .mockResolvedValueOnce([{ id: "p1", score: 0.5 }]);
    mockDb.product.findMany.mockResolvedValueOnce([fakeProduct("p1")]);

    await searchProductsByVector(
      qVec,
      { priceMax: 200000, themeTags: ["온천"] },
      MODEL,
      "가족 온천"
    );

    const searchSql = mockDb.$queryRaw.mock.calls[1][0];
    expect(searchSql.values).toContain(MODEL);
    expect(searchSql.values).toContain(200000);
    // 태그는 '#' 정규화되어 배열 파라미터로 전달
    expect(
      searchSql.values.some(
        (v: unknown) => Array.isArray(v) && v.includes("#온천")
      )
    ).toBe(true);
  });

  it("themeTags는 WHERE 하드배제가 아닌 SELECT 점수 가산항(soft boost)", async () => {
    mockDb.$queryRaw
      .mockResolvedValueOnce([{ one: 1 }])
      .mockResolvedValueOnce([{ id: "p1", score: 0.6 }]);
    mockDb.product.findMany.mockResolvedValueOnce([fakeProduct("p1")]);

    await searchProductsByVector(
      qVec,
      { themeTags: ["휴양"] },
      MODEL,
      "동남아 휴양",
      ["발리", "다낭", "세부"]
    );

    const text = mockDb.$queryRaw.mock.calls[1][0].sql as string;
    const mainWhereIdx = text.indexOf("WHERE p.status");
    const orderIdx = text.indexOf("ORDER BY");
    const whereClause = text.slice(mainWhereIdx, orderIdx);

    // 메인 WHERE에는 ProductTag 배제가 없어야 한다(soft 전환의 핵심)
    expect(whereClause).not.toContain("ProductTag");
    // ProductTag 매칭은 SELECT 점수식(가산항)에 존재해야 한다
    const selectClause = text.slice(0, mainWhereIdx);
    expect(selectClause).toContain("ProductTag");
    // graduated: 이진 CASE가 아니라 count(*) 비율 산술이어야 한다
    expect(selectClause).toContain("count(*)");
    expect(selectClause).not.toContain("THEN 0.1");
  });

  it("graduated: 요청 태그 개수(분모)가 바인딩 파라미터로 전달된다", async () => {
    mockDb.$queryRaw
      .mockResolvedValueOnce([{ one: 1 }])
      .mockResolvedValueOnce([{ id: "p1", score: 0.6 }]);
    mockDb.product.findMany.mockResolvedValueOnce([fakeProduct("p1")]);

    await searchProductsByVector(
      qVec,
      { themeTags: ["휴양", "미식", "가성비"] },
      MODEL,
      "휴양 미식 가성비"
    );

    const searchSql = mockDb.$queryRaw.mock.calls[1][0];
    // 분모 = 정규화된 요청 태그 개수(3)가 바인딩 값으로 존재
    expect(searchSql.values).toContain(3);
    // 태그 배열도 '#' 정규화되어 바인딩
    expect(
      searchSql.values.some(
        (v: unknown) =>
          Array.isArray(v) && v.includes("#휴양") && v.includes("#미식")
      )
    ).toBe(true);
  });
});

describe("searchProductsByVector — geo 하이브리드 (방안 A)", () => {
  it("geoTerms가 ILIKE ANY 바인딩 배열로 전달된다", async () => {
    mockDb.$queryRaw
      .mockResolvedValueOnce([{ one: 1 }])
      .mockResolvedValueOnce([{ id: "p1", score: 0.8 }]);
    mockDb.product.findMany.mockResolvedValueOnce([fakeProduct("p1")]);

    await searchProductsByVector(qVec, {}, MODEL, "동남아", [
      "태국",
      "발리",
    ]);

    const searchSql = mockDb.$queryRaw.mock.calls[1][0];
    // 패턴 배열이 바인딩 파라미터로(인젝션 안전) 전달됨
    expect(
      searchSql.values.some(
        (v: unknown) =>
          Array.isArray(v) && v.includes("%태국%") && v.includes("%발리%")
      )
    ).toBe(true);
  });

  it("geoTerms 비었으면 geo 절을 추가하지 않는다 (graceful)", async () => {
    mockDb.$queryRaw
      .mockResolvedValueOnce([{ one: 1 }])
      .mockResolvedValueOnce([{ id: "p1", score: 0.5 }]);
    mockDb.product.findMany.mockResolvedValueOnce([fakeProduct("p1")]);

    await searchProductsByVector(qVec, {}, MODEL, "온천", []);

    const sqlText = mockDb.$queryRaw.mock.calls[1][0].sql as string;
    expect(sqlText).not.toContain("ILIKE ANY");
  });
});

describe("searchProductsByVector — graceful degradation (D5)", () => {
  it("pgvector 불가 시 키워드 폴백으로 결과를 반환한다 (throw 없음)", async () => {
    mockDb.$queryRaw
      .mockResolvedValueOnce([]) // 가용성: 확장 없음
      .mockResolvedValueOnce([{ id: "p9", score: 0 }]); // ILIKE 폴백
    mockDb.product.findMany.mockResolvedValueOnce([fakeProduct("p9")]);

    const res = await searchProductsByVector(qVec, {}, MODEL, "온천");
    expect(res.map((r) => r.id)).toEqual(["p9"]);
  });

  it("벡터 쿼리 예외도 키워드 폴백으로 흡수한다 (500 금지)", async () => {
    mockDb.$queryRaw
      .mockResolvedValueOnce([{ one: 1 }]) // 가용성 OK
      .mockRejectedValueOnce(new Error("vector op failed")) // 코사인 쿼리 실패
      .mockResolvedValueOnce([{ id: "p3", score: 0 }]); // 폴백 ILIKE
    mockDb.product.findMany.mockResolvedValueOnce([fakeProduct("p3")]);

    const res = await searchProductsByVector(qVec, {}, MODEL, "온천");
    expect(res.map((r) => r.id)).toEqual(["p3"]);
  });

  it("폴백마저 실패하면 빈 배열을 반환한다 (절대 throw 안 함)", async () => {
    mockDb.$queryRaw
      .mockResolvedValueOnce([{ one: 1 }])
      .mockRejectedValueOnce(new Error("vector fail"))
      .mockRejectedValueOnce(new Error("keyword fail"));

    const res = await searchProductsByVector(qVec, {}, MODEL, "온천");
    expect(res).toEqual([]);
  });

  it("폴백 경로는 graduated가 아닌 binary theme-first 정렬을 유지한다", async () => {
    mockDb.$queryRaw
      .mockResolvedValueOnce([]) // pgvector 미가용 → 폴백 진입
      .mockResolvedValueOnce([{ id: "p1", score: 0 }]); // 폴백 ILIKE 쿼리
    mockDb.product.findMany.mockResolvedValueOnce([fakeProduct("p1")]);

    await searchProductsByVector(
      qVec,
      { themeTags: ["휴양"] },
      MODEL,
      "동남아 휴양"
    );

    const fallbackSql = mockDb.$queryRaw.mock.calls[1][0].sql as string;
    // 폴백은 binary theme-first 정렬(CASE WHEN EXISTS) 유지 — graduated count(*) 비율 산술 부재.
    // 회귀 가드: 미래에 폴백을 graduated로 바꾸면 이 테스트가 깨져 의도적 정책 변경임을 강제한다.
    expect(fallbackSql).toContain("ORDER BY");
    expect(fallbackSql).not.toContain("count(*)");
  });
});

describe("themeBoost — graduated 커버리지 비율 (순수 함수 invariant)", () => {
  it("요청 태그를 모두 매칭하면 천장 0.1을 반환한다", () => {
    expect(themeBoost(3, 3)).toBeCloseTo(0.1, 10);
    expect(themeBoost(1, 1)).toBeCloseTo(0.1, 10);
  });

  it("매칭이 0이면 0을 반환한다", () => {
    expect(themeBoost(0, 3)).toBe(0);
  });

  it("요청 태그가 0이면 0을 반환한다(division-by-zero 가드)", () => {
    expect(themeBoost(0, 0)).toBe(0);
    expect(themeBoost(2, 0)).toBe(0);
  });

  it("matchCount가 늘면 score는 비감소(단조 증가)", () => {
    expect(themeBoost(2, 3)).toBeGreaterThan(themeBoost(1, 3));
    expect(themeBoost(3, 3)).toBeGreaterThan(themeBoost(2, 3));
  });

  it("부분 매칭은 요청 대비 비율값이다", () => {
    expect(themeBoost(1, 3)).toBeCloseTo(0.1 / 3, 10); // ≈ 0.0333
    expect(themeBoost(2, 4)).toBeCloseTo(0.05, 10);
  });

  it("score는 항상 [0, 0.1] 범위 안이다", () => {
    for (let req = 1; req <= 5; req++) {
      for (let m = 0; m <= req; m++) {
        const s = themeBoost(m, req);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(0.1);
      }
    }
  });
});
