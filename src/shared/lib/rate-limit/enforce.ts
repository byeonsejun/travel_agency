import { env } from "@/shared/lib/env";
import { logger } from "@/shared/lib/observability";
import { getRatelimiter } from "./client";
import { hashIdForLog } from "./identifier";
import { RATE_LIMIT_TIERS, type RateLimitTier } from "./tiers";

export interface RateLimitVerdict {
  readonly ok: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly reset: number;
  readonly retryAfterSeconds: number;
  readonly shadowed: boolean;
  readonly bypassed: boolean;
}

function passVerdict(tier: RateLimitTier, bypassed: boolean): RateLimitVerdict {
  return {
    ok: true,
    limit: RATE_LIMIT_TIERS[tier].limit,
    remaining: RATE_LIMIT_TIERS[tier].limit,
    reset: 0,
    retryAfterSeconds: 0,
    shadowed: false,
    bypassed,
  };
}

export async function enforce(
  tier: RateLimitTier,
  identifier: string,
): Promise<RateLimitVerdict> {
  const limiter = getRatelimiter(tier);
  if (!limiter) {
    return passVerdict(tier, true);
  }

  try {
    const result = await limiter.limit(identifier);
    const resetSec = Math.ceil(result.reset / 1000);
    const nowSec = Math.floor(Date.now() / 1000);
    const retryAfter = Math.max(0, resetSec - nowSec);

    if (!result.success) {
      const shadowed = env.RATE_LIMIT_MODE === "shadow";
      logger.info("rate_limit.exceeded", {
        tier,
        identifier: hashIdForLog(identifier),
        limit: result.limit,
        remaining: result.remaining,
        reset: resetSec,
        shadowed,
      });
      return {
        ok: shadowed,
        limit: result.limit,
        remaining: result.remaining,
        reset: resetSec,
        retryAfterSeconds: retryAfter,
        shadowed,
        bypassed: false,
      };
    }

    return {
      ok: true,
      limit: result.limit,
      remaining: result.remaining,
      reset: resetSec,
      retryAfterSeconds: 0,
      shadowed: false,
      bypassed: false,
    };
  } catch (e) {
    logger.warn("rate_limit.degraded", {
      tier,
      identifier: hashIdForLog(identifier),
      error: e instanceof Error ? e.message : String(e),
    });
    return passVerdict(tier, true);
  }
}
