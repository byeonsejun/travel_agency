import {
  getProductReviewStats,
  listReviewsByProduct,
  getReviewRatingDistribution,
} from "@/entities/review";
import { ReviewStatsBar, RatingDistribution } from "@/widgets/review-list";
import { ReviewFeed } from "@/features/review-feed";

type ProductReviewsSectionProps = {
  productId: string;
};

/**
 * 리뷰 통계/분포/피드를 자체적으로 fetch 하는 async 서버 컴포넌트.
 * page.tsx 의 본문(product/departures)과 분리되어 <Suspense> 로 스트리밍된다.
 */
export async function ProductReviewsSection({
  productId,
}: ProductReviewsSectionProps) {
  const [reviewStats, reviewPage, ratingDist] = await Promise.all([
    getProductReviewStats(productId),
    listReviewsByProduct(productId, { limit: 10 }),
    getReviewRatingDistribution(productId),
  ]);

  return (
    <div className="space-y-4">
      <ReviewStatsBar avg={reviewStats.avg} count={reviewStats.count} />
      <RatingDistribution distribution={ratingDist} total={reviewStats.count} />
      <ReviewFeed
        productId={productId}
        initialItems={reviewPage.items}
        initialCursor={reviewPage.nextCursor}
      />
    </div>
  );
}
