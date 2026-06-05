import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { enforce } from "./enforce";
import { identify } from "./identifier";
import { RATE_LIMIT_TIERS, type IdStrategy, type RateLimitTier } from "./tiers";

export interface WithRateLimitActionOptions<R = unknown> {
  tier: RateLimitTier;
  idStrategy?: IdStrategy;
  resolveUserId?: () => Promise<string | null>;
  /** 차단 시 redirect 대상 — 미설정 시 `/?error=RATE_LIMITED&retryAfter=N`. */
  redirectOnBlock?: (retryAfterSeconds: number) => string;
  /**
   * 차단 시 redirect 대신 이 값을 반환 (useActionState/island 액션용).
   * redirectOnBlock 보다 우선한다.
   */
  onBlock?: (retryAfterSeconds: number) => R;
}

export function withRateLimitAction<Args extends unknown[], R>(
  opts: WithRateLimitActionOptions<R>,
  handler: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  const strategy = opts.idStrategy ?? RATE_LIMIT_TIERS[opts.tier].idStrategy;

  return async (...args) => {
    const hdrs = await headers();
    const req = new Request("http://internal/", { headers: Object.fromEntries(hdrs.entries()) });
    const userId =
      strategy === "ipOnly" ? null : ((await opts.resolveUserId?.()) ?? null);

    const id = identify(req, strategy, userId); // userOnly + null → throw "UNAUTHENTICATED"

    const verdict = await enforce(opts.tier, id);
    if (!verdict.ok) {
      // onBlock이 있으면 반환값 모드 (redirect 없음)
      if (opts.onBlock) {
        return opts.onBlock(verdict.retryAfterSeconds);
      }
      const target =
        opts.redirectOnBlock?.(verdict.retryAfterSeconds) ??
        `/?error=RATE_LIMITED&retryAfter=${verdict.retryAfterSeconds}`;
      redirect(target);
    }

    return handler(...args);
  };
}
