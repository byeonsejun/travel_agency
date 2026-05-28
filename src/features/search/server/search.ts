/**
 * search.ts — 검색 오케스트레이션 (M-AI-SEARCH, M-CACHE) + Phase 3 B2-C rate limit.
 *
 * searchProducts 자체는 Server Action / RSC fetcher 양쪽에서 호출. wrapper 가
 * next/headers 로 IP 회수 + auth() 로 userId 회수 → ai-search tier(20/min per id).
 *
 * 비용 방어: AI API 호출당 ~$0.001~0.01 (Anthropic + OpenAI embedding). 익명/봇이
 * 분당 1k 호출 → 분당 $1~10 — 한도 20/min 으로 즉시 컷.
 */

import { cacheGet, cacheSet } from "@/shared/lib/cache";
import { getEmbeddingProvider } from "@/shared/lib/embedding";
import { searchProductsByVector } from "@/entities/product";
import type { SearchResultCard } from "@/entities/product";
import { auth } from "@/features/auth/server/auth";
import { withRateLimitAction } from "@/shared/lib/rate-limit";
import { routeQuery } from "./router";

const CACHE_TTL_SECONDS = 60 * 60;
const CACHE_KEY_PREFIX = "search:v1:";

async function searchProductsImpl(q: string): Promise<SearchResultCard[]> {
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
    routed.geoTerms ?? [],
  );

  await cacheSet(cacheKey, results, CACHE_TTL_SECONDS);
  return results;
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
