import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  cancelBookingByUser: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/features/auth/server/auth", () => ({ auth: mocks.auth }));
vi.mock("@/entities/booking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/booking")>();
  return {
    ...actual,
    cancelBookingByUser: mocks.cancelBookingByUser,
  };
});
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { cancelBookingAction } from "../actions";
import { ForbiddenError } from "@/entities/booking";
import { InvalidTransitionError } from "@/entities/booking";

const USER_ID = "cluser0000000000000000001";
const BOOKING_ID = "clbooking000000000000001";

describe("cancelBookingAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: USER_ID } });
  });

  it("로그인되지 않았으면 즉시 거부 (도메인 호출 0회)", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    const res = await cancelBookingAction(null, {
      bookingId: BOOKING_ID,
      reason: "일정 변경",
    });
    expect(res).toEqual({ type: "error", message: "로그인이 필요합니다" });
    expect(mocks.cancelBookingByUser).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("bookingId가 cuid 형식이 아니면 거부", async () => {
    const res = await cancelBookingAction(null, {
      bookingId: "not-a-cuid",
      reason: "일정 변경",
    });
    expect(res.type).toBe("error");
    expect(mocks.cancelBookingByUser).not.toHaveBeenCalled();
  });

  it("빈 reason은 거부 (Zod min(1))", async () => {
    const res = await cancelBookingAction(null, {
      bookingId: BOOKING_ID,
      reason: "   ",
    });
    expect(res.type).toBe("error");
    expect(mocks.cancelBookingByUser).not.toHaveBeenCalled();
  });

  it("ForbiddenError 발생 시 사용자 친화 메시지", async () => {
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
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("InvalidTransitionError 발생 시 명확한 메시지", async () => {
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
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("성공 시 /mypage + /bookings/[id] 두 경로 모두 revalidate", async () => {
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
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/mypage");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      `/bookings/${BOOKING_ID}`
    );
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);
  });

  it("예상치 못한 예외는 일반 메시지로 fallback (도메인 details 누설 차단)", async () => {
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
