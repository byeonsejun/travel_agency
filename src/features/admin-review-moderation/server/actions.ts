"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/features/auth/server/auth";
import {
  setReviewStatus,
  InvalidReviewTransitionError,
} from "@/entities/review";
import {
  SetReviewStatusSchema,
  type SetReviewStatusInput,
} from "../model/schemas";

export type SetReviewStatusState =
  | { type: "success"; status: "PUBLISHED" | "HIDDEN" }
  | { type: "error"; message: string };

// admin 리뷰 모더레이션 토글. admin-booking-cancel 과 동일한 게이트 패턴.
// 핵심: status 변경 후 PDP ISR(revalidate=3600) 를 즉시 무효화 (스펙 D2) —
// 숨김 즉시 PDP 에서 사라지고, 복원 즉시 다시 노출.
export async function setReviewStatusAction(
  _prev: SetReviewStatusState | null,
  input: SetReviewStatusInput,
): Promise<SetReviewStatusState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { type: "error", message: "관리자 로그인이 필요합니다" };
  }
  if (session.user.role !== "ADMIN") {
    return { type: "error", message: "관리자 권한이 필요합니다" };
  }

  const parsed = SetReviewStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { type: "error", message: "입력값을 확인해 주세요" };
  }
  const { reviewId, next } = parsed.data;

  try {
    const result = await setReviewStatus(reviewId, next);
    if (!result) {
      return { type: "error", message: "리뷰를 찾을 수 없습니다" };
    }

    revalidatePath(`/products/${result.productId}`);
    revalidatePath("/admin/reviews");
    revalidatePath(`/admin/reviews/${reviewId}`);

    return { type: "success", status: next };
  } catch (err) {
    if (err instanceof InvalidReviewTransitionError) {
      return { type: "error", message: "현재 상태에서는 변경할 수 없습니다" };
    }
    return {
      type: "error",
      message: "상태 변경에 실패했습니다. 잠시 후 다시 시도해 주세요",
    };
  }
}
