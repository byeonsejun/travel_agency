import { z } from "zod";

// Prisma ReportReason 과 1:1. enum 값 순서·철자 동기 유지.
export const REPORT_REASONS = [
  "SPAM",
  "ABUSIVE",
  "IRRELEVANT",
  "PRIVACY",
  "OTHER",
] as const;

export const REPORT_REASON_LABELS: Record<
  (typeof REPORT_REASONS)[number],
  string
> = {
  SPAM: "스팸/광고",
  ABUSIVE: "욕설/비방",
  IRRELEVANT: "관련 없는 내용",
  PRIVACY: "개인정보 노출",
  OTHER: "기타",
};

export const ReportInputSchema = z.object({
  reviewId: z.string().cuid(),
  reason: z.enum(REPORT_REASONS),
  note: z.string().max(500).optional(),
});

export type ReportInput = z.infer<typeof ReportInputSchema>;
