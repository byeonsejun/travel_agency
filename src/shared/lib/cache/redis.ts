/**
 * redis.ts — Upstash Redis 분산 캐시 graceful wrapper (M-CACHE).
 *
 * 서버리스(Vercel 등)에서 인스턴스별 메모리 캐시는 휘발·고립된다.
 * 분산 Redis로 교체하되, **캐시는 정합성 영향이 가장 큰 레이어**이므로
 * 어떤 실패도 요청을 죽이지 않는다(로드맵 M-CACHE 원칙):
 *
 *  - 미설정(url/token 부재): no-op 강등 — get=null(=miss), set 무동작.
 *    dev에서 Upstash 없이도 무중단(매 요청 원본 파이프라인). NODE_ENV
 *    분기 불필요 — "미설정=강등"이 [[feedback-dev-external-io]] 정신을
 *    그대로 만족(우발적 외부 의존 0, 명시 설정 시에만 활성).
 *  - 네트워크/Redis 예외: try-catch로 흡수 → get은 miss(null), set은
 *    조용히 통과. 호출부는 항상 원본 쿼리로 자연 폴백된다.
 *
 * 직렬화: automaticDeserialization=false + 명시 JSON.stringify/parse로
 * SDK 버전·타입(Date 등) 변동에 흔들리지 않게 결정론적으로 처리한다.
 */

import { Redis } from "@upstash/redis";
import { env } from "@/shared/lib/env";
import { logger } from "@/shared/lib/logger";

// 지연 싱글톤. undefined=미해결, null=미설정(no-op), Redis=설정됨.
let client: Redis | null | undefined;

function getClient(): Redis | null {
  if (client !== undefined) return client;
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    client = null;
    return null;
  }
  client = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
    automaticDeserialization: false,
  });
  return client;
}

/** 캐시 조회. 미설정·예외·miss 모두 null(호출부는 원본으로 폴백). */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const raw = await c.get<string | null>(key);
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch (e) {
    logger.warn("cache.get failed — degrading to source", {
      key,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** 캐시 저장(TTL 초). 미설정·예외 시 조용히 통과(요청 흐름 불변). */
export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number
): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.set(key, JSON.stringify(value), { ex: ttlSeconds });
  } catch (e) {
    logger.warn("cache.set failed — skipping write", {
      key,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** 테스트 전용 — 클라이언트 싱글톤 초기화(설정 변경 재평가). */
export function __resetRedisClientForTest(): void {
  client = undefined;
}
