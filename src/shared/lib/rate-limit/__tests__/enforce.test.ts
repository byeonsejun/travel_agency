import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/lib/env", () => ({
  env: {
    UPSTASH_REDIS_REST_URL: "https://mock",
    UPSTASH_REDIS_REST_TOKEN: "mock",
    RATE_LIMIT_MODE: undefined as "shadow" | "enforce" | undefined,
  },
}));
vi.mock("../client", () => ({
  getRatelimiter: vi.fn(),
}));
vi.mock("@/shared/lib/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import * as envMod from "@/shared/lib/env";
import * as clientMod from "../client";
import { logger } from "@/shared/lib/observability";
import { enforce } from "../enforce";

const NOW = 1_717_000_000_000;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  (envMod.env as { RATE_LIMIT_MODE: string | undefined }).RATE_LIMIT_MODE = undefined;
});

describe("enforce — degradation", () => {
  it("returns bypassed=true when ratelimiter not configured", async () => {
    vi.mocked(clientMod.getRatelimiter).mockReturnValue(null);
    const v = await enforce("global", "ip:1.2.3.4");
    expect(v.ok).toBe(true);
    expect(v.bypassed).toBe(true);
    expect(v.shadowed).toBe(false);
  });

  it("returns bypassed=true on Upstash exception (fail-open)", async () => {
    vi.mocked(clientMod.getRatelimiter).mockReturnValue({
      limit: vi.fn().mockRejectedValue(new Error("upstash 503")),
    } as never);
    const v = await enforce("payment", "user:abc");
    expect(v.ok).toBe(true);
    expect(v.bypassed).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      "rate_limit.degraded",
      expect.objectContaining({ tier: "payment" }),
    );
  });
});

describe("enforce — under limit", () => {
  it("returns ok=true with remaining count", async () => {
    vi.mocked(clientMod.getRatelimiter).mockReturnValue({
      limit: vi.fn().mockResolvedValue({
        success: true,
        limit: 100,
        remaining: 50,
        reset: NOW + 10_000,
      }),
    } as never);
    const v = await enforce("global", "ip:1.2.3.4");
    expect(v.ok).toBe(true);
    expect(v.limit).toBe(100);
    expect(v.remaining).toBe(50);
    expect(v.shadowed).toBe(false);
    expect(v.bypassed).toBe(false);
  });
});

describe("enforce — over limit", () => {
  it("returns ok=false in default (enforce) mode", async () => {
    vi.mocked(clientMod.getRatelimiter).mockReturnValue({
      limit: vi.fn().mockResolvedValue({
        success: false,
        limit: 10,
        remaining: 0,
        reset: NOW + 47_000,
      }),
    } as never);
    const v = await enforce("payment", "user:abc");
    expect(v.ok).toBe(false);
    expect(v.shadowed).toBe(false);
    expect(v.retryAfterSeconds).toBe(47);
    expect(logger.info).toHaveBeenCalledWith(
      "rate_limit.exceeded",
      expect.objectContaining({ tier: "payment", shadowed: false }),
    );
  });

  it("returns ok=true + shadowed=true in shadow mode", async () => {
    (envMod.env as { RATE_LIMIT_MODE: string }).RATE_LIMIT_MODE = "shadow";
    vi.mocked(clientMod.getRatelimiter).mockReturnValue({
      limit: vi.fn().mockResolvedValue({
        success: false,
        limit: 10,
        remaining: 0,
        reset: NOW + 30_000,
      }),
    } as never);
    const v = await enforce("auth", "ip:1.2.3.4");
    expect(v.ok).toBe(true);
    expect(v.shadowed).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      "rate_limit.exceeded",
      expect.objectContaining({ tier: "auth", shadowed: true }),
    );
  });

  it("masks identifier in log via hashIdForLog", async () => {
    vi.mocked(clientMod.getRatelimiter).mockReturnValue({
      limit: vi.fn().mockResolvedValue({
        success: false,
        limit: 10,
        remaining: 0,
        reset: NOW + 10_000,
      }),
    } as never);
    await enforce("payment", "user:abcdefghij");
    expect(logger.info).toHaveBeenCalledWith(
      "rate_limit.exceeded",
      expect.objectContaining({
        identifier: expect.not.stringContaining("abcdefghij"),
      }),
    );
  });
});
