import { notFound } from "next/navigation";
import { getProductById, getProductsByIds } from "@/entities/product";
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
  parseCompareIds,
  CompareToggleButton,
  FloatingCompareCart,
} from "@/features/product-compare";

// PDP 는 본래 1시간 ISR(revalidate=3600) 대상이지만, searchParams.compareIds
// 의존이 생기면서 자연스럽게 dynamic. unstable_cache+tag(product:[id]) 가
// 여전히 DB hit 을 압축하므로 응답 비용 증가는 제한적.
// (compareIds 가 없을 때만 정적 prerender 하도록 매개변수화는 별도 plan.)

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProductDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await auth();
  const compareIds = parseCompareIds(sp.compareIds);

  const [product, departures, inWishlist, compareProducts, reviewStats, reviewPage] =
    await Promise.all([
      getProductById(id),
      getDeparturesByProduct(id),
      session?.user?.id ? isInWishlist(session.user.id, id) : Promise.resolve(undefined),
      getProductsByIds(compareIds),
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
      <FloatingCompareCart
        products={compareProducts.map((p) => ({
          id: p.id,
          title: p.title,
          heroImageUrl: p.heroImageUrl,
        }))}
      />
    </>
  );
}
