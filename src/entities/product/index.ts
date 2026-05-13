export type {
  ProductCard,
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
  getFeaturedProducts,
  getDistinctDestinations,
  PAGE_SIZE,
} from "./api/queries";

export { ProductImage } from "./ui/ProductImage";
export { ProductCard as ProductCardComponent } from "./ui/ProductCard";
