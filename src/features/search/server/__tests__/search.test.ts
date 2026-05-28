/**
 * search.test.ts — searchProducts Redis 캐시 오케스트레이션 (M-CACHE).
 *
 * 검증 축:
 *  1. Cache HIT — Redis에 값 있으면 파이프라인(route/embed/vector) 미실행
 *  2. Cache MISS — 파이프라인 실행 후 결과를 3600s TTL로 저장
 *  3. graceful — Redis 장애(get=null·set no-op)여도 결과 정상 반환(무중단)
 *
 * 경계(cache·router·embedding·vector)는 전부 모킹 — 오케스트레이션
 * 행위(조회→단축 / 미스→실행→저장 / 폴백)만 검증한다.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  routeQuery: vi.fn(),
  getEmbeddingProvider: vi.fn(),
  searchProductsByVector: vi.fn(),
}));

vi.mock("@/shared/lib/cache", () => ({
  cacheGet: mocks.cacheGet,
  cacheSet: mocks.cacheSet,
}));
vi.mock("@/shared/lib/embedding", () => ({
  getEmbeddingProvider: mocks.getEmbeddingProvider,
}));
vi.mock("@/entities/product", () => ({
  searchProductsByVector: mocks.searchProductsByVector,
}));
vi.mock("../router", () => ({ routeQuery: mocks.routeQuery }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "127.0.0.1" }),
}));
vi.mock("@/features/auth/server/auth", () => ({
  auth: async () => null,
}));
vi.mock("@/shared/lib/rate-limit", async (orig) => {
  const real = await orig<typeof import("@/shared/lib/rate-limit")>();
  return {
    ...real,
    withRateLimitAction: <Args extends unknown[], R>(
      _opts: unknown,
      handler: (...args: Args) => Promise<R>,
    ) => handler,
  };
});

import { searchProducts } from "../search";

const ROUTED = {
  priceMax: undefined,
  durationNights: undefined,
  themeTags: ["휴양"],
  geoTerms: ["발리"],
  cleanedQuery: "동남아 휴양",
};
const CARDS = [{ id: "p1", title: "발리", score: 0.9 }];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.routeQuery.mockResolvedValue(ROUTED);
  mocks.getEmbeddingProvider.mockReturnValue({
    modelVersion: "openai:text-embedding-3-small:1536",
    embed: vi.fn().mockResolvedValue([0.1, 0.2]),
  });
  mocks.searchProductsByVector.mockResolvedValue(CARDS);
});

describe("searchProducts — Cache HIT", () => {
  it("Redis에 값이 있으면 파이프라인을 타지 않고 캐시 반환", async () => {
    mocks.cacheGet.mockResolvedValueOnce(CARDS);

    const r = await searchProducts("동남아 휴양");

    expect(r).toEqual(CARDS);
    expect(mocks.routeQuery).not.toHaveBeenCalled();
    expect(mocks.searchProductsByVector).not.toHaveBeenCalled();
    expect(mocks.cacheSet).not.toHaveBeenCalled();
  });
});

describe("searchProducts — Cache MISS", () => {
  it("파이프라인 실행 후 결과를 3600s TTL로 저장", async () => {
    mocks.cacheGet.mockResolvedValueOnce(null);

    const r = await searchProducts("  동남아 휴양  ");

    expect(r).toEqual(CARDS);
    expect(mocks.routeQuery).toHaveBeenCalledWith("동남아 휴양");
    expect(mocks.searchProductsByVector).toHaveBeenCalledOnce();
    // 동일 키로 조회·저장, TTL 3600초
    const getKey = mocks.cacheGet.mock.calls[0][0];
    const [setKey, setVal, setTtl] = mocks.cacheSet.mock.calls[0];
    expect(setKey).toBe(getKey);
    expect(setVal).toEqual(CARDS);
    expect(setTtl).toBe(3600);
  });
});

describe("searchProducts — graceful (Redis 장애)", () => {
  it("get=null·set no-op이어도 결과를 정상 반환(무중단)", async () => {
    mocks.cacheGet.mockResolvedValueOnce(null); // wrapper가 장애를 null로 흡수
    mocks.cacheSet.mockResolvedValueOnce(undefined);

    const r = await searchProducts("동남아 휴양");

    expect(r).toEqual(CARDS);
    expect(mocks.searchProductsByVector).toHaveBeenCalledOnce();
  });
});
