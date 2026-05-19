/**
 * search.ts — 검색 오케스트레이션 유즈케이스 (M-AI-SEARCH spec §5 D6, M-CACHE).
 *
 * searchProducts(q):
 *   1. Redis 조회 — 동일 q 캐시 hit 시 파이프라인 전체 단축
 *   2. routeQuery(q) — 자연어 → 구조화 필터 (LLM or 규칙 기반)
 *   3. embed(cleanedQuery) — 정제 쿼리를 벡터로 변환
 *   4. searchProductsByVector(...) — 하이브리드 코사인 검색
 *   5. 결과를 Redis에 1h(3600s) TTL로 저장
 *
 * 분산 캐시(M-CACHE): 서버리스 인스턴스 고립·메모리 휘발을 막기 위해
 * 인메모리 Map → Upstash Redis로 교체. 캐시 레이어는 graceful —
 * 미설정/장애 시 cacheGet=null·cacheSet no-op으로 강등되어, 항상 원본
 * 파이프라인으로 자연 폴백된다(검색 무중단). D6 비용 방어는 유지.
 */

import { cacheGet, cacheSet } from "@/shared/lib/cache";
import { getEmbeddingProvider } from "@/shared/lib/embedding";
import { searchProductsByVector } from "@/entities/product";
import type { SearchResultCard } from "@/entities/product";
import { routeQuery } from "./router";

const CACHE_TTL_SECONDS = 60 * 60; // 1h (D6)
const CACHE_KEY_PREFIX = "search:v1:";

export async function searchProducts(q: string): Promise<SearchResultCard[]> {
  const normalized = q.trim();
  const cacheKey = `${CACHE_KEY_PREFIX}${normalized}`;

  const cached = await cacheGet<SearchResultCard[]>(cacheKey);
  if (cached !== null) return cached;

  const routed = await routeQuery(normalized);
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

  await cacheSet(cacheKey, results, CACHE_TTL_SECONDS);
  return results;
}

/** 테스트/QA 전용 — Redis 클라이언트 싱글톤 초기화. */
export { __resetRedisClientForTest as __resetSearchCacheForTest } from "@/shared/lib/cache";
