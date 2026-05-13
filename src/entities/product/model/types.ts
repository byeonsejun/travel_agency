import type {
  Product,
  ProductTag,
  Inclusion,
  ItineraryDay,
  ItineraryStop,
  ProductStatus,
  InclusionKind,
} from "@prisma/client";

export type { ProductStatus, InclusionKind };

// 검색 결과 카드 — 목록에서 필요한 최소 필드
export type ProductCard = Pick<
  Product,
  | "id"
  | "title"
  | "destination"
  | "durationNights"
  | "durationDays"
  | "heroImageUrl"
  | "basePriceAdult"
  | "aiSummary"
> & {
  tags: Pick<ProductTag, "tag">[];
  lowestPrice?: number; // 가장 가까운 출발일 기준 실제가 (Departure에서 조인)
};

// 상품 상세 페이지 — 전체 데이터
export type ProductDetail = Product & {
  tags: ProductTag[];
  inclusions: Inclusion[];
  itineraryDays: (ItineraryDay & {
    stops: ItineraryStop[];
  })[];
};

// AI 검색 파이프라인이 반환하는 카드 + 추천 코멘트
export type SearchResultCard = ProductCard & {
  aiComment?: string;
  score?: number;
};
