import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  tx: {
    booking: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    bookingEvent: { create: vi.fn() },
    emailJob: { findUnique: vi.fn(), create: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));
vi.mock("@/shared/lib/db", () => ({ db: { $transaction: vi.fn() } }));
vi.mock("@/shared/lib/email-job/enqueue", () => ({ enqueueEmailJob: vi.fn() }));

import { cancelBookingByAgencyTx } from "../mutations";
import type { Prisma } from "@prisma/client";

beforeEach(() => vi.clearAllMocks());

it("PAID booking → CANCELED_BY_AGENCY 전이 + 좌석 환원(releaseSeats raw 호출)", async () => {
  mocks.tx.booking.findUniqueOrThrow.mockResolvedValue({
    id: "b1",
    status: "PAID",
    departureId: "d1",
    adultCount: 2,
    childCount: 1,
  });
  mocks.tx.booking.update.mockResolvedValue({ id: "b1", status: "CANCELED_BY_AGENCY" });

  await cancelBookingByAgencyTx(mocks.tx as unknown as Prisma.TransactionClient, {
    bookingId: "b1",
    actor: "admin:a1",
    reason: "departure canceled",
  });

  // shouldReturnSeats(PAID→CANCELED_BY_AGENCY)=true → releaseSeats가 $executeRaw 호출
  expect(mocks.tx.$executeRaw).toHaveBeenCalled();
  expect(mocks.tx.booking.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ status: "CANCELED_BY_AGENCY" }),
    }),
  );
  expect(mocks.tx.bookingEvent.create).toHaveBeenCalled();
});
