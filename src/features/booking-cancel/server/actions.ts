"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/features/auth/server/auth";
import {
  cancelBookingByUser,
  ForbiddenError,
  InvalidTransitionError,
} from "@/entities/booking";
import { CancelBookingSchema } from "../model/schemas";
import type { CancelBookingInput } from "../model/schemas";

export type CancelBookingState =
  | { type: "success"; bookingId: string }
  | { type: "error"; message: string };

/**
 * 사용자 자가 예약 취소 Server Action.
 *
 * 보안 책임 (CLAUDE.md §5 — Backend/Domain Booking):
 *   1) 세션 인증 — 미로그인은 즉시 거부.
 *   2) Zod 입력 검증 — 클라 신뢰 금지.
 *   3) 소유권/상태 검증은 cancelBookingByUser 내부에서 수행
 *      (DB findUnique + userId 비교 + assertTransition 화이트리스트).
 *   4) 좌석 환원·BookingEvent append는 transitionStatus의 단일 트랜잭션
 *      에서 보장. UI 레이어는 도메인 invariants에 손대지 않는다.
 *
 * TODO(payment-refund): 결제 상태가 PAID였던 경우 PG사 결제 취소 호출
 * (TossPayments cancel API)을 별도 모듈로 후속 트리거해야 한다. 현재
 * 단계는 booking 상태머신만 다루며, refund 도메인은 별 PR로 분리.
 * 연동 포인트: 성공 분기 이후 `payment` 엔티티의 refund mutation을 호출,
 * webhook 멱등성 키와 정합화 (idempotency by bookingId + cancelEventId).
 */
export async function cancelBookingAction(
  _prev: CancelBookingState | null,
  input: CancelBookingInput
): Promise<CancelBookingState> {
  // 1. 세션 가드
  const session = await auth();
  if (!session?.user?.id) {
    return { type: "error", message: "로그인이 필요합니다" };
  }

  // 2. Zod 검증
  const parsed = CancelBookingSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요";
    return { type: "error", message: first };
  }

  // 3. 도메인 위임 — 소유권/상태머신 검증은 내부에서
  try {
    await cancelBookingByUser({
      bookingId: parsed.data.bookingId,
      userId: session.user.id,
      reason: parsed.data.reason,
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { type: "error", message: "본인의 예약만 취소할 수 있습니다" };
    }
    if (err instanceof InvalidTransitionError) {
      return {
        type: "error",
        message: "현재 상태에서는 취소할 수 없습니다",
      };
    }
    return {
      type: "error",
      message: "취소 처리에 실패했습니다. 잠시 후 다시 시도해 주세요",
    };
  }

  // 4. 캐시 무효화 — 마이페이지 리스트 + 상세 페이지 둘 다 즉시 재검증.
  //    page-level dynamic=force-dynamic이라 ISR 캐시는 없지만, fetch
  //    캐시·Server Action 호출 후 router refresh를 강제하기 위해 호출.
  revalidatePath("/mypage");
  revalidatePath(`/bookings/${parsed.data.bookingId}`);

  return { type: "success", bookingId: parsed.data.bookingId };
}
