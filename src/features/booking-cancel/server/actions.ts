"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { auth } from "@/features/auth/server/auth";
import {
  cancelBookingByUser,
  ForbiddenError,
  InvalidTransitionError,
} from "@/entities/booking";
import { refundBooking, PaymentError } from "@/entities/payment";
import { tagDeparturesByProduct } from "@/entities/departure";
import { db } from "@/shared/lib/db";
import { withRateLimitAction } from "@/shared/lib/rate-limit";
import { CancelBookingSchema } from "../model/schemas";
import type { CancelBookingInput } from "../model/schemas";

export type CancelBookingState =
  | { type: "success"; bookingId: string }
  | { type: "deferred"; bookingId: string; message: string }
  | { type: "error"; message: string };

/**
 * 사용자 자가 예약 취소 Server Action (구현체).
 *
 * 보안 책임 (CLAUDE.md §5 — Backend/Domain Booking):
 *   1) 세션 인증 — 미로그인 거부.
 *   2) Zod 입력 검증 — 클라 신뢰 금지.
 *   3) 소유권 사전 가드 + 도메인 함수 내부 재검증(defense in depth).
 *
 * Dispatch 로직 (PAID payment 존재 여부로 분기):
 *   - PAID 있음 → refundBooking: PG 취소 + Payment CANCELED + booking
 *     전이를 RefundJob 멱등성 키로 보호. PG 실패는 RefundJob PENDING
 *     으로 적재되어 cron worker가 재시도(self-healing).
 *   - PAID 없음(RECEIVED / DEPARTURE_CONFIRMED) → cancelBookingByUser:
 *     좌석 환원 + 상태 전이만 수행. refund 호출 0회.
 *
 * 트랜잭션 격리 (Domain R3):
 *   refundBooking은 외부 PG IO를 단일 DB Tx 안에 포함하지 않는다.
 *   PG 호출이 실패해도 Payment / Booking 상태는 변하지 않으며
 *   RefundJob만 PENDING으로 남아 backoff 재시도된다. 즉, 사용자가
 *   "취소했다"는 의도와 DB 상태가 절대 어긋나지 않는다.
 */
async function cancelBookingActionImpl(
  _prev: CancelBookingState | null,
  input: CancelBookingInput
): Promise<CancelBookingState> {
  // 1. 세션 가드
  const session = await auth();
  if (!session?.user?.id) {
    return { type: "error", message: "로그인이 필요합니다" };
  }
  const userId = session.user.id;

  // 2. Zod 검증
  const parsed = CancelBookingSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요";
    return { type: "error", message: first };
  }
  const { bookingId, reason } = parsed.data;

  // 3. 소유권 사전 가드 + PAID payment + productId 동시 조회 (단일 round-trip).
  //    refundBooking은 actor 문자열만 받으므로 ownership을 별도로 강제해야 한다.
  //    cancelBookingByUser 역시 내부에서 ownership을 재검증한다(defense in depth).
  //    productId는 좌석 복원 후 해당 PDP ISR 캐시를 무효화하는 데 사용.
  const owned = await db.booking.findUnique({
    where: { id: bookingId, userId },
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
  if (!owned) {
    return { type: "error", message: "본인의 예약만 취소할 수 있습니다" };
  }
  const hasPaidPayment = owned.payments.length > 0;
  const productId = owned.departure.productId;

  // 4. 도메인 위임 — dispatch
  try {
    if (hasPaidPayment) {
      // refund 경로: PG 취소 + Payment CANCELED + booking 전이 일괄 처리
      await refundBooking({
        bookingId,
        actor: `user:${userId}`,
        reason,
        applyPenalty: true, // 자가 취소 — 국외여행 표준약관 D-day 위약금 적용
      });
    } else {
      // 결제 전 취소: 단순 booking 전이 (좌석 환원은 transitionStatus 내부에서)
      await cancelBookingByUser({ bookingId, userId, reason });
    }
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { type: "error", message: "본인의 예약만 취소할 수 있습니다" };
    }
    if (err instanceof InvalidTransitionError) {
      return { type: "error", message: "현재 상태에서는 취소할 수 없습니다" };
    }
    if (err instanceof PaymentError) {
      // PG 통신 실패 → RefundJob에 PENDING으로 적재됨(자가 치유 큐).
      // booking은 아직 PAID 상태 유지 — 데이터 정합성 보존.
      if (err.code === "REFUND_DEFERRED") {
        // 캐시 재검증은 그래도 실행(RefundJob 상태 변화가 detail에 반영될 수 있음).
        revalidatePath(`/bookings/${bookingId}`);
        return {
          type: "deferred",
          bookingId,
          message:
            "환불 처리가 지연되고 있습니다. 잠시 후 자동으로 재시도되며, 결과는 마이페이지에서 확인할 수 있습니다.",
        };
      }
      if (err.code === "REFUND_ALREADY_REQUESTED") {
        return {
          type: "error",
          message: "이미 환불 요청이 진행 중입니다. 잠시 후 다시 확인해 주세요",
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
      // 그 외 PaymentError는 일반 메시지 (도메인 details 누설 차단)
    }
    return {
      type: "error",
      message: "취소 처리에 실패했습니다. 잠시 후 다시 시도해 주세요",
    };
  }

  // 5. 캐시 무효화 — 좌석이 복원되었으므로 데이터 캐시 + 페이지 캐시 모두 invalidate.
  //   - revalidateTag(product:[id]:departures): unstable_cache로 메모이즈된
  //     getDeparturesByProduct 결과를 직접 무효화 → 다음 PDP 요청은 신선한 좌석 수.
  //   - revalidatePath: 페이지 단위 ISR 캐시 무효화(현재는 layout dynamic으로 효과 제한적이나
  //     향후 PPR 도입 시 즉시 효과).
  revalidateTag(tagDeparturesByProduct(productId));
  revalidatePath("/mypage");
  revalidatePath(`/bookings/${bookingId}`);
  revalidatePath(`/products/${productId}`);

  return { type: "success", bookingId };
}

// ── Rate-limit 래퍼 ─────────────────────────────────────────────
// payment tier (10 req / 1 min).
// idStrategy를 userFirst로 재정의: 액션 자체에 auth 가드가 있어 미인증 시
// 우아한 에러를 반환한다. userOnly는 미인증 시 THROW → 500 이므로 사용 불가.
export const cancelBookingAction = withRateLimitAction<
  [CancelBookingState | null, CancelBookingInput],
  CancelBookingState
>(
  {
    tier: "payment",
    idStrategy: "userFirst",
    resolveUserId: async () => (await auth())?.user?.id ?? null,
    onBlock: (): CancelBookingState => ({
      type: "error",
      message: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
    }),
  },
  cancelBookingActionImpl,
);
