import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("../enforce", () => ({ enforce: vi.fn() }));

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import * as enforceMod from "../enforce";
import { withRateLimitAction } from "../withRateLimitAction";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(headers).mockResolvedValue(
    new Headers({ "x-real-ip": "1.2.3.4" }) as never,
  );
});

describe("withRateLimitAction", () => {
  it("redirects with retryAfter query on block (default path)", async () => {
    vi.mocked(enforceMod.enforce).mockResolvedValue({
      ok: false, limit: 5, remaining: 0, reset: 1717000000,
      retryAfterSeconds: 42, shadowed: false, bypassed: false,
    });
    const action = withRateLimitAction(
      { tier: "auth" },
      async (formData: FormData) => formData.get("x"),
    );
    await expect(action(new FormData())).rejects.toThrow(
      "REDIRECT:/?error=RATE_LIMITED&retryAfter=42",
    );
    expect(redirect).toHaveBeenCalledWith("/?error=RATE_LIMITED&retryAfter=42");
  });

  it("uses redirectOnBlock override when provided", async () => {
    vi.mocked(enforceMod.enforce).mockResolvedValue({
      ok: false, limit: 5, remaining: 0, reset: 1717000000,
      retryAfterSeconds: 42, shadowed: false, bypassed: false,
    });
    const action = withRateLimitAction(
      {
        tier: "auth",
        redirectOnBlock: (r) => `/login?error=RATE_LIMITED&retryAfter=${r}`,
      },
      async () => undefined,
    );
    await expect(action()).rejects.toThrow(
      "REDIRECT:/login?error=RATE_LIMITED&retryAfter=42",
    );
  });

  it("invokes handler with original args on pass", async () => {
    vi.mocked(enforceMod.enforce).mockResolvedValue({
      ok: true, limit: 5, remaining: 4, reset: 0,
      retryAfterSeconds: 0, shadowed: false, bypassed: false,
    });
    const handler = vi.fn(async (n: number, s: string) => `${s}-${n * 2}`);
    const action = withRateLimitAction({ tier: "auth" }, handler);
    const result = await action(7, "x");
    expect(result).toBe("x-14");
    expect(handler).toHaveBeenCalledWith(7, "x");
  });

  it("throws UNAUTHENTICATED when strategy=userOnly + no userId", async () => {
    const action = withRateLimitAction(
      { tier: "payment", resolveUserId: async () => null },
      async () => "ok",
    );
    await expect(action()).rejects.toThrow("UNAUTHENTICATED");
    expect(enforceMod.enforce).not.toHaveBeenCalled();
  });
});
