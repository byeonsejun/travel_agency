import { NextResponse, type NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../enforce", () => ({ enforce: vi.fn() }));
import * as enforceMod from "../enforce";
import { withRateLimit } from "../withRateLimit";

function req(headers: Record<string, string> = {}, url = "http://localhost/api/x"): NextRequest {
  return new Request(url, { method: "POST", headers }) as unknown as NextRequest;
}

beforeEach(() => vi.clearAllMocks());

describe("withRateLimit", () => {
  it("blocks with 429 + Retry-After + body when verdict.ok=false", async () => {
    vi.mocked(enforceMod.enforce).mockResolvedValue({
      ok: false,
      limit: 10,
      remaining: 0,
      reset: 1717000000,
      retryAfterSeconds: 47,
      shadowed: false,
      bypassed: false,
    });
    const wrapped = withRateLimit(
      { tier: "payment", resolveUserId: async () => "u_1" },
      async () => NextResponse.json({ ok: true }),
    );
    const res = await wrapped(req({ "x-real-ip": "1.2.3.4" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("47");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    const body = await res.json();
    expect(body).toMatchObject({ error: "RATE_LIMITED", tier: "payment", retryAfterSeconds: 47 });
  });

  it("returns 401 when strategy=userOnly but resolveUserId yields null", async () => {
    const handler = vi.fn();
    const wrapped = withRateLimit(
      { tier: "payment", resolveUserId: async () => null },
      handler,
    );
    const res = await wrapped(req());
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(enforceMod.enforce).not.toHaveBeenCalled();
  });

  it("attaches X-RateLimit-* headers on pass-through", async () => {
    vi.mocked(enforceMod.enforce).mockResolvedValue({
      ok: true,
      limit: 100,
      remaining: 87,
      reset: 1717000000,
      retryAfterSeconds: 0,
      shadowed: false,
      bypassed: false,
    });
    const wrapped = withRateLimit(
      { tier: "global", resolveUserId: async () => "u_1" },
      async () => NextResponse.json({ ok: true }),
    );
    const res = await wrapped(req({ "x-real-ip": "1.2.3.4" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("100");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("87");
  });

  it("forwards extra handler args (e.g., route params context)", async () => {
    vi.mocked(enforceMod.enforce).mockResolvedValue({
      ok: true, limit: 100, remaining: 99, reset: 0,
      retryAfterSeconds: 0, shadowed: false, bypassed: false,
    });
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withRateLimit(
      { tier: "global", resolveUserId: async () => null },
      handler,
    );
    const ctx = { params: { id: "x" } };
    await wrapped(req({ "x-real-ip": "1.2.3.4" }), ctx as never);
    expect(handler).toHaveBeenCalledWith(expect.anything(), ctx);
  });

  it("uses tier default idStrategy when opts.idStrategy omitted", async () => {
    // payment tier 의 default 는 userOnly — resolveUserId 없으면 401.
    const wrapped = withRateLimit(
      { tier: "payment" }, // resolveUserId 미설정 → 항상 null
      async () => NextResponse.json({ ok: true }),
    );
    const res = await wrapped(req());
    expect(res.status).toBe(401);
  });
});
