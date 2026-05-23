import { notFound } from "next/navigation";
import { getProductById } from "@/entities/product";
import { getDeparturesByProduct } from "@/entities/departure";
import {
  getProductReviewStats,
  listReviewsByProduct,
} from "@/entities/review";
import { ProductDetail } from "@/widgets/product-detail/ui/ProductDetail";
import { ReviewList, ReviewStatsBar } from "@/widgets/review-list";
import { auth } from "@/features/auth/server/auth";
import { isInWishlist } from "@/entities/wishlist";
import {
  CompareToggleButton,
  FloatingCompareCart,
} from "@/features/product-compare";

// PDP 1시간 ISR. compareIds 의존 UI(FloatingCompareCart) 는 client-fetch 패턴으로
// 분리되어 본 페이지는 product/departures/review 만 RSC 로 prefetch.
//
// ⚠️ 잔여 dynamic 트리거: `auth()` + `isInWishlist` 는 cookies 의존이라 Next 가
// 본 페이지를 여전히 dynamic 으로 분류한다. 본 `revalidate=3600` 은 wishlist 도
// island 로 분리(별도 plan)되는 시점에 ISR 활성화 신호로 작동하는 *데이터 캐시
// TTL 힌트*. 본 PR 의 직접 효과는 `searchParams.compareIds` 의존 제거.
export const revalidate = 3600;

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProductDetailPage({ params }: PageProps) {
  const { id } = await params;
  const session = await auth();

  const [product, departures, inWishlist, reviewStats, reviewPage] =
    await Promise.all([
      getProductById(id),
      getDeparturesByProduct(id),
      session?.user?.id ? isInWishlist(session.user.id, id) : Promise.resolve(undefined),
      getProductReviewStats(id),
      listReviewsByProduct(id, { limit: 10 }),
    ]);

  if (product === null) {
    notFound();
  }

  return (
    <>
      <ProductDetail
        product={product}
        departures={departures}
        inWishlist={inWishlist}
        compareButton={<CompareToggleButton productId={id} size="md" />}
        reviewsSection={
          <div className="space-y-4">
            <ReviewStatsBar avg={reviewStats.avg} count={reviewStats.count} />
            <ReviewList reviews={reviewPage.items} />
          </div>
        }
      />
      <FloatingCompareCart />
    </>
  );
}
