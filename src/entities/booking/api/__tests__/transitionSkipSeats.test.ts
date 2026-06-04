import { describe, it, expect, vi, beforeEach } from "vitest";

const releaseSeats = vi.fn();
vi.mock("../seatLock", () => ({
  reserveSeats: vi.fn(),
  releaseSeats: (...args: unknown[]) => releaseSeats(...args),
  InsufficientCapacityError: class extends Error {},
}));
vi.mock("@/shared/lib/email-job/enqueue", () => ({ enqueueEmailJob: vi.fn() }));

import { transitionStatusTx } from "../mutations";

function txWith(booking: { status: string; departureId: string; adultCount: number; childCount: number }) {
  return {
    booking: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "bk1", ...booking }),
      update: vi.fn().mockResolvedValue({ id: "bk1", status: "CANCELED_BY_AGENCY" }),
    },
    bookingEvent: { create: vi.fn() },
  } as never;
}

describe("transitionStatusTx skipSeatReturn", () => {
  beforeEach(() => releaseSeats.mockClear());

  it("skipSeatReturn=true면 terminal 전이라도 releaseSeats 미호출(이중환원 방지)", async () => {
    await transitionStatusTx(
      txWith({ status: "PAID", departureId: "d1", adultCount: 2, childCount: 0 }),
      { bookingId: "bk1", to: "CANCELED_BY_AGENCY", actor: "system:saga", skipSeatReturn: true }
    );
    expect(releaseSeats).not.toHaveBeenCalled();
  });

  it("skipSeatReturn 미지정이면 기존대로 좌석 환원", async () => {
    await transitionStatusTx(
      txWith({ status: "PAID", departureId: "d1", adultCount: 2, childCount: 0 }),
      { bookingId: "bk1", to: "CANCELED_BY_AGENCY", actor: "system:saga" }
    );
    expect(releaseSeats).toHaveBeenCalledOnce();
  });
});
