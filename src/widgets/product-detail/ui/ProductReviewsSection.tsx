import {
  getProductReviewStats,
  listReviewsByProduct,
  getReviewRatingDistribution,
} from "@/entities/review";
import { auth } from "@/features/auth/server/auth";
import { ReviewStatsBar, RatingDistribution } from "@/widgets/review-list";
import { ReviewFeed } from "@/features/review-feed";

type ProductReviewsSectionProps = {
  productId: string;
};

/**
 * 리뷰 통계/분포/피드를 자체적으로 fetch 하는 async 서버 컴포넌트.
 * page.tsx 의 본문(product/departures)과 분리되어 <Suspense> 로 스트리밍된다.
 * auth() 로 viewer 컨텍스트를 주입해 isOwn(본인 리뷰 신고 버튼 숨김)과
 * isAuthenticated(비로그인 모달 분기)를 ReviewFeed 까지 전달한다.
 */
export async function ProductReviewsSection({
  productId,
}: ProductReviewsSectionProps) {
  const session = await auth();
  const viewerId = session?.user?.id;

  const [reviewStats, reviewPage, ratingDist] = await Promise.all([
    getProductReviewStats(productId),
    listReviewsByProduct(productId, { limit: 10, viewerId }),
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
        isAuthenticated={viewerId != null}
      />
    </div>
  );
}
