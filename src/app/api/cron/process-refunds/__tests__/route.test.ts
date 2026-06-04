import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  processRefundJobBatch: vi.fn(),
  env: { CRON_SECRET: "x".repeat(32) },
}));
vi.mock("@/shared/lib/refund-job/worker", () => ({
  processRefundJobBatch: mocks.processRefundJobBatch,
}));
vi.mock("@/shared/lib/env", () => ({ env: mocks.env }));
vi.mock("@/shared/lib/observability", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  metrics: { incr: vi.fn() },
}));

import { GET } from "../route";

function req(auth?: string) {
  return new NextRequest("http://localhost/api/cron/process-refunds", {
    headers: auth ? { authorization: auth } : {},
  });
}

describe("GET /api/cron/process-refunds (얇은 래퍼)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("CRON_SECRET 불일치 → 401, 워커 미호출", async () => {
    const res = await GET(req("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(mocks.processRefundJobBatch).not.toHaveBeenCalled();
  });

  it("인증 통과 → 워커 위임(limit 10) + 결과 JSON", async () => {
    mocks.processRefundJobBatch.mockResolvedValue({
      processed: 1,
      summary: { succeeded: 1 },
      results: [],
    });
    const res = await GET(req(`Bearer ${"x".repeat(32)}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ processed: 1 });
    expect(mocks.processRefundJobBatch).toHaveBeenCalledWith({ limit: 10 });
  });
});
