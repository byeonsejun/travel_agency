import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
vi.mock("@/shared/lib/db", () => ({ db: { webVitalEvent: { create: (...a: unknown[]) => createMock(...a) } } }));

// withRateLimit를 pass-through로 모킹 (rate-limit 로직은 Task 5/기존 테스트가 커버).
vi.mock("@/shared/lib/rate-limit", () => ({
  withRateLimit: (_opts: unknown, handler: (req: Request) => Promise<Response>) => handler,
}));

async function postRum(body: unknown) {
  const { POST } = await import("../route");
  const req = new Request("http://localhost:3000/api/rum", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(req as never);
}

describe("/api/rum", () => {
  beforeEach(() => createMock.mockReset());

  it("정상 payload → 204 + create 1회 (rating 자동 산출)", async () => {
    const res = await postRum({ metric: "LCP", value: 2300, route: "/products/[id]", navType: "navigate" });
    expect(res.status).toBe(204);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].data).toMatchObject({
      metric: "LCP",
      value: 2300,
      rating: "good",
      route: "/products/[id]",
      navType: "navigate",
    });
  });

  it("화이트리스트 밖 route → /(other)로 강등 저장", async () => {
    await postRum({ metric: "CLS", value: 0.05, route: "/evil-injected" });
    expect(createMock.mock.calls[0][0].data.route).toBe("/(other)");
  });

  it("악성/미상 payload → 400 + create 0회", async () => {
    const res = await postRum({ metric: "HACK", value: -5, route: "/" });
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("잘못된 JSON → 400 + create 0회", async () => {
    const res = await postRum("not-json{{{");
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });
});
