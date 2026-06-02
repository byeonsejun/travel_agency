import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    refundJob: { findMany: vi.fn() },
    departureCancellation: { update: vi.fn() },
  },
}));
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));

import { recomputeBatchStatus } from "../recomputeBatchStatus";

beforeEach(() => vi.clearAllMocks());

function jobs(statuses: string[]) {
  mocks.db.refundJob.findMany.mockResolvedValue(statuses.map((s) => ({ status: s })));
  mocks.db.departureCancellation.update.mockResolvedValue({});
}

describe("recomputeBatchStatus — 파생 규칙 (FAILED 우선)", () => {
  it("하나라도 FAILED → PARTIALLY_FAILED (전부 종결)", async () => {
    jobs(["SUCCEEDED", "FAILED"]);
    expect(await recomputeBatchStatus("batch1")).toBe("PARTIALLY_FAILED");
  });

  it("FAILED + 아직 PENDING 혼재 → PARTIALLY_FAILED (FAILED 우선, 엣지)", async () => {
    jobs(["PENDING", "FAILED"]);
    expect(await recomputeBatchStatus("batch1")).toBe("PARTIALLY_FAILED");
  });

  it("모두 SUCCEEDED → COMPLETED", async () => {
    jobs(["SUCCEEDED", "SUCCEEDED"]);
    expect(await recomputeBatchStatus("batch1")).toBe("COMPLETED");
  });

  it("job 0건(미결제만 있던 배치) → COMPLETED", async () => {
    jobs([]);
    expect(await recomputeBatchStatus("batch1")).toBe("COMPLETED");
  });

  it("FAILED 없고 미종결(PENDING/IN_PROGRESS) 존재 → PROCESSING", async () => {
    jobs(["SUCCEEDED", "PENDING"]);
    expect(await recomputeBatchStatus("batch1")).toBe("PROCESSING");
  });

  it("IN_PROGRESS만 → PROCESSING", async () => {
    jobs(["IN_PROGRESS"]);
    expect(await recomputeBatchStatus("batch1")).toBe("PROCESSING");
  });

  it("도출된 status를 배치 row에 update", async () => {
    jobs(["FAILED"]);
    await recomputeBatchStatus("batch1");
    expect(mocks.db.departureCancellation.update).toHaveBeenCalledWith({
      where: { id: "batch1" },
      data: { status: "PARTIALLY_FAILED" },
    });
  });
});
