import { z } from "zod";

// agency 취소는 책임 근거가 분명해야 하므로 사용자 자가 취소(min 1)보다 강한
// 하한(min 5자)을 적용. 200자 상한은 동일.
export const AdminCancelBookingSchema = z.object({
  bookingId: z.string().cuid(),
  reason: z
    .string()
    .trim()
    .min(5, "관리자 취소 사유는 최소 5자 이상 입력해야 합니다")
    .max(200, "취소 사유는 200자 이내로 입력해 주세요"),
  waivePenalty: z.boolean().default(false),
});

export type AdminCancelBookingInput = z.infer<typeof AdminCancelBookingSchema>;
