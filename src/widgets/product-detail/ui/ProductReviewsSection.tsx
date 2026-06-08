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
 * 리뷰 통계/분포/피드를 자체 fetch 하는 async 서버 컴포넌트.
 * <Suspense> 로 스트리밍. **auth() 호출 금지** — PDP ISR(revalidate=3600) 보존을 위해
 * viewer 컨텍스트(로그인 여부·본인 리뷰)는 ReviewFeed 가 마운트 후 client 에서 해소한다
 * (위시리스트 island 패턴, ADR-0018).
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
