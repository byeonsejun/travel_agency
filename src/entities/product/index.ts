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
export {
  getProductList,
  getProductById,
  getProductsByIds,
  getFeaturedProducts,
  getDistinctDestinations,
  getAllPublishedProductIds,
  tagProductDetail,
  tagProductDepartures,
  PAGE_SIZE,
} from "./api/queries";

export { searchProductsByVector } from "./api/searchByVector";
export type { VectorSearchFilters } from "./api/searchByVector";

export { ProductImage } from "./ui/ProductImage";
export { ProductCard } from "./ui/ProductCard";
export { InclusionList } from "./ui/InclusionList";
export { ItineraryTimeline } from "./ui/ItineraryTimeline";
