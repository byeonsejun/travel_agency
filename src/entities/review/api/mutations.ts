import type { ReviewStatus } from "@prisma/client";

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
