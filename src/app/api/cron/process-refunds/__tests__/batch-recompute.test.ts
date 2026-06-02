import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  listDueRefundJobs: vi.fn(),
  retryRefundJob: vi.fn(),
  recomputeBatchStatus: vi.fn(),
  db: { refundJob: { findMany: vi.fn() } },
  env: { CRON_SECRET: "secret" },
}));
vi.mock("@/entities/payment", () => ({
  listDueRefundJobs: mocks.listDueRefundJobs,
  retryRefundJob: mocks.retryRefundJob,
}));
vi.mock("@/entities/departure-cancellation", () => ({
  recomputeBatchStatus: mocks.recomputeBatchStatus,
}));
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
vi.mock("@/shared/lib/env", () => ({ env: mocks.env }));
vi.mock("@/shared/lib/observability", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  metrics: { incr: vi.fn() },
}));

import { GET } from "../route";

function req() {
  return new Request("http://x/api/cron/process-refunds", {
    headers: { authorization: "Bearer secret" },
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recomputeBatchStatus.mockResolvedValue("COMPLETED");
});

describe("process-refunds cron — 배치 recompute", () => {
  it("drain한 job들의 distinct batchId에 recomputeBatchStatus 호출 (null=단일 사용자 환불 skip)", async () => {
    mocks.listDueRefundJobs.mockResolvedValue([{ id: "j1" }, { id: "j2" }, { id: "j3" }]);
    mocks.retryRefundJob.mockResolvedValue({ type: "succeeded", jobId: "x" });
    // 처리된 job들의 batchId: j1,j2 → batchA / j3 → null(단일 사용자 환불)
    mocks.db.refundJob.findMany.mockResolvedValue([
      { cancellationBatchId: "batchA" },
      { cancellationBatchId: "batchA" },
      { cancellationBatchId: null },
    ]);

    const res = await GET(req());
    expect(res.status).toBe(200);
    // batchA 1회만 (distinct), null은 skip
    expect(mocks.recomputeBatchStatus).toHaveBeenCalledTimes(1);
    expect(mocks.recomputeBatchStatus).toHaveBeenCalledWith("batchA");
  });

  it("due job 0건이면 recompute 미호출", async () => {
    mocks.listDueRefundJobs.mockResolvedValue([]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(mocks.recomputeBatchStatus).not.toHaveBeenCalled();
  });

  it("미인증 → 401, recompute 미호출", async () => {
    const bad = new Request("http://x/api/cron/process-refunds") as unknown as import("next/server").NextRequest;
    const res = await GET(bad);
    expect(res.status).toBe(401);
    expect(mocks.recomputeBatchStatus).not.toHaveBeenCalled();
  });
});
