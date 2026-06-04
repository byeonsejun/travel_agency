import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  listDueRefundJobs: vi.fn(),
  retryRefundJob: vi.fn(),
  recomputeBatchStatus: vi.fn(),
  db: { refundJob: { findMany: vi.fn() } },
}));
vi.mock("@/entities/payment", () => ({
  listDueRefundJobs: mocks.listDueRefundJobs,
  retryRefundJob: mocks.retryRefundJob,
}));
vi.mock("@/entities/departure-cancellation", () => ({
  recomputeBatchStatus: mocks.recomputeBatchStatus,
}));
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
vi.mock("@/shared/lib/observability", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  metrics: { incr: vi.fn() },
}));

import { processRefundJobBatch } from "../worker";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recomputeBatchStatus.mockResolvedValue("COMPLETED");
});

describe("processRefundJobBatch", () => {
  it("drain한 job들의 distinct batchId에 recompute 호출 (null=단일 사용자 환불 skip)", async () => {
    mocks.listDueRefundJobs.mockResolvedValue([{ id: "j1" }, { id: "j2" }, { id: "j3" }]);
    mocks.retryRefundJob.mockResolvedValue({ type: "succeeded", jobId: "x" });
    mocks.db.refundJob.findMany.mockResolvedValue([
      { cancellationBatchId: "batchA" },
      { cancellationBatchId: "batchA" },
      { cancellationBatchId: null },
    ]);

    const result = await processRefundJobBatch({ limit: 10 });

    expect(result.processed).toBe(3);
    expect(mocks.recomputeBatchStatus).toHaveBeenCalledTimes(1);
    expect(mocks.recomputeBatchStatus).toHaveBeenCalledWith("batchA");
  });

  it("due job 0건이면 recompute 미호출 + processed 0", async () => {
    mocks.listDueRefundJobs.mockResolvedValue([]);
    const result = await processRefundJobBatch({ limit: 10 });
    expect(result.processed).toBe(0);
    expect(result.results).toEqual([]);
    expect(mocks.recomputeBatchStatus).not.toHaveBeenCalled();
  });

  it("한 job throw → 격리(error 결과) + 루프 계속", async () => {
    mocks.listDueRefundJobs.mockResolvedValue([{ id: "j1" }, { id: "j2" }]);
    mocks.retryRefundJob
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce({ type: "succeeded", jobId: "j2" });
    mocks.db.refundJob.findMany.mockResolvedValue([
      { cancellationBatchId: null },
      { cancellationBatchId: null },
    ]);

    const result = await processRefundJobBatch({ limit: 10 });

    expect(result.processed).toBe(2);
    expect(result.results.some((r) => r.type === "error")).toBe(true);
  });
});
