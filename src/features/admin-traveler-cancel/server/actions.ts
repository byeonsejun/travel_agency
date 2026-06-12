"use server";
import { revalidatePath } from "next/cache";
import { auth } from "@/features/auth/server/auth";
import { refundTraveler, PaymentError } from "@/entities/payment";
import { TravelerCancelSchema, type TravelerCancelInput } from "../model/schemas";

// "use server" 파일은 async 함수만 export 가능 → Zod 스키마는 ../model/schemas 로 분리.
// State 는 type-only(런타임 소거)라 여기 잔존 가능.
export type TravelerCancelState =
  | { type: "success"; bookingId: string }
  | { type: "error"; message: string };

export async function travelerCancelAction(
  _prev: TravelerCancelState | null,
  input: TravelerCancelInput
): Promise<TravelerCancelState> {
  const session = await auth();
  if (!session?.user?.id) return { type: "error", message: "관리자 로그인이 필요합니다" };
  if (session.user.role !== "ADMIN") return { type: "error", message: "권한 없음" };

  const data = TravelerCancelSchema.safeParse(input);
  if (!data.success) return { type: "error", message: "입력값 오류" };

  try {
    await refundTraveler({
      ...data.data,
      actor: `admin:${session.user.id}`,
    });
    revalidatePath(`/admin/bookings/${data.data.bookingId}`);
    return { type: "success", bookingId: data.data.bookingId };
  } catch (err) {
    if (err instanceof PaymentError) return { type: "error", message: err.code };
    return { type: "error", message: "여행자 취소 처리 실패" };
  }
}
