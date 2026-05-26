import { ProductCard } from "@/entities/product";
import type { WishlistItemWithProduct } from "@/entities/wishlist";
import { WishlistHeartButton } from "@/features/wishlist";
import { EmptyState } from "@/shared/ui/EmptyState";
import Link from "next/link";

type Props = {
  items: WishlistItemWithProduct[];
};

export function WishlistGrid({ items }: Props) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="아직 찜한 상품이 없습니다."
        description="상품 페이지에서 하트를 눌러 관심 상품을 저장해보세요."
        action={
          <Link href="/products" className="text-blue-600 hover:underline">
            상품 둘러보기 →
          </Link>
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <ProductCard
          key={item.productId}
          product={item.product}
          heart={
            <WishlistHeartButton
              productId={item.productId}
              inWishlist={true}
              loggedIn={true}
              returnTo="/mypage"
              size="sm"
            />
          }
        />
      ))}
    </div>
  );
}
