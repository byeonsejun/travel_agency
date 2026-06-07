import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  tx: {
    emailJob: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { enqueueEmailJob } from "../enqueue";

const tx = mocks.tx as unknown as Prisma.TransactionClient;
const ARGS = {
  type: "BOOKING_CONFIRMATION" as const,
  dedupeKey: "booking-confirmation:clbk1",
  bookingId: "clbk1",
};

describe("enqueueEmailJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.emailJob.create.mockResolvedValue({ id: "clej_new" });
  });

  it("기존 dedupeKey 없으면 PENDING 행 생성 (refundJobId 미지정 → null)", async () => {
    mocks.tx.emailJob.findUnique.mockResolvedValue(null);
    await enqueueEmailJob(tx, ARGS);
    expect(mocks.tx.emailJob.create).toHaveBeenCalledWith({
      data: {
        type: "BOOKING_CONFIRMATION",
        dedupeKey: "booking-confirmation:clbk1",
        bookingId: "clbk1",
        refundJobId: null,
        status: "PENDING",
      },
    });
  });

  it("refundJobId 지정 시 그대로 반영 (PARTIAL_REFUND_COMPLETED)", async () => {
    mocks.tx.emailJob.findUnique.mockResolvedValue(null);
    await enqueueEmailJob(tx, {
      type: "PARTIAL_REFUND_COMPLETED",
      dedupeKey: "partial-refund-completed:clrj1",
      bookingId: "clbk1",
      refundJobId: "clrj1",
    });
    expect(mocks.tx.emailJob.create).toHaveBeenCalledWith({
      data: {
        type: "PARTIAL_REFUND_COMPLETED",
        dedupeKey: "partial-refund-completed:clrj1",
        bookingId: "clbk1",
        refundJobId: "clrj1",
        status: "PENDING",
      },
    });
  });

  it("동일 dedupeKey 존재하면 no-op (create 미호출)", async () => {
    mocks.tx.emailJob.findUnique.mockResolvedValue({ id: "clej_exist" });
    await enqueueEmailJob(tx, ARGS);
    expect(mocks.tx.emailJob.create).not.toHaveBeenCalled();
  });
});
