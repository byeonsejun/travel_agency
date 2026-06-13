import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  cancelBookingByUser: vi.fn(),
  refundBooking: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  db: {
    booking: { findUnique: vi.fn() },
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
vi.mock("@/entities/booking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/booking")>();
  return {
    ...actual,
    cancelBookingByUser: mocks.cancelBookingByUser,
  };
});
vi.mock("@/entities/payment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/payment")>();
  return {
    ...actual,
    refundBooking: mocks.refundBooking,
  };
});
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  updateTag: mocks.updateTag,
  // entities/departure가 use cache를 사용하므로 테스트에선 wrap 없이 통과.
  unstable_cache: <T extends (...a: never[]) => unknown>(fn: T) => fn,
}));
// @/entities/payment 배럴이 refund.ts → tossClient → env로 연쇄 import 되므로
// 테스트 컨텍스트에서 env 검증을 우회. PaymentError class는 importOriginal에서 그대로.
vi.mock("@/shared/lib/env", () => ({
  env: {
    NODE_ENV: "test",
    TOSS_API_BASE_URL: "http://localhost:4242",
    TOSS_SECRET_KEY: "test_sk_xxx",
    OBSERVABILITY_LOG_LEVEL: "error",
  },
}));

import { cancelBookingAction } from "../actions";
import { ForbiddenError, InvalidTransitionError } from "@/entities/booking";
import { PaymentError } from "@/entities/payment";

const USER_ID = "cluser0000000000000000001";
const BOOKING_ID = "clbooking000000000000001";
const PAYMENT_ID = "clpayment00000000000001";
const PRODUCT_ID = "clproduct00000000000001";

// ── 헬퍼: 소유권 가드 결과 모킹 ─────────────────────────────────────
function mockOwned(opts: { paid: boolean; ownedByUser?: boolean }) {
  if (opts.ownedByUser === false) {
    mocks.db.booking.findUnique.mockResolvedValueOnce(null);
    return;
  }
  mocks.db.booking.findUnique.mockResolvedValueOnce({
    id: BOOKING_ID,
    departure: { productId: PRODUCT_ID },
    payments: opts.paid ? [{ id: PAYMENT_ID }] : [],
  });
}

describe("cancelBookingAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: USER_ID } });
  });

  // ── 입력 / 인증 ─────────────────────────────────────────────────
  it("로그인되지 않았으면 즉시 거부 (도메인 호출 0회)", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    const res = await cancelBookingAction(null, {
      bookingId: BOOKING_ID,
      reason: "일정 변경",
    });
    expect(res).toEqual({ type: "error", message: "로그인이 필요합니다" });
    expect(mocks.cancelBookingByUser).not.toHaveBeenCalled();
    expect(mocks.refundBooking).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("bookingId가 cuid 형식이 아니면 거부", async () => {
    const res = await cancelBookingAction(null, {
      bookingId: "not-a-cuid",
      reason: "일정 변경",
    });
    expect(res.type).toBe("error");
    expect(mocks.cancelBookingByUser).not.toHaveBeenCalled();
    expect(mocks.refundBooking).not.toHaveBeenCalled();
  });

  it("빈 reason은 거부 (Zod min(1) after trim)", async () => {
    const res = await cancelBookingAction(null, {
      bookingId: BOOKING_ID,
      reason: "   ",
    });
    expect(res.type).toBe("error");
    expect(mocks.cancelBookingByUser).not.toHaveBeenCalled();
    expect(mocks.refundBooking).not.toHaveBeenCalled();
  });

  // ── 소유권 가드 ─────────────────────────────────────────────────
  it("소유자가 아니면 도메인 호출 0회 + 본인 안내", async () => {
    mockOwned({ paid: false, ownedByUser: false });
    const res = await cancelBookingAction(null, {
      bookingId: BOOKING_ID,
      reason: "일정 변경",
    });
    expect(res).toEqual({
      type: "error",
      message: "본인의 예약만 취소할 수 있습니다",
    });
    expect(mocks.cancelBookingByUser).not.toHaveBeenCalled();
    expect(mocks.refundBooking).not.toHaveBeenCalled();
  });

  // ── Dispatch: PAID 없음 → cancelBookingByUser ────────────────────
  it("PAID payment가 없으면 cancelBookingByUser로 dispatch (refund 0회)", async () => {
    mockOwned({ paid: false });
    mocks.cancelBookingByUser.mockResolvedValueOnce({ id: BOOKING_ID });
    const res = await cancelBookingAction(null, {
      bookingId: BOOKING_ID,
      reason: "일정 변경",
    });
    expect(res).toEqual({ type: "success", bookingId: BOOKING_ID });
    expect(mocks.cancelBookingByUser).toHaveBeenCalledWith({
      bookingId: BOOKING_ID,
      userId: USER_ID,
      reason: "일정 변경",
    });
    expect(mocks.refundBooking).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/mypage");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/bookings/${BOOKING_ID}`);
    // 좌석이 복원되므로 PDP 캐시도 동시에 무효화되어야 한다
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/products/${PRODUCT_ID}`);
  });

  // ── Dispatch: PAID 있음 → refundBooking ──────────────────────────
  it("PAID payment가 있으면 refundBooking으로 dispatch (cancelBookingByUser 0회)", async () => {
    mockOwned({ paid: true });
    mocks.refundBooking.mockResolvedValueOnce(undefined);
    const res = await cancelBookingAction(null, {
      bookingId: BOOKING_ID,
      reason: "개인 사정으로 인한 취소",
    });
    expect(res).toEqual({ type: "success", bookingId: BOOKING_ID });
    expect(mocks.refundBooking).toHaveBeenCalledWith({
      bookingId: BOOKING_ID,
      actor: `user:${USER_ID}`,
      reason: "개인 사정으로 인한 취소",
      applyPenalty: true,
    });
    expect(mocks.cancelBookingByUser).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/mypage");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/bookings/${BOOKING_ID}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/products/${PRODUCT_ID}`);
  });

  // ── refund 분기의 에러 매핑 ──────────────────────────────────────
  it("REFUND_DEFERRED는 deferred 상태로 반환 + booking detail만 revalidate", async () => {
    mockOwned({ paid: true });
    mocks.refundBooking.mockRejectedValueOnce(
      new PaymentError("REFUND_DEFERRED", { cause: "ECONNRESET" })
    );
    const res = await cancelBookingAction(null, {
      bookingId: BOOKING_ID,
      reason: "일정 변경",
    });
    expect(res.type).toBe("deferred");
    if (res.type === "deferred") {
      expect(res.bookingId).toBe(BOOKING_ID);
      expect(res.message).toContain("지연");
    }
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/bookings/${BOOKING_ID}`);
    // /mypage는 부르지 않는다 — booking이 아직 PAID라 마이페이지 카드는 변화 없음
    expect(mocks.revalidatePath).not.toHaveBeenCalledWith("/mypage");
  });

  it("REFUND_ALREADY_REQUESTED는 진행 중 안내", async () => {
    mockOwned({ paid: true });
    mocks.refundBooking.mockRejectedValueOnce(
      new PaymentError("REFUND_ALREADY_REQUESTED", { existingStatus: "PENDING" })
    );
    const res = await cancelBookingAction(null, {
      bookingId: BOOKING_ID,
      reason: "일정 변경",
    });
    expect(res.type).toBe("error");
    if (res.type === "error") {
      expect(res.message).toContain("이미 환불 요청");
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("PAID_PAYMENT_NOT_FOUND은 사용자 친화 메시지", async () => {
    mockOwned({ paid: true });
    mocks.refundBooking.mockRejectedValueOnce(
      new PaymentError("PAID_PAYMENT_NOT_FOUND")
    );
    const res = await cancelBookingAction(null, {
      bookingId: BOOKING_ID,
      reason: "일정 변경",
    });
    expect(res.type).toBe("error");
    if (res.type === "error") {
      expect(res.message).toContain("결제 정보");
    }
  });

  // ── cancel 분기의 에러 매핑 (기존) ───────────────────────────────
  it("ForbiddenError 발생 시 사용자 친화 메시지", async () => {
    mockOwned({ paid: false });
    mocks.cancelBookingByUser.mockRejectedValueOnce(
      new ForbiddenError("본인의 예약만 취소할 수 있습니다")
    );
    const res = await cancelBookingAction(null, {
      bookingId: BOOKING_ID,
      reason: "일정 변경",
    });
    expect(res).toEqual({
      type: "error",
      message: "본인의 예약만 취소할 수 있습니다",
    });
  });

  it("InvalidTransitionError 발생 시 명확한 메시지", async () => {
    mockOwned({ paid: false });
    mocks.cancelBookingByUser.mockRejectedValueOnce(
      new InvalidTransitionError("COMPLETED", "CANCELED_BY_USER")
    );
    const res = await cancelBookingAction(null, {
      bookingId: BOOKING_ID,
      reason: "기타 사유",
    });
    expect(res).toEqual({
      type: "error",
      message: "현재 상태에서는 취소할 수 없습니다",
    });
  });

  // ── fallback ─────────────────────────────────────────────────────
  it("예상치 못한 예외는 일반 메시지로 fallback (도메인 details 누설 차단)", async () => {
    mockOwned({ paid: false });
    mocks.cancelBookingByUser.mockRejectedValueOnce(
      new Error("DB connection lost")
    );
    const res = await cancelBookingAction(null, {
      bookingId: BOOKING_ID,
      reason: "기타 사유",
    });
    expect(res.type).toBe("error");
    if (res.type === "error") {
      expect(res.message).not.toContain("DB connection");
    }
  });
});
