import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted: vi.mock factory보다 먼저 실행됨을 보장
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createBooking: vi.fn(),
  transitionStatus: vi.fn(),
  computeTotalPrice: vi.fn(),
  buildOrderId: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  db: {
    departure: { findUniqueOrThrow: vi.fn() },
    payment: { count: vi.fn() },
  },
}));

// withRateLimitAction을 투명 passthrough로 처리 — 액션 로직 단위 테스트에서 rate-limit 계층 분리
vi.mock("@/shared/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/lib/rate-limit")>();
  return {
    ...actual,
    withRateLimitAction: <Args extends unknown[], R>(
      _opts: unknown,
      handler: (...args: Args) => Promise<R>,
    ) => handler,
  };
});

vi.mock("@/features/auth/server/auth", () => ({ auth: mocks.auth }));
// importOriginal로 TravelerSchema 등 실제 exports 보존 — CheckoutFormSchema가 사용함
vi.mock("@/entities/booking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/booking")>();
  return {
    ...actual,
    createBooking: mocks.createBooking,
    transitionStatus: mocks.transitionStatus,
    computeTotalPrice: mocks.computeTotalPrice,
  };
});
vi.mock("@/entities/payment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/payment")>();
  return { ...actual, buildOrderId: mocks.buildOrderId };
});
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
vi.mock("@/shared/lib/env", () => ({
  env: { NODE_ENV: "test", TOSS_CLIENT_KEY: "test_ck_xxx" },
}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  updateTag: mocks.updateTag,
  unstable_cache: <T extends (...a: never[]) => unknown>(fn: T) => fn,
}));

import { createCheckoutBooking } from "../actions";

// ── 공통 픽스처 ─────────────────────────────────────────────────
const USER_ID = "cluser0000000000000000001";
const BOOKING_ID = "clbooking000000000000001";
const DEPARTURE_ID = "cldeparture00000000000001";
const ORDER_ID = `${BOOKING_ID}__1`;
const TOTAL_PRICE = 300_000;

const booker = {
  lastNameEn: "KIM",
  firstNameEn: "CHULSOO",
  gender: "MALE" as const,
  birthDate: new Date("1990-01-01"),
  role: "BOOKER" as const,
  email: "chulsoo@example.com",
};

const validInput = {
  departureId: DEPARTURE_ID,
  adultCount: 1,
  childCount: 0,
  infantCount: 0,
  travelers: [booker],
  termKeys: ["standard_overseas_v1"],
};

const mockBooking = {
  id: BOOKING_ID,
  userId: USER_ID,
  status: "RECEIVED" as const,
  totalPrice: TOTAL_PRICE,
  adultCount: 1,
  childCount: 0,
  infantCount: 0,
};

const PRODUCT_ID = "clproduct000000000000001";
const mockDeparturePrices = {
  priceAdult: TOTAL_PRICE,
  priceChild: 0,
  priceInfant: 0,
  productId: PRODUCT_ID,
};

describe("createCheckoutBooking", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // 기본 happy-path 세팅
    mocks.auth.mockResolvedValue({ user: { id: USER_ID } });
    mocks.db.departure.findUniqueOrThrow.mockResolvedValue(mockDeparturePrices);
    mocks.computeTotalPrice.mockReturnValue(TOTAL_PRICE);
    mocks.createBooking.mockResolvedValue(mockBooking);
    mocks.transitionStatus.mockResolvedValue({ ...mockBooking, status: "DEPARTURE_CONFIRMED" });
    mocks.db.payment.count.mockResolvedValue(0);
    mocks.buildOrderId.mockReturnValue(ORDER_ID);
  });

  // ── 시나리오 1: 미인증 ────────────────────────────────────────
  it("미인증 세션 → error UNAUTHORIZED, createBooking 미호출", async () => {
    mocks.auth.mockResolvedValue(null);

    const result = await createCheckoutBooking(null, validInput);

    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.message).toMatch(/unauthorized/i);
    }
    expect(mocks.createBooking).not.toHaveBeenCalled();
  });

  // ── 시나리오 2: Zod 유효성 실패 ──────────────────────────────
  it("adultCount=0 → error, DB 미접근", async () => {
    const result = await createCheckoutBooking(null, {
      ...validInput,
      adultCount: 0,
      travelers: [],
    });

    expect(result.type).toBe("error");
    expect(mocks.db.departure.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(mocks.createBooking).not.toHaveBeenCalled();
  });

  // ── 시나리오 3: 성공 — 핵심 계약 검증 ────────────────────────
  it("success: createBooking에 서버 계산 expectedTotalPrice 전달", async () => {
    const result = await createCheckoutBooking(null, validInput);

    expect(result.type).toBe("success");
    expect(mocks.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        expectedTotalPrice: TOTAL_PRICE, // 서버 재계산값 (computeTotalPrice mock 반환)
        departureId: DEPARTURE_ID,
      })
    );
  });

  // ── 시나리오 4: 성공 — DEPARTURE_CONFIRMED 전이 ──────────────
  it("success: transitionStatus(DEPARTURE_CONFIRMED) 호출", async () => {
    await createCheckoutBooking(null, validInput);

    expect(mocks.transitionStatus).toHaveBeenCalledWith({
      bookingId: BOOKING_ID,
      to: "DEPARTURE_CONFIRMED",
      actor: "system:checkout",
      reason: "checkout instant confirm",
    });
  });

  // ── 시나리오 5: 성공 — orderId 생성 (seq=기존결제수+1) ─────
  it("success: payment 0건이면 seq=1로 buildOrderId 호출", async () => {
    mocks.db.payment.count.mockResolvedValue(0);

    await createCheckoutBooking(null, validInput);

    expect(mocks.buildOrderId).toHaveBeenCalledWith(BOOKING_ID, 1);
  });

  it("재시도: payment 2건이면 seq=3으로 buildOrderId 호출", async () => {
    mocks.db.payment.count.mockResolvedValue(2);

    await createCheckoutBooking(null, validInput);

    expect(mocks.buildOrderId).toHaveBeenCalledWith(BOOKING_ID, 3);
  });

  // ── 시나리오 6: 성공 — 반환값 검증 ──────────────────────────
  it("success: bookingId, orderId, amount, customerName, customerEmail 반환", async () => {
    const result = await createCheckoutBooking(null, validInput);

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.bookingId).toBe(BOOKING_ID);
      expect(result.orderId).toBe(ORDER_ID);
      expect(result.amount).toBe(TOTAL_PRICE);
      expect(result.customerName).toContain("KIM");
      expect(result.customerEmail).toBe("chulsoo@example.com");
    }
  });

  // ── 시나리오 6b: 좌석 차감으로 인한 PDP ISR 캐시 무효화 ─────────
  it("success: revalidatePath('/products/${productId}') 호출 (PDP 캐시 무효화)", async () => {
    await createCheckoutBooking(null, validInput);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      `/products/${PRODUCT_ID}`
    );
  });

  // ── 시나리오 7: createBooking 실패 → error 반환 ──────────────
  it("createBooking throw → error 반환, transitionStatus 미호출", async () => {
    mocks.createBooking.mockRejectedValue(new Error("InsufficientCapacity"));

    const result = await createCheckoutBooking(null, validInput);

    expect(result.type).toBe("error");
    expect(mocks.transitionStatus).not.toHaveBeenCalled();
  });
});
