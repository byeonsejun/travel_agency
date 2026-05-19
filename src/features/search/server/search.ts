/**
 * search.ts — 검색 오케스트레이션 유즈케이스 (M-AI-SEARCH spec §5, D6).
 *
 * searchProducts(q):
 *   1. routeQuery(q) — 자연어 → 구조화 필터 (LLM or 규칙 기반)
 *   2. embed(cleanedQuery) — 정제 쿼리를 벡터로 변환
 *   3. searchProductsByVector(vec, filters, modelVersion, cleanedQuery) — 코사인 검색
 *
 * D6 1h 캐시: 동일 q 문자열은 1시간 동안 TTL 캐시에서 반환 → LLM·임베딩·DB 비용 방어.
 * 캐시 미스 시에만 파이프라인 전체 실행.
 */

import { createTtlCache } from "@/shared/lib/cache";
import { getEmbeddingProvider } from "@/shared/lib/embedding";
import { searchProductsByVector } from "@/entities/product";
import type { SearchResultCard } from "@/entities/product";
import { routeQuery } from "./router";

const ONE_HOUR_MS = 60 * 60 * 1000;

// 모듈 싱글톤 캐시 — Next.js 서버 프로세스 수명과 동일.
const searchCache = createTtlCache<SearchResultCard[]>({
  ttlMs: ONE_HOUR_MS,
  maxEntries: 500,
});

export async function searchProducts(q: string): Promise<SearchResultCard[]> {
  const cacheKey = q.trim();

  const cached = searchCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const routed = await routeQuery(cacheKey);
  const provider = getEmbeddingProvider();
  const qVec = await provider.embed(routed.cleanedQuery);

  const filters = {
    priceMax: routed.priceMax,
    durationNights: routed.durationNights,
    themeTags: routed.themeTags,
  };

  const results = await searchProductsByVector(
    qVec,
    filters,
    provider.modelVersion,
    routed.cleanedQuery,
    routed.geoTerms ?? []
  );

  searchCache.set(cacheKey, results);
  return results;
}

/** 테스트 전용 — 캐시 초기화. */
export function __resetSearchCacheForTest(): void {
  searchCache.clear();
}
