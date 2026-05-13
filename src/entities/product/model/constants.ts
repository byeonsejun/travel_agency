import type { ProductStatus } from "@prisma/client";

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  DRAFT: "임시저장",
  PUBLISHED: "판매중",
  CLOSED: "판매종료",
};

// 홈 화면 추천 칩 프리셋
export const SEARCH_CHIPS = [
  "부모님 동반 온천 여행",
  "가성비 휴양지",
  "커플 유럽 여행",
  "허니문 리조트",
  "아이와 함께 동남아",
] as const;

export type SearchChip = (typeof SEARCH_CHIPS)[number];
