import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  processRefundJobBatch: vi.fn(),
  processEmailJobBatch: vi.fn(),
  processEmbeddingJobBatch: vi.fn(),
  env: { CRON_SECRET: "x".repeat(32) },
}));
vi.mock("@/shared/lib/refund-job/worker", () => ({
  processRefundJobBatch: mocks.processRefundJobBatch,
}));
vi.mock("@/shared/lib/email-job/worker", () => ({
  processEmailJobBatch: mocks.processEmailJobBatch,
}));
vi.mock("@/shared/lib/embedding-job/worker", () => ({
  processEmbeddingJobBatch: mocks.processEmbeddingJobBatch,
}));
vi.mock("@/shared/lib/env", () => ({ env: mocks.env }));
vi.mock("@/shared/lib/observability", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  metrics: { incr: vi.fn() },
}));

import { GET } from "../route";

const AUTH = `Bearer ${"x".repeat(32)}`;
function req(auth?: string) {
  return new NextRequest("http://localhost/api/cron/dispatcher", {
    headers: auth ? { authorization: auth } : {},
  });
}

describe("GET /api/cron/dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.processRefundJobBatch.mockResolvedValue({ processed: 0, summary: {}, results: [] });
    mocks.processEmailJobBatch.mockResolvedValue({ processed: 2, succeeded: 2, failed: 0, skipped: 0 });
    mocks.processEmbeddingJobBatch.mockResolvedValue({ processed: 1, succeeded: 1, failed: 0, skipped: 0 });
  });

  it("미인증 → 401, 어떤 워커도 미호출", async () => {
    const res = await GET(req("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(mocks.processRefundJobBatch).not.toHaveBeenCalled();
    expect(mocks.processEmailJobBatch).not.toHaveBeenCalled();
    expect(mocks.processEmbeddingJobBatch).not.toHaveBeenCalled();
  });

  it("인증 통과 → 3개 워커 모두 호출(limit 보존) + 통합 결과", async () => {
    const res = await GET(req(AUTH));
    expect(res.status).toBe(200);
    expect(mocks.processRefundJobBatch).toHaveBeenCalledWith({ limit: 10 });
    expect(mocks.processEmailJobBatch).toHaveBeenCalledWith({ limit: 10 });
    expect(mocks.processEmbeddingJobBatch).toHaveBeenCalledWith({ limit: 5 });
    const body = await res.json();
    expect(body.workers).toHaveLength(3);
    expect(body.workers.map((w: { worker: string }) => w.worker)).toEqual([
      "refund",
      "email",
      "embedding",
    ]);
  });

  it("한 워커 reject → 200 유지, 해당 워커만 rejected (allSettled 격리)", async () => {
    mocks.processEmbeddingJobBatch.mockRejectedValue(new Error("openai down"));
    const res = await GET(req(AUTH));
    expect(res.status).toBe(200);
    const body = await res.json();
    const emb = body.workers.find((w: { worker: string }) => w.worker === "embedding");
    expect(emb.status).toBe("rejected");
    expect(emb.error).toContain("openai down");
    const email = body.workers.find((w: { worker: string }) => w.worker === "email");
    expect(email.status).toBe("fulfilled");
  });
});
