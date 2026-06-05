"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/features/auth/server/auth";
import { refundTraveler, PaymentError } from "@/entities/payment";

export const TravelerCancelSchema = z.object({
  bookingId: z.string().min(1),
  travelerIds: z.array(z.string().min(1)).min(1),
  applyPenalty: z.boolean(),
  reason: z.string().optional(),
});

export type TravelerCancelInput = z.infer<typeof TravelerCancelSchema>;
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
