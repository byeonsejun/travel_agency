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

  // ── onBlock 반환 모드 (신규) ──────────────────────────────────────────────

  it("onBlock: 차단 시 onBlock 반환값을 돌려주고 handler를 호출하지 않는다", async () => {
    vi.mocked(enforceMod.enforce).mockResolvedValue({
      ok: false, limit: 20, remaining: 0, reset: 1717000000,
      retryAfterSeconds: 30, shadowed: false, bypassed: false,
    });
    // R = { ok: boolean; message?: string } — handler 와 onBlock 동일 타입
    type ActionResult = { ok: true } | { ok: false; message: string };
    const handler = vi.fn(async (): Promise<ActionResult> => ({ ok: true }));
    const action = withRateLimitAction<[], ActionResult>(
      {
        tier: "mutation",
        onBlock: (retry): ActionResult => ({ ok: false, message: `차단: ${retry}초` }),
      },
      handler,
    );
    const result = await action();
    expect(result).toEqual({ ok: false, message: "차단: 30초" });
    expect(handler).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("onBlock: 허용될 때는 handler를 정상 호출하고 onBlock은 쓰이지 않는다", async () => {
    vi.mocked(enforceMod.enforce).mockResolvedValue({
      ok: true, limit: 20, remaining: 19, reset: 0,
      retryAfterSeconds: 0, shadowed: false, bypassed: false,
    });
    type ActionResult = { ok: true; n: number } | { ok: false; message: string };
    const handler = vi.fn(async (n: number): Promise<ActionResult> => ({ ok: true, n }));
    const action = withRateLimitAction<[number], ActionResult>(
      {
        tier: "mutation",
        onBlock: (): ActionResult => ({ ok: false, message: "차단" }),
      },
      handler,
    );
    const result = await action(42);
    expect(result).toEqual({ ok: true, n: 42 });
    expect(handler).toHaveBeenCalledWith(42);
  });

  it("onBlock이 없으면 차단 시 여전히 redirect를 호출한다 (하위 호환)", async () => {
    vi.mocked(enforceMod.enforce).mockResolvedValue({
      ok: false, limit: 5, remaining: 0, reset: 1717000000,
      retryAfterSeconds: 55, shadowed: false, bypassed: false,
    });
    const action = withRateLimitAction(
      { tier: "auth" },
      async () => "never",
    );
    await expect(action()).rejects.toThrow("REDIRECT:/?error=RATE_LIMITED&retryAfter=55");
    expect(redirect).toHaveBeenCalledWith("/?error=RATE_LIMITED&retryAfter=55");
  });

  it("onBlock이 redirectOnBlock보다 우선한다 — redirect는 호출되지 않는다", async () => {
    vi.mocked(enforceMod.enforce).mockResolvedValue({
      ok: false, limit: 5, remaining: 0, reset: 1717000000,
      retryAfterSeconds: 10, shadowed: false, bypassed: false,
    });
    type ActionResult = { blocked: boolean; retry: number };
    const action = withRateLimitAction<[], ActionResult>(
      {
        tier: "auth",
        redirectOnBlock: () => "/login?error=RATE_LIMITED",
        onBlock: (retry): ActionResult => ({ blocked: true, retry }),
      },
      async (): Promise<ActionResult> => ({ blocked: false, retry: 0 }),
    );
    const result = await action();
    expect(result).toEqual({ blocked: true, retry: 10 });
    expect(redirect).not.toHaveBeenCalled();
  });
});
