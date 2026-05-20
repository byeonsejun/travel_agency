"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { auth } from "@/features/auth/server/auth";
import {
  cancelBookingByAgency,
  InvalidTransitionError,
} from "@/entities/booking";
import { refundBooking, PaymentError } from "@/entities/payment";
import { tagDeparturesByProduct } from "@/entities/departure";
import { db } from "@/shared/lib/db";
import { AdminCancelBookingSchema } from "../model/schemas";
import type { AdminCancelBookingInput } from "../model/schemas";

export type AdminCancelBookingState =
  | { type: "success"; bookingId: string }
  | { type: "deferred"; bookingId: string; message: string }
  | { type: "error"; message: string };

/**
 * 관리자 직권 예약 취소 Server Action.
 *
 * 보안 책임:
 *   1) auth() + role === "ADMIN" 가드 (middleware /admin/* 보호와 belt-and-suspenders)
 *   2) Zod 입력 검증
 *   3) PAID payment 존재 시 refundBooking 경로 — booking은 CANCELED_BY_AGENCY로 전이
 *      (RefundJob 생성 시 actor="admin:${adminId}" 보존 → worker가 정확히 분기)
 *   4) PAID 없으면 cancelBookingByAgency 직접 호출 — 단순 booking 전이
 *
 * features/booking-cancel의 사용자 자가 취소와 정확히 같은 dispatch 패턴
 * (ADR-0002). 다른 점은 권한 게이트(ADMIN role)와 booking 전이 대상 status뿐.
 */
export async function adminCancelBookingAction(
  _prev: AdminCancelBookingState | null,
  input: AdminCancelBookingInput
): Promise<AdminCancelBookingState> {
  // 1. ADMIN role 가드
  const session = await auth();
  if (!session?.user?.id) {
    return { type: "error", message: "관리자 로그인이 필요합니다" };
  }
  if (session.user.role !== "ADMIN") {
    return { type: "error", message: "관리자 권한이 필요합니다" };
  }
  const adminId = session.user.id;

  // 2. Zod 검증
  const parsed = AdminCancelBookingSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요";
    return { type: "error", message: first };
  }
  const { bookingId, reason } = parsed.data;

  // 3. booking 존재 여부 + PAID payment + productId 단일 round-trip 조회
  //    (관리자라 소유권 검증은 불필요, 다만 booking 부재만 확인)
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      departure: { select: { productId: true } },
      payments: {
        where: { status: "PAID" },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!booking) {
    return { type: "error", message: "예약을 찾을 수 없습니다" };
  }
  const hasPaidPayment = booking.payments.length > 0;
  const productId = booking.departure.productId;

  // 4. 도메인 위임 — dispatch
  try {
    if (hasPaidPayment) {
      // refund 경로: PG 취소 + Payment CANCELED + booking 전이
      // RefundJob.actor에 "admin:..." 저장 → worker가 booking을 CANCELED_BY_AGENCY로 분기 (ADR-0005)
      await refundBooking({
        bookingId,
        actor: `admin:${adminId}`,
        reason,
      });
    } else {
      // 결제 전 예약: 단순 booking 전이
      await cancelBookingByAgency({ bookingId, adminId, reason });
    }
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return { type: "error", message: "현재 상태에서는 취소할 수 없습니다" };
    }
    if (err instanceof PaymentError) {
      if (err.code === "REFUND_DEFERRED") {
        revalidatePath(`/admin/bookings/${bookingId}`);
        return {
          type: "deferred",
          bookingId,
          message:
            "환불 처리가 지연되고 있습니다. 자가 치유 큐가 자동으로 재시도합니다.",
        };
      }
      if (err.code === "REFUND_ALREADY_REQUESTED") {
        return {
          type: "error",
          message: "이미 환불 요청이 진행 중입니다",
        };
      }
      if (err.code === "BOOKING_NOT_REFUNDABLE") {
        return { type: "error", message: "현재 상태에서는 환불할 수 없습니다" };
      }
      if (err.code === "PAID_PAYMENT_NOT_FOUND") {
        return {
          type: "error",
          message: "결제 정보가 확인되지 않아 환불을 진행할 수 없습니다",
        };
      }
    }
    return {
      type: "error",
      message: "취소 처리에 실패했습니다. 잠시 후 다시 시도해 주세요",
    };
  }

  // 5. 캐시 무효화 — admin 페이지 + 해당 user의 마이페이지/상세 + PDP 좌석
  revalidateTag(tagDeparturesByProduct(productId));
  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${bookingId}`);
  revalidatePath("/mypage");
  revalidatePath(`/bookings/${bookingId}`);
  revalidatePath(`/products/${productId}`);

  return { type: "success", bookingId };
}
