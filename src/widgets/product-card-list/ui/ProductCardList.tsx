import { ProductCard } from "@/entities/product";
import type { ProductCardType } from "@/entities/product";
import { WishlistHeartButton } from "@/features/wishlist";

type ProductCardListProps = {
  items: ProductCardType[];
  // 로그인 유저면 사전 계산된 wishlist productId Set 을 넘겨 N+1 차단.
  // 비로그인이면 undefined → 하트 미노출.
  wishlistIds?: Set<string>;
  wishlistReturnTo?: string;
};

export function ProductCardList({ items, wishlistIds, wishlistReturnTo }: ProductCardListProps) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const inList = wishlistIds?.has(item.id);
        const heart =
          wishlistReturnTo !== undefined && inList !== undefined ? (
            <WishlistHeartButton
              productId={item.id}
              inWishlist={inList}
              returnTo={wishlistReturnTo}
              size="sm"
            />
          ) : undefined;
        return <ProductCard key={item.id} product={item} heart={heart} />;
      })}
    </div>
  );
}
