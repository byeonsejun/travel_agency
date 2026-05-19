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
});
