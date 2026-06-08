import { Prisma, type ReviewStatus, type ReportReason } from "@prisma/client";

import { db } from "@/shared/lib/db";

import { assertReviewTransition } from "../model/transitions";

// 모더레이션 status 변경. 돈·좌석이 아니라 admin 단독 작업이므로 TOCTOU 비크리티컬 —
// 현재 status 조회 → 전이 가드 → update 의 단순 흐름으로 충분.
// 캐시 무효화에 쓸 productId 를 반환한다 (호출 feature 가 revalidatePath).
// 리뷰 부재 시 null 반환.
export async function setReviewStatus(
  id: string,
  next: ReviewStatus,
): Promise<{ productId: string } | null> {
  const current = await db.review.findUnique({
    where: { id },
    select: { status: true, productId: true },
  });
  if (!current) return null;

  assertReviewTransition(current.status, next); // 위반 시 throw

  await db.review.update({
    where: { id },
    data: { status: next },
  });
  return { productId: current.productId };
}

// 사용자 신고 생성. 멱등 — 같은 (review, reporter) 재신고는 P2002 를 duplicate 로
// 흡수(에러 아님). 본인 리뷰는 self 로 차단. 돈·좌석 아니므로 TOCTOU 비크리티컬.
export async function createReviewReport(input: {
  reviewId: string;
  reporterId: string;
  reason: ReportReason;
  note?: string;
}): Promise<"created" | "duplicate" | "self" | "not_found"> {
  const review = await db.review.findUnique({
    where: { id: input.reviewId },
    select: { userId: true },
  });
  if (!review) return "not_found";
  if (review.userId === input.reporterId) return "self";

  try {
    await db.reviewReport.create({
      data: {
        reviewId: input.reviewId,
        reporterId: input.reporterId,
        reason: input.reason,
        note: input.note ?? null,
      },
    });
    return "created";
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return "duplicate";
    }
    throw e;
  }
}

// 신고 인정: 리뷰를 숨기고(PUBLISHED→HIDDEN 전이 가드) OPEN 신고를 일괄 RESOLVED.
// 숨김+신고종결을 단일 tx 로 묶어 부분 적용 방지. 이미 HIDDEN 이면 전이 가드 throw.
export async function resolveReportsByHiding(
  reviewId: string,
): Promise<{ productId: string } | null> {
  const review = await db.review.findUnique({
    where: { id: reviewId },
    select: { status: true, productId: true },
  });
  if (!review) return null;

  assertReviewTransition(review.status, "HIDDEN"); // 위반 시 throw

  await db.$transaction([
    db.review.update({ where: { id: reviewId }, data: { status: "HIDDEN" } }),
    db.reviewReport.updateMany({
      where: { reviewId, status: "OPEN" },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    }),
  ]);
  return { productId: review.productId };
}

// 신고 반려: OPEN 신고만 DISMISSED 로 종결. 리뷰 status 불변(노출 유지).
export async function dismissReports(
  reviewId: string,
): Promise<{ productId: string } | null> {
  const review = await db.review.findUnique({
    where: { id: reviewId },
    select: { productId: true },
  });
  if (!review) return null;

  await db.reviewReport.updateMany({
    where: { reviewId, status: "OPEN" },
    data: { status: "DISMISSED", resolvedAt: new Date() },
  });
  return { productId: review.productId };
}
