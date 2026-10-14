import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  tx: { analyticsJob: { findUnique: vi.fn(), create: vi.fn() } },
}));

import { enqueueAnalyticsJob } from "../enqueue";

const tx = mocks.tx as unknown as Prisma.TransactionClient;
const OCCURRED = new Date("2026-10-14T01:00:00Z");

describe("enqueueAnalyticsJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.analyticsJob.create.mockResolvedValue({ id: "claj1" });
  });

  it("dedupeKey 미존재 → PENDING 행 생성 (refundJobId 미지정 → null)", async () => {
    mocks.tx.analyticsJob.findUnique.mockResolvedValue(null);
    await enqueueAnalyticsJob(tx, {
      type: "PURCHASE",
      dedupeKey: "ga-purchase:clbk1",
      bookingId: "clbk1",
      occurredAt: OCCURRED,
    });
    expect(mocks.tx.analyticsJob.create).toHaveBeenCalledWith({
      data: {
        type: "PURCHASE",
        dedupeKey: "ga-purchase:clbk1",
        bookingId: "clbk1",
        refundJobId: null,
        occurredAt: OCCURRED,
        status: "PENDING",
      },
    });
  });

  it("REFUND 는 refundJobId 를 저장", async () => {
    mocks.tx.analyticsJob.findUnique.mockResolvedValue(null);
    await enqueueAnalyticsJob(tx, {
      type: "REFUND",
      dedupeKey: "ga-refund:clrj1",
      bookingId: "clbk1",
      refundJobId: "clrj1",
      occurredAt: OCCURRED,
    });
    expect(mocks.tx.analyticsJob.create.mock.calls[0][0].data.refundJobId).toBe("clrj1");
  });

  it("같은 dedupeKey 가 이미 있으면 no-op (멱등 — P2002 로 Tx abort 시키지 않음)", async () => {
    mocks.tx.analyticsJob.findUnique.mockResolvedValue({ id: "claj_existing" });
    await enqueueAnalyticsJob(tx, {
      type: "PURCHASE",
      dedupeKey: "ga-purchase:clbk1",
      bookingId: "clbk1",
      occurredAt: OCCURRED,
    });
    expect(mocks.tx.analyticsJob.create).not.toHaveBeenCalled();
  });
});
