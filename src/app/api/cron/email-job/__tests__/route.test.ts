import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  processEmailJobBatch: vi.fn(),
  env: { CRON_SECRET: "x".repeat(32) },
}));

vi.mock("@/shared/lib/email-job/worker", () => ({
  processEmailJobBatch: mocks.processEmailJobBatch,
}));
vi.mock("@/shared/lib/env", () => ({ env: mocks.env }));
vi.mock("@/shared/lib/observability", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  metrics: { incr: vi.fn() },
}));

import { GET } from "../route";

function req(auth?: string) {
  return new NextRequest("http://localhost/api/cron/email-job", {
    headers: auth ? { authorization: auth } : {},
  });
}

describe("GET /api/cron/email-job", () => {
  beforeEach(() => vi.clearAllMocks());

  it("CRON_SECRET 불일치 → 401", async () => {
    const res = await GET(req("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(mocks.processEmailJobBatch).not.toHaveBeenCalled();
  });

  it("인증 통과 → 배치 위임 + 결과 JSON", async () => {
    mocks.processEmailJobBatch.mockResolvedValue({
      processed: 2,
      succeeded: 2,
      failed: 0,
      skipped: 0,
    });
    const res = await GET(req(`Bearer ${"x".repeat(32)}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ processed: 2, succeeded: 2 });
    expect(mocks.processEmailJobBatch).toHaveBeenCalledWith({ limit: 10 });
  });
});
