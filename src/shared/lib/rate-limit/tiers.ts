export type RateLimitTier = "global" | "auth" | "payment" | "ai-search";
export type IdStrategy = "userFirst" | "ipOnly" | "userOnly";

export interface TierConfig {
  readonly limit: number;
  /** Upstash Ratelimit 윈도우 형식 — `"<n> <unit>"` (`s`|`m`|`h`|`d`). */
  readonly window: `${number} ${"s" | "m" | "h" | "d"}`;
  readonly idStrategy: IdStrategy;
}

export const RATE_LIMIT_TIERS = {
  global: { limit: 100, window: "10 s", idStrategy: "userFirst" },
  auth: { limit: 5, window: "1 m", idStrategy: "ipOnly" },
  payment: { limit: 10, window: "1 m", idStrategy: "userOnly" },
  "ai-search": { limit: 20, window: "1 m", idStrategy: "userFirst" },
} as const satisfies Record<RateLimitTier, TierConfig>;

/**
 * Bypass list — rate-limit 자체를 적용하지 않음 (spec §3.1).
 * prefix 매칭 — `/api/cron/` 은 `/api/cron/process-refunds` 등 모든 하위 경로 포함.
 */
export const RATE_LIMIT_BYPASS = [
  "/api/payments/webhook/toss",
  "/api/cron/",
  "/api/csp-report",
  "/api/health",
] as const;

export function isBypassPath(pathname: string): boolean {
  return RATE_LIMIT_BYPASS.some((p) => pathname.startsWith(p));
}
