export type {
  ProductCard as ProductCardType,
  ProductDetail,
  SearchResultCard,
  ProductStatus,
  InclusionKind,
} from "./model/types";

export {
  PRODUCT_STATUS_LABEL,
  SEARCH_CHIPS,
} from "./model/constants";
export type { SearchChip } from "./model/constants";

export { GEO_TAXONOMY, expandGeoTerms } from "./model/geo";

export {
  productSchema,
  itineraryDaySchema,
  itineraryStopSchema,
  inclusionSchema,
} from "./model/schema";
export type { ProductFormData } from "./model/schema";

export { parseProductListParams } from "./api/parseListParams";
export type { ProductListParams } from "./api/parseListParams";
/**
 * Cache 무효화 컨트랙트 — 미래 admin product CMS / CRUD 작업 시 반드시 호출.
 *
 * | Tag                          | 무효화 발신 시점                                   | TTL  |
 * | ---------------------------- | ------------------------------------------------- | ---- |
 * | `TAG_PRODUCTS_FEATURED`      | 추천 상품 변경(admin pick)                         | 5min |
 * | `TAG_PRODUCTS_LIST`          | 신규 상품 등록 / status 변경 / 정렬 영향 필드 변경  | 5min |
 * | `TAG_DESTINATIONS_LIST`      | 신규 destinationCode 도입 / 상품 status 변경        | 1h   |
 * | `tagProductDetail(id)`       | 단건 상품 update (title/desc/hero/price 등)         | 1h   |
 * | `tagDeparturesByProduct(id)` | 좌석/일정 변경 (booking 확정/취소가 자동 wiring)    | 1h   |
 *
 * `tagProductDetail` 은 `getProductById` + `getProductsByIds` 양쪽에 부여되므로
 * 한 번 bust 으로 PDP + 비교 페이지 캐시가 동시에 무효화된다.
 *
 * 좌석 태그는 entities/departure 의 `tagDeparturesByProduct` 가 SSOT 이며,
 * 이미 checkout / booking-cancel / admin-booking-cancel 이 wiring 완료.
 */
export {
  getProductList,
  getProductById,
  getProductsByIds,
  getFeaturedProducts,
  getDistinctDestinations,
  getAllPublishedProductIds,
  tagProductDetail,
  TAG_PRODUCTS_FEATURED,
  TAG_PRODUCTS_LIST,
  TAG_DESTINATIONS_LIST,
  PAGE_SIZE,
} from "./api/queries";

export { searchProductsByVector } from "./api/searchByVector";
export type { VectorSearchFilters } from "./api/searchByVector";

export { buildEmbeddingText } from "./api/buildEmbeddingText";
export type { EmbeddingTextResult } from "./api/buildEmbeddingText";

export { ProductImage } from "./ui/ProductImage";
export { ProductCard } from "./ui/ProductCard";
export { InclusionList } from "./ui/InclusionList";
export { ItineraryTimeline } from "./ui/ItineraryTimeline";
