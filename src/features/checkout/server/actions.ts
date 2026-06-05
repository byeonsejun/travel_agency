"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { auth } from "@/features/auth/server/auth";
import {
  createBooking,
  transitionStatus,
  computeTotalPrice,
} from "@/entities/booking";
import { buildOrderId } from "@/entities/payment";
import { tagDeparturesByProduct } from "@/entities/departure";
import { db } from "@/shared/lib/db";
import { withRateLimitAction } from "@/shared/lib/rate-limit";
import { CheckoutFormSchema } from "../model/schemas";
import type { CheckoutFormInput } from "../model/schemas";
import { nextOrderSeq } from "./orderSeq";

// ── 반환 타입 ───────────────────────────────────────────────────
export type CheckoutActionSuccess = {
  type: "success";
  bookingId: string;
  orderId: string;
  amount: number;
  customerName: string;
  customerEmail: string | null;
};

export type CheckoutActionError = {
  type: "error";
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export type CheckoutActionState = CheckoutActionSuccess | CheckoutActionError;

// ── Server Action (구현체) ──────────────────────────────────────
async function createCheckoutBookingImpl(
  _prevState: CheckoutActionState | null,
  input: CheckoutFormInput
): Promise<CheckoutActionState> {
  // Step 1: 인증 가드 (Backend R3-3)
  const session = await auth();
  if (!session?.user?.id) {
    return { type: "error", message: "Unauthorized — 로그인이 필요합니다" };
  }
  const userId = session.user.id;

  // Step 2: Zod 검증 (Backend R3-1 / Frontend R8: 클라 검증 불신)
  const parsed = CheckoutFormSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { type: "error", message: "입력값을 확인해 주세요", fieldErrors };
  }
  const data = parsed.data;

  // Step 3: 가격 서버 재계산 — 클라이언트 입력 금액 절대 미신뢰 (Domain R6).
  //         productId는 booking 생성 후 PDP 캐시(ISR 3600s) 무효화에 사용.
  const departure = await db.departure.findUniqueOrThrow({
    where: { id: data.departureId },
    select: {
      priceAdult: true,
      priceChild: true,
      priceInfant: true,
      productId: true,
    },
  });
  const expectedTotalPrice = computeTotalPrice({
    priceAdult: departure.priceAdult,
    priceChild: departure.priceChild,
    priceInfant: departure.priceInfant,
    adultCount: data.adultCount,
    childCount: data.childCount,
    infantCount: data.infantCount,
  });

  // Step 4: 예약 생성 (좌석 CAS 차감 + travelers + terms, 단일 Tx — Domain R1)
  let booking;
  try {
    booking = await createBooking({
      userId,
      departureId: data.departureId,
      adultCount: data.adultCount,
      childCount: data.childCount,
      infantCount: data.infantCount,
      expectedTotalPrice,
      travelers: data.travelers,
      termKeys: data.termKeys,
      notes: data.notes,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "예약 생성에 실패했습니다";
    return { type: "error", message };
  }

  // Step 5: RECEIVED → DEPARTURE_CONFIRMED 즉시 전이 (D1: MVP — 그룹 형성 비범위)
  //         assertTransition은 transitionStatus 내부에서 강제됨 (Domain R5)
  try {
    await transitionStatus({
      bookingId: booking.id,
      to: "DEPARTURE_CONFIRMED",
      actor: "system:checkout",
      reason: "checkout instant confirm",
    });
  } catch (err) {
    return {
      type: "error",
      message: "예약 상태 전이에 실패했습니다. 잠시 후 다시 시도해 주세요",
    };
  }

  // Step 6: orderId 생성 — 재시도 시 seq 증가로 PG 409 회피 (D3)
  const paymentCount = await db.payment.count({ where: { bookingId: booking.id } });
  const seq = nextOrderSeq(paymentCount);
  const orderId = buildOrderId(booking.id, seq);

  // Step 7: 고객 정보 추출 (BOOKER 우선, 없으면 첫 번째 여행자) — 결제창 표시용
  const booker =
    data.travelers.find((t) => t.role === "BOOKER") ?? data.travelers[0]!;
  const customerName = `${booker.firstNameEn} ${booker.lastNameEn}`;
  const customerEmail = booker.email ?? null;

  // Step 8: 좌석이 차감되었으므로 캐시를 즉시 무효화한다.
  //   - revalidateTag(`product:${productId}:departures`)
  //       → getDeparturesByProduct unstable_cache 엔트리 무효화 (PDP의 좌석 표)
  //   - revalidatePath(`/products/${productId}`)
  //       → 페이지 자체 ISR 캐시 무효화 (force-dynamic 해제 후 의미를 가짐)
  //   타 사용자가 stale 좌석 수를 보고 매진 직전 예약을 시도하는 회귀를 차단.
  revalidateTag(tagDeparturesByProduct(departure.productId));
  revalidatePath(`/products/${departure.productId}`);

  return {
    type: "success",
    bookingId: booking.id,
    orderId,
    amount: booking.totalPrice,
    customerName,
    customerEmail,
  };
}

// ── Rate-limit 래퍼 ─────────────────────────────────────────────
// payment tier (10 req / 1 min).
// idStrategy를 userFirst로 재정의: 액션 자체에 auth 가드가 있어 미인증 시
// 우아한 에러를 반환한다. userOnly는 미인증 시 THROW → 500 이므로 사용 불가.
export const createCheckoutBooking = withRateLimitAction<
  [CheckoutActionState | null, CheckoutFormInput],
  CheckoutActionState
>(
  {
    tier: "payment",
    idStrategy: "userFirst",
    resolveUserId: async () => (await auth())?.user?.id ?? null,
    onBlock: (): CheckoutActionState => ({
      type: "error",
      message: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
    }),
  },
  createCheckoutBookingImpl,
);
