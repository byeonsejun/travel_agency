import { ProductCard } from "@/entities/product";
import type { ProductCardType } from "@/entities/product";
import { WishlistHeartButton } from "@/features/wishlist";
import { CompareToggleButton, serializeCompareIds } from "@/features/product-compare";

type ProductCardListProps = {
  items: ProductCardType[];
  // 로그인 유저면 사전 계산된 wishlist productId Set 을 넘겨 N+1 차단.
  // 비로그인이면 undefined → 하트 미노출.
  wishlistIds?: Set<string>;
  wishlistReturnTo?: string;
  // 비로그인 클릭 시 confirm 인터셉트를 위한 prop. heart 노출 시 필수.
  loggedIn?: boolean;
  // 비교 모드: URL state 보존 + 토글 버튼 노출.
  currentCompareIds?: string[];
  showCompareButton?: boolean;
};

export function ProductCardList({
  items,
  wishlistIds,
  wishlistReturnTo,
  loggedIn,
  currentCompareIds,
  showCompareButton = true,
}: ProductCardListProps) {
  const compareQs =
    currentCompareIds && currentCompareIds.length > 0
      ? `compareIds=${serializeCompareIds(currentCompareIds)}`
      : undefined;

  return (
    <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => {
        const inList = wishlistIds?.has(item.id);
        const heart =
          wishlistReturnTo !== undefined && inList !== undefined && loggedIn !== undefined ? (
            <WishlistHeartButton
              productId={item.id}
              inWishlist={inList}
              loggedIn={loggedIn}
              returnTo={wishlistReturnTo}
              size="sm"
            />
          ) : undefined;
        const compareButton = showCompareButton ? (
          <CompareToggleButton productId={item.id} size="sm" />
        ) : undefined;
        return (
          <ProductCard
            key={item.id}
            product={item}
            heart={heart}
            compareButton={compareButton}
            linkQueryString={compareQs}
          />
        );
      })}
    </div>
  );
}
