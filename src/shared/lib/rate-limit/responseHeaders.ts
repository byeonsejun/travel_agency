/**
 * responseHeaders.ts — verdict → 표준 X-RateLimit-* 헤더.
 *
 * 정상/차단 양쪽 응답에 박제 (spec §6). 차단 시엔 호출부가 추가로 `Retry-After`를
 * 박는다 — 본 헬퍼는 quota 가시성만 담당.
 */

import type { RateLimitVerdict } from "./enforce";

export function buildRateLimitHeaders(
  verdict: RateLimitVerdict,
): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(verdict.limit),
    "X-RateLimit-Remaining": String(Math.max(0, verdict.remaining)),
    "X-RateLimit-Reset": String(verdict.reset),
  };
}
