import { z } from "zod";

// admin 은 PUBLISHED|HIDDEN 으로만 전환 (REPORTED 는 시스템/신고 경로 전용).
export const SetReviewStatusSchema = z.object({
  reviewId: z.string().cuid(),
  next: z.enum(["PUBLISHED", "HIDDEN"]),
});

export type SetReviewStatusInput = z.infer<typeof SetReviewStatusSchema>;

export const ReportModerationSchema = z.object({
  reviewId: z.string().cuid(),
});

export type ReportModerationInput = z.infer<typeof ReportModerationSchema>;
