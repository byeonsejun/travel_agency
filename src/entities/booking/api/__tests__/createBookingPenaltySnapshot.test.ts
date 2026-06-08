/**
 * TDD: 예약 생성 시 활성 위약금 정책 스냅샷 검증
 *
 * createBooking이 $transaction 전에 resolvePenaltyPolicyKey + getActivePenaltyTiers로
 * 스냅샷을 해소하고, booking.create data에 penaltyPolicyKey / penaltyPolicyVersion을
 * 포함하는지 확인한다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- hoisted mocks ---
const mocks = vi.hoisted(() => {
  const tx = {
    booking: { create: vi.fn() },
    bookingEvent: { create: vi.fn() },
  };
  return { tx };
});

vi.mock("@/shared/lib/db", () => ({
  db: {
    departure: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        priceAdult: 1_000_000,
        priceChild: 700_000,
        priceInfant: 0,
        penaltyPolicyKey: "peak_season",
        product: { penaltyPolicyKey: "standard_overseas" },
      }),
    },
    $transaction: vi.fn().mockImplementation(
      (callback: (tx: typeof mocks.tx) => Promise<unknown>) => callback(mocks.tx),
    ),
  },
}));

vi.mock("../seatLock", () => ({
  reserveSeats: vi.fn().mockResolvedValue(undefined),
  releaseSeats: vi.fn().mockResolvedValue(undefined),
  InsufficientCapacityError: class extends Error {},
}));

vi.mock("@/shared/lib/email-job/enqueue", () => ({
  enqueueEmailJob: vi.fn(),
}));

vi.mock("@/entities/penalty-policy", () => ({
  resolvePenaltyPolicyKey: (p: string | null, d: string | null) => d ?? p ?? "standard_overseas",
  getActivePenaltyTiers: vi.fn().mockResolvedValue({ version: 2, tiers: [] }),
}));

import { createBooking } from "../mutations";

function makeInput() {
  return {
    departureId: "cldev00000000000001",
    userId: "cluse00000000000001",
    adultCount: 1,
    childCount: 0,
    infantCount: 0,
    expectedTotalPrice: 1_000_000,
    travelers: [
      {
        lastNameEn: "KIM",
        firstNameEn: "MINHO",
        gender: "MALE" as const,
        birthDate: new Date("1990-05-15"),
      },
    ],
    termKeys: ["term-privacy", "term-usage"],
  };
}

describe("createBooking — 위약금 정책 스냅샷", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.booking.create.mockResolvedValue({ id: "clbk00000000000001" });
    mocks.tx.bookingEvent.create.mockResolvedValue({});
  });

  it("예약 생성 시 활성 위약금 정책을 스냅샷한다 (departure 키 우선 + 활성 버전)", async () => {
    await createBooking(makeInput());

    expect(mocks.tx.booking.create).toHaveBeenCalledOnce();
    const callArg = mocks.tx.booking.create.mock.calls[0][0] as {
      data: { penaltyPolicyKey?: string; penaltyPolicyVersion?: number };
    };

    // departure 키("peak_season")가 product 키보다 우선되어야 한다
    expect(callArg.data.penaltyPolicyKey).toBe("peak_season");
    // getActivePenaltyTiers가 반환한 version=2가 스냅샷돼야 한다
    expect(callArg.data.penaltyPolicyVersion).toBe(2);
  });
});
