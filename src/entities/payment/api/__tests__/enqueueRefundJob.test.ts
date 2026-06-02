import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  tx: { refundJob: { findFirst: vi.fn(), create: vi.fn() } },
}));

import { enqueueRefundJob } from "../enqueueRefundJob";
import type { Prisma } from "@prisma/client";

beforeEach(() => vi.clearAllMocks());

const args = {
  bookingId: "b1",
  paymentId: "p1",
  amount: 1_000_000,
  actor: "admin:a1",
  reason: "departure canceled",
  cancellationBatchId: "batch1",
};

describe("enqueueRefundJob", () => {
  it("기존 active job 없으면 PENDING 생성 + batchId 보존", async () => {
    mocks.tx.refundJob.findFirst.mockResolvedValue(null);
    mocks.tx.refundJob.create.mockResolvedValue({ id: "rj1" });
    const res = await enqueueRefundJob(
      mocks.tx as unknown as Prisma.TransactionClient,
      args,
    );
    expect(res.enqueued).toBe(true);
    expect(mocks.tx.refundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookingId: "b1",
          paymentId: "p1",
          amount: 1_000_000,
          actor: "admin:a1",
          status: "PENDING",
          cancellationBatchId: "batch1",
        }),
      }),
    );
  });

  it("기존 active job(PENDING/IN_PROGRESS/SUCCEEDED) 있으면 skip (이중 환불 차단)", async () => {
    mocks.tx.refundJob.findFirst.mockResolvedValue({ id: "existing", status: "PENDING" });
    const res = await enqueueRefundJob(
      mocks.tx as unknown as Prisma.TransactionClient,
      args,
    );
    expect(res.enqueued).toBe(false);
    expect(mocks.tx.refundJob.create).not.toHaveBeenCalled();
  });
});
