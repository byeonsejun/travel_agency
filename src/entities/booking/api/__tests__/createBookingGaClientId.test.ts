/**
 * TDD: 예약 생성 시 GA4 client_id 스냅샷 (ADR-0062)
 * createBooking 이 입력 gaClientId 를 booking.create data 에 그대로 저장하는지 확인.
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

describe("createBooking — GA4 client_id 스냅샷", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.booking.create.mockResolvedValue({ id: "clbk00000000000001" });
    mocks.tx.bookingEvent.create.mockResolvedValue({});
  });

  function createdData(): { gaClientId?: string | null } {
    return (mocks.tx.booking.create.mock.calls[0][0] as { data: { gaClientId?: string | null } }).data;
  }

  it("gaClientId 를 booking 에 저장한다", async () => {
    await createBooking({ ...makeInput(), gaClientId: "123456789.1700000000" });
    expect(createdData().gaClientId).toBe("123456789.1700000000");
  });

  it("gaClientId 미전달(기존 호출부) 이면 null 로 저장 — 하위호환", async () => {
    await createBooking(makeInput());
    expect(createdData().gaClientId).toBeNull();
  });

  it("64자 초과 gaClientId 는 Zod 가 거부(쿠키 변조 방어)", async () => {
    await expect(createBooking({ ...makeInput(), gaClientId: "1".repeat(65) })).rejects.toThrow();
    expect(mocks.tx.booking.create).not.toHaveBeenCalled();
  });
});
