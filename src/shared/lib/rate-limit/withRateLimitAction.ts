import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { enforce } from "./enforce";
import { identify } from "./identifier";
import { RATE_LIMIT_TIERS, type IdStrategy, type RateLimitTier } from "./tiers";

export interface WithRateLimitActionOptions {
  tier: RateLimitTier;
  idStrategy?: IdStrategy;
  resolveUserId?: () => Promise<string | null>;
  /** 차단 시 redirect 대상 — 미설정 시 `/?error=RATE_LIMITED&retryAfter=N`. */
  redirectOnBlock?: (retryAfterSeconds: number) => string;
}

export function withRateLimitAction<Args extends unknown[], R>(
  opts: WithRateLimitActionOptions,
  handler: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  const strategy = opts.idStrategy ?? RATE_LIMIT_TIERS[opts.tier].idStrategy;

  return async (...args) => {
    const hdrs = await headers();
    const req = new Request("http://internal/", { headers: hdrs as never });
    const userId =
      strategy === "ipOnly" ? null : ((await opts.resolveUserId?.()) ?? null);

    const id = identify(req, strategy, userId); // userOnly + null → throw "UNAUTHENTICATED"

    const verdict = await enforce(opts.tier, id);
    if (!verdict.ok) {
      const target =
        opts.redirectOnBlock?.(verdict.retryAfterSeconds) ??
        `/?error=RATE_LIMITED&retryAfter=${verdict.retryAfterSeconds}`;
      redirect(target);
    }

    return handler(...args);
  };
}
