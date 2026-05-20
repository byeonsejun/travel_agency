import { z } from "zod";

// bookingId는 cuid, reason은 빈 문자열 차단(필수) + 200자 상한.
// 프리셋(CANCEL_REASON_PRESETS)에 한정하지 않고 자유 입력도 허용하되,
// trim 후 길이만 강제 — 이유 분류 통계는 별도 모듈 책임.
export const CancelBookingSchema = z.object({
  bookingId: z.string().cuid(),
  reason: z
    .string()
    .trim()
    .min(1, "취소 사유를 선택해 주세요")
    .max(200, "취소 사유는 200자 이내로 입력해 주세요"),
});

export type CancelBookingInput = z.infer<typeof CancelBookingSchema>;
