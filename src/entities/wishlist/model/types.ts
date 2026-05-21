import type { ProductCardType } from "@/entities/product";

// 마이페이지 "찜한 상품" 그리드에서 필요한 최소 필드. 같은 상품을 카드로 다시
// 렌더하므로 ProductCard 와 동일한 형태에 wishlist 메타(언제 찜했는지)만 추가.
export type WishlistItemWithProduct = {
  productId: string;
  createdAt: Date;
  product: ProductCardType;
};
