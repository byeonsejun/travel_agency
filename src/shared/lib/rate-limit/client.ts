/**
 * client.ts — `@upstash/ratelimit` lazy singleton (spec §7, §8.2).
 *
 * Redis client는 M-CACHE의 `shared/lib/cache/redis.ts` 패턴 그대로:
 *   - env 미설정 시 null 강등 (fail-open — spec §7)
 *   - 인스턴스 1회 생성 후 재사용 (콜드스타트 비용 1회)
 *   - 테스트는 __resetRateLimitClientForTest()로 재평가
 *
 * cache 키와 prefix 충돌 회피: `ratelimit:v1:<tier>` (cache는 `search:v1:` 등).
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "@/shared/lib/env";
import { RATE_LIMIT_TIERS, type RateLimitTier } from "./tiers";

let redis: Redis | null | undefined;
const limiters = new Map<RateLimitTier, Ratelimit | null>();

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    redis = null;
    return null;
  }
  redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
    automaticDeserialization: false,
  });
  return redis;
}

export function getRatelimiter(tier: RateLimitTier): Ratelimit | null {
  const cached = limiters.get(tier);
  if (cached !== undefined) return cached;
  const r = getRedis();
  if (!r) {
    limiters.set(tier, null);
    return null;
  }
  const cfg = RATE_LIMIT_TIERS[tier];
  const inst = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(cfg.limit, cfg.window),
    prefix: `ratelimit:v1:${tier}`,
    analytics: true,
  });
  limiters.set(tier, inst);
  return inst;
}

/** 테스트 전용 — 설정 변경 재평가용 싱글톤 리셋. */
export function __resetRateLimitClientForTest(): void {
  redis = undefined;
  limiters.clear();
}
