import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  enqueueEmailJob: vi.fn(),
  tx: {
    booking: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    bookingEvent: { create: vi.fn() },
    emailJob: { findUnique: vi.fn(), create: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));

vi.mock("@/shared/lib/email-job/enqueue", () => ({
  enqueueEmailJob: mocks.enqueueEmailJob,
}));
vi.mock("../seatLock", () => ({
  reserveSeats: vi.fn(),
  releaseSeats: vi.fn(),
  InsufficientCapacityError: class extends Error {},
}));

import { transitionStatusTx } from "../mutations";

const tx = mocks.tx as unknown as Prisma.TransactionClient;
const BID = "clbk000000000000000001";

function mockBooking(status: string) {
  mocks.tx.booking.findUniqueOrThrow.mockResolvedValue({
    id: BID,
    status,
    departureId: "cldep1",
    adultCount: 2,
    childCount: 0,
  });
  mocks.tx.booking.update.mockResolvedValue({ id: BID, status });
}

describe("transitionStatusTx 아웃박스 훅", () => {
  beforeEach(() => vi.clearAllMocks());

  it("DEPARTURE_CONFIRMED → PAID 시 예약확정 EmailJob enqueue", async () => {
    mockBooking("DEPARTURE_CONFIRMED");
    await transitionStatusTx(tx, {
      bookingId: BID,
      to: "PAID",
      actor: "system:test",
    });
    expect(mocks.enqueueEmailJob).toHaveBeenCalledWith(tx, {
      type: "BOOKING_CONFIRMATION",
      dedupeKey: `booking-confirmation:${BID}`,
      bookingId: BID,
    });
  });

  it("PAID → CANCELED_BY_USER 시 환불 EmailJob enqueue", async () => {
    mockBooking("PAID");
    await transitionStatusTx(tx, {
      bookingId: BID,
      to: "CANCELED_BY_USER",
      actor: "user:x",
    });
    expect(mocks.enqueueEmailJob).toHaveBeenCalledWith(tx, {
      type: "REFUND_COMPLETED",
      dedupeKey: `refund-completed:${BID}`,
      bookingId: BID,
    });
  });

  it("PAID → READY (eticket) 비대상 전이는 enqueue 안 함", async () => {
    mockBooking("PAID");
    await transitionStatusTx(tx, {
      bookingId: BID,
      to: "READY",
      actor: "system:test",
    });
    expect(mocks.enqueueEmailJob).not.toHaveBeenCalled();
  });
});
