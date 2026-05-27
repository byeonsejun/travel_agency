/**
 * withRateLimit.ts — Route handler wrapper (spec §4, §6).
 *
 * Hybrid 통합의 *2차 게이트* — tier-specific 한도를 call site에서 명시 선언.
 * 미들웨어는 global tier baseline만 담당하고, 도메인별(payment / ai-search 등)
 * 정밀 한도는 본 wrapper로.
 *
 * 사용:
 *   export const POST = withRateLimit(
 *     { tier: "payment", resolveUserId: async (req) => (await auth())?.user?.id ?? null },
 *     async (req) => { ... 기존 핸들러 ... }
 *   );
 *
 * 응답 헤더: 정상/차단 모두 X-RateLimit-* 박제. 차단 시 Retry-After 추가.
 * 401: strategy=userOnly + userId null 시 즉시 응답 (enforce 호출 안 함).
 */

import { NextResponse, type NextRequest } from "next/server";
import { enforce } from "./enforce";
import { identify } from "./identifier";
import { buildRateLimitHeaders } from "./responseHeaders";
import { RATE_LIMIT_TIERS, type IdStrategy, type RateLimitTier } from "./tiers";

export interface WithRateLimitOptions {
  tier: RateLimitTier;
  idStrategy?: IdStrategy;
  resolveUserId?: (req: NextRequest) => Promise<string | null>;
}

export function withRateLimit(
  opts: WithRateLimitOptions,
  handler: (req: NextRequest) => Promise<NextResponse>,
): (req: NextRequest, ...rest: unknown[]) => Promise<NextResponse>;
export function withRateLimit<Args extends unknown[]>(
  opts: WithRateLimitOptions,
  handler: (req: NextRequest, ...args: Args) => Promise<NextResponse>,
): (req: NextRequest, ...args: Args) => Promise<NextResponse>;
export function withRateLimit<Args extends unknown[]>(
  opts: WithRateLimitOptions,
  handler: (req: NextRequest, ...args: Args) => Promise<NextResponse>,
): (req: NextRequest, ...args: Args) => Promise<NextResponse> {
  const strategy = opts.idStrategy ?? RATE_LIMIT_TIERS[opts.tier].idStrategy;

  return async (req, ...args) => {
    const userId =
      strategy === "ipOnly"
        ? null
        : ((await opts.resolveUserId?.(req)) ?? null);

    let id: string;
    try {
      id = identify(req as unknown as Request, strategy, userId);
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const verdict = await enforce(opts.tier, id);
    const headers = buildRateLimitHeaders(verdict);

    if (!verdict.ok) {
      headers["Retry-After"] = String(verdict.retryAfterSeconds);
      return NextResponse.json(
        {
          error: "RATE_LIMITED",
          tier: opts.tier,
          retryAfterSeconds: verdict.retryAfterSeconds,
        },
        { status: 429, headers },
      );
    }

    const res = await handler(req, ...args);
    for (const [k, v] of Object.entries(headers)) {
      res.headers.set(k, v);
    }
    return res;
  };
}
