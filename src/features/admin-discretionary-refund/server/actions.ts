"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/features/auth/server/auth";
import { refundDiscretionary, PaymentError } from "@/entities/payment";

export const DiscretionaryRefundSchema = z.object({
  paymentId: z.string().min(1),
  bookingId: z.string().min(1),
  amount: z.number().int().positive(),
  requestId: z.string().min(1),
  reason: z.string().optional(),
});

export type DiscretionaryRefundInput = z.infer<typeof DiscretionaryRefundSchema>;
export type DiscretionaryRefundState =
  | { type: "success"; bookingId: string }
  | { type: "error"; message: string };

export async function discretionaryRefundAction(
  _prev: DiscretionaryRefundState | null,
  input: DiscretionaryRefundInput
): Promise<DiscretionaryRefundState> {
  const session = await auth();
  if (!session?.user?.id) return { type: "error", message: "관리자 로그인이 필요합니다" };
  if (session.user.role !== "ADMIN") return { type: "error", message: "권한 없음" };

  const data = DiscretionaryRefundSchema.safeParse(input);
  if (!data.success) return { type: "error", message: "입력값 오류" };

  try {
    await refundDiscretionary({
      ...data.data,
      actor: `admin:${session.user.id}`,
    });
    revalidatePath(`/admin/bookings/${data.data.bookingId}`);
    return { type: "success", bookingId: data.data.bookingId };
  } catch (err) {
    if (err instanceof PaymentError) return { type: "error", message: err.code };
    return { type: "error", message: "환불 처리 실패" };
  }
}
