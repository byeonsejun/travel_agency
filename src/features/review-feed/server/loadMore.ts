"use server";

import { z } from "zod";
import { listReviewsByProduct, type ReviewListPage } from "@/entities/review";

const InputSchema = z.object({
  productId: z.string().cuid(),
  cursor: z.string().min(1),
});

// PDP "더보기" — nextCursor 를 받아 다음 10건 반환. PUBLISHED 필터는 쿼리에 내장
// (admin 이 숨긴 리뷰는 더보기로도 안 나옴 — 노출 일관성). 캐시 비대상 실시간 쿼리.
export async function loadMoreReviewsAction(
  productId: string,
  cursor: string,
): Promise<ReviewListPage> {
  const parsed = InputSchema.safeParse({ productId, cursor });
  if (!parsed.success) {
    return { items: [], nextCursor: null };
  }
  return listReviewsByProduct(parsed.data.productId, {
    limit: 10,
    cursor: parsed.data.cursor,
  });
}
