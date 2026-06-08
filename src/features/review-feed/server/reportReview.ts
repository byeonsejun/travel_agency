"use server";

import { createReviewReport } from "@/entities/review";
import { auth } from "@/features/auth/server/auth";
import { withRateLimitAction } from "@/shared/lib/rate-limit";

import { ReportInputSchema, type ReportInput } from "../model/reportSchema";

export type ReportResult =
  | { ok: true; status: "created" | "duplicate" }
  | {
      ok: false;
      error: "UNAUTHENTICATED" | "SELF" | "NOT_FOUND" | "INVALID" | "RATE_LIMITED";
    };

// 사용자 리뷰 신고. auth 가드 → Zod → entities 멱등 mutation 위임.
// 캐시 무효화 없음 — 신고는 리뷰 노출을 바꾸지 않는다(spec D1).
async function reportReviewImpl(input: ReportInput): Promise<ReportResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "UNAUTHENTICATED" };

  const parsed = ReportInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID" };

  const outcome = await createReviewReport({
    reviewId: parsed.data.reviewId,
    reporterId: userId,
    reason: parsed.data.reason,
    note: parsed.data.note,
  });

  switch (outcome) {
    case "created":
      return { ok: true, status: "created" };
    case "duplicate":
      return { ok: true, status: "duplicate" };
    case "self":
      return { ok: false, error: "SELF" };
    case "not_found":
      return { ok: false, error: "NOT_FOUND" };
  }
}

// mutation tier (20/min, userFirst — 미인증은 내부 가드가 UNAUTHENTICATED 반환).
export const reportReviewAction = withRateLimitAction<[ReportInput], ReportResult>(
  {
    tier: "mutation",
    resolveUserId: async () => (await auth())?.user?.id ?? null,
    onBlock: (): ReportResult => ({ ok: false, error: "RATE_LIMITED" }),
  },
  reportReviewImpl,
);
