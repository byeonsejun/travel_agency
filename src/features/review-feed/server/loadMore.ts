"use server";

import { z } from "zod";
import { listReviewsByProduct, type ReviewListPage } from "@/entities/review";
import { auth } from "@/features/auth/server/auth";

const InputSchema = z.object({
  productId: z.string().cuid(),
  cursor: z.string().min(1),
});

// PDP "더보기" — nextCursor 를 받아 다음 10건 반환. PUBLISHED 필터는 쿼리에 내장
// (admin 이 숨긴 리뷰는 더보기로도 안 나옴 — 노출 일관성). 캐시 비대상 실시간 쿼리.
// viewerId 를 auth() 로 계산해 isOwn 필드를 정확히 세팅 — 더보기 아이템도 신고 버튼 제어에 사용.
export async function loadMoreReviewsAction(
  productId: string,
  cursor: string,
): Promise<ReviewListPage> {
  const parsed = InputSchema.safeParse({ productId, cursor });
  if (!parsed.success) {
    return { items: [], nextCursor: null };
  }
  const viewerId = (await auth())?.user?.id;
  return listReviewsByProduct(parsed.data.productId, {
    limit: 10,
    cursor: parsed.data.cursor,
    viewerId,
  });
}
