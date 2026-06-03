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

  it("기존 dedupeKey 없으면 PENDING 행 생성", async () => {
    mocks.tx.emailJob.findUnique.mockResolvedValue(null);
    await enqueueEmailJob(tx, ARGS);
    expect(mocks.tx.emailJob.create).toHaveBeenCalledWith({
      data: {
        type: "BOOKING_CONFIRMATION",
        dedupeKey: "booking-confirmation:clbk1",
        bookingId: "clbk1",
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
