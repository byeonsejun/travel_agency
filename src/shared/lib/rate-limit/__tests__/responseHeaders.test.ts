import { describe, expect, it } from "vitest";
import { buildRateLimitHeaders } from "../responseHeaders";

describe("buildRateLimitHeaders", () => {
  it("formats verdict into standard X-RateLimit-* headers", () => {
    expect(
      buildRateLimitHeaders({
        ok: true,
        limit: 100,
        remaining: 87,
        reset: 1717000000,
        retryAfterSeconds: 0,
        shadowed: false,
        bypassed: false,
      }),
    ).toEqual({
      "X-RateLimit-Limit": "100",
      "X-RateLimit-Remaining": "87",
      "X-RateLimit-Reset": "1717000000",
    });
  });

  it("clamps negative remaining to 0", () => {
    expect(
      buildRateLimitHeaders({
        ok: false,
        limit: 10,
        remaining: -2,
        reset: 1717000000,
        retryAfterSeconds: 47,
        shadowed: false,
        bypassed: false,
      })["X-RateLimit-Remaining"],
    ).toBe("0");
  });
});
