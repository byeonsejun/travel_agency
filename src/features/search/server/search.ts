/**
 * search.ts — 검색 오케스트레이션 (M-AI-SEARCH, M-CACHE) + Milestone 4.
 *
 * 단일 라운드트립 보존: routeQuery 1회 → embed → 하이브리드 → (조건부) rerank
 * → chips. 반환은 {results, chips}. 캐시는 재정렬 순서·칩까지 저장(키 v2).
 */
import { cacheGet, cacheSet } from "@/shared/lib/cache";
import { getEmbeddingProvider } from "@/shared/lib/embedding";
import { searchProductsByVector } from "@/entities/product";
import type { SearchResultCard } from "@/entities/product";
import { auth } from "@/features/auth/server";
import { withRateLimitAction } from "@/shared/lib/rate-limit";
import { routeQuery } from "./router";
import { shouldRerank, rerankCandidates } from "./rerank";
import { buildClarifyingChips, type ClarifyingChip } from "../model/clarifyingChips";

const CACHE_TTL_SECONDS = 60 * 60;
// v2: 반환 shape이 SearchResultCard[] → {results,chips}로 바뀌어 키를 bump.
const CACHE_KEY_PREFIX = "search:v2:";

export interface SearchResponse {
  results: SearchResultCard[];
  chips: ClarifyingChip[];
}

async function searchProductsImpl(q: string): Promise<SearchResponse> {
  const normalized = q.trim();
  const cacheKey = `${CACHE_KEY_PREFIX}${normalized}`;

  const cached = await cacheGet<SearchResponse>(cacheKey);
  if (cached !== null) return cached;

  const routed = await routeQuery(normalized);
  const provider = getEmbeddingProvider();
  const qVec = await provider.embed(routed.cleanedQuery);

  const filters = {
    priceMax: routed.priceMax,
    durationNights: routed.durationNights,
    themeTags: routed.themeTags,
  };

  const hybrid = await searchProductsByVector(
    qVec,
    filters,
    provider.modelVersion,
    routed.cleanedQuery,
    routed.geoTerms ?? [],
  );

  // 조건부 재정렬: 순수 추상 의도(geo·theme 비어있음)에만. 비-prod identity.
  const results = shouldRerank(routed)
    ? await rerankCandidates(normalized, hybrid)
    : hybrid;
  const chips = buildClarifyingChips(routed, normalized);

  const response: SearchResponse = { results, chips };
  await cacheSet(cacheKey, response, CACHE_TTL_SECONDS);
  return response;
}

/**
 * Phase 3 B2-C: ai-search tier — 20 req / 1min per (user | ip).
 * 차단 시 `/search?error=RATE_LIMITED&retryAfter=N` 로 redirect → UI 가 안내.
 */
export const searchProducts = withRateLimitAction(
  {
    tier: "ai-search",
    resolveUserId: async () => (await auth())?.user?.id ?? null,
    redirectOnBlock: (retry) =>
      `/search?error=RATE_LIMITED&retryAfter=${retry}`,
  },
  searchProductsImpl,
);

export { __resetRedisClientForTest as __resetSearchCacheForTest } from "@/shared/lib/cache";
