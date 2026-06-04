import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    departure: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));

import {
  createDeparture,
  updateDeparture,
  transitionDepartureStatus,
  CapacityBelowBookedError,
  DepartureDateConflictError,
  DepartureHasBookingsError,
  DepartureNotFoundError,
  StaleDepartureStatusError,
} from "../mutations";
import { InvalidDepartureTransitionError } from "../../model/transitions";
import { Prisma } from "@prisma/client";

const baseForm = {
  departureDate: new Date("2026-09-01"),
  returnDate: new Date("2026-09-05"),
  priceAdult: 1_000_000,
  priceChild: 700_000,
  priceInfant: 0,
  capacity: 20,
  minPax: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createDeparture", () => {
  it("정상 생성 시 id 반환", async () => {
    mocks.db.departure.create.mockResolvedValue({ id: "dep_1" });
    const id = await createDeparture("prod_1", baseForm);
    expect(id).toBe("dep_1");
    expect(mocks.db.departure.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ productId: "prod_1", capacity: 20 }),
        select: { id: true },
      }),
    );
  });

  it("날짜 충돌(P2002) → DepartureDateConflictError", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "5",
    });
    mocks.db.departure.create.mockRejectedValue(p2002);
    await expect(createDeparture("prod_1", baseForm)).rejects.toBeInstanceOf(
      DepartureDateConflictError,
    );
  });
});

describe("updateDeparture — capacity 축소 CAS (D3)", () => {
  it("bookedSeats <= newCapacity 면 갱신 성공", async () => {
    mocks.db.departure.updateMany.mockResolvedValue({ count: 1 });
    await expect(
      updateDeparture("dep_1", { ...baseForm, capacity: 10 }),
    ).resolves.toBeUndefined();
    expect(mocks.db.departure.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "dep_1", bookedSeats: { lte: 10 } },
      }),
    );
  });

  it("count===0 → CapacityBelowBookedError (예약이 새 정원 초과)", async () => {
    mocks.db.departure.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      updateDeparture("dep_1", { ...baseForm, capacity: 2 }),
    ).rejects.toBeInstanceOf(CapacityBelowBookedError);
  });

  it("날짜 충돌(P2002) → DepartureDateConflictError", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "5",
    });
    mocks.db.departure.updateMany.mockRejectedValue(p2002);
    await expect(
      updateDeparture("dep_1", baseForm),
    ).rejects.toBeInstanceOf(DepartureDateConflictError);
  });
});

describe("transitionDepartureStatus — 가드", () => {
  it("findUnique null → DepartureNotFoundError (updateMany 미호출)", async () => {
    mocks.db.departure.findUnique.mockResolvedValue(null);
    await expect(
      transitionDepartureStatus("dep_missing", "CLOSED"),
    ).rejects.toBeInstanceOf(DepartureNotFoundError);
    expect(mocks.db.departure.updateMany).not.toHaveBeenCalled();
  });

  it("불가능한 전이 → InvalidDepartureTransitionError (DB 미접근)", async () => {
    mocks.db.departure.findUnique.mockResolvedValue({
      status: "CANCELED",
      bookedSeats: 0,
    });
    await expect(
      transitionDepartureStatus("dep_1", "SCHEDULED"),
    ).rejects.toBeInstanceOf(InvalidDepartureTransitionError);
    expect(mocks.db.departure.updateMany).not.toHaveBeenCalled();
  });

  it("CLOSED 정상 전이 → updateMany(status 가드) count 1 성공", async () => {
    mocks.db.departure.findUnique.mockResolvedValue({
      status: "SCHEDULED",
      bookedSeats: 5,
    });
    mocks.db.departure.updateMany.mockResolvedValue({ count: 1 });
    await expect(
      transitionDepartureStatus("dep_1", "CLOSED"),
    ).resolves.toBeUndefined();
    expect(mocks.db.departure.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "dep_1", status: "SCHEDULED" },
      }),
    );
  });

  it("CANCELED인데 bookedSeats>0 → DepartureHasBookingsError (D1)", async () => {
    mocks.db.departure.findUnique
      .mockResolvedValueOnce({ status: "SCHEDULED", bookedSeats: 3 })
      .mockResolvedValueOnce({ bookedSeats: 3 });
    mocks.db.departure.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      transitionDepartureStatus("dep_1", "CANCELED"),
    ).rejects.toBeInstanceOf(DepartureHasBookingsError);
    expect(mocks.db.departure.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "dep_1", status: "SCHEDULED", bookedSeats: 0 },
      }),
    );
  });

  it("count===0 + 취소 아님 → StaleDepartureStatusError (동시 전이)", async () => {
    mocks.db.departure.findUnique
      .mockResolvedValueOnce({ status: "SCHEDULED", bookedSeats: 0 })
      .mockResolvedValueOnce({ bookedSeats: 0 });
    mocks.db.departure.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      transitionDepartureStatus("dep_1", "CLOSED"),
    ).rejects.toBeInstanceOf(StaleDepartureStatusError);
  });
});
