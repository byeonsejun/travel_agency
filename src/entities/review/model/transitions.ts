import type { ReviewStatus } from "@prisma/client";

// 리뷰 모더레이션 전이 규칙 SSOT. booking 수준 풀 state machine 은 과설계 —
// 상태 3개·전이 단순이라 경량 인접 맵으로 충분.
//  - PUBLISHED ↔ HIDDEN: admin 숨김/복원
//  - REPORTED → PUBLISHED|HIDDEN: 신고 처리 (REPORTED 진입점은 다음 Phase)
// 동일 상태 전이·역방향(→REPORTED)은 금지.
export const ALLOWED_REVIEW_TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  PUBLISHED: ["HIDDEN"],
  HIDDEN: ["PUBLISHED"],
  REPORTED: ["PUBLISHED", "HIDDEN"],
};

export class InvalidReviewTransitionError extends Error {
  constructor(
    public readonly from: ReviewStatus,
    public readonly to: ReviewStatus,
  ) {
    super(`Invalid review status transition: ${from} → ${to}`);
    this.name = "InvalidReviewTransitionError";
  }
}

export function assertReviewTransition(
  from: ReviewStatus,
  to: ReviewStatus,
): void {
  if (!ALLOWED_REVIEW_TRANSITIONS[from].includes(to)) {
    throw new InvalidReviewTransitionError(from, to);
  }
}
