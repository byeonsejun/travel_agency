"use server";

import { z } from "zod";
import { listReviewsByProduct, type ReviewListPage } from "@/entities/review";

const InputSchema = z.object({
  productId: z.string().cuid(),
  cursor: z.string().min(1),
});

// PDP "더보기" — nextCursor 로 다음 10건. PUBLISHED 필터는 쿼리 내장. 캐시 비대상.
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
