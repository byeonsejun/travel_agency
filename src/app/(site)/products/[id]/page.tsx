import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getProductById } from "@/entities/product";
import { getDeparturesByProduct } from "@/entities/departure";
import { ProductDetail } from "@/widgets/product-detail/ui/ProductDetail";
import { ProductReviewsSection } from "@/widgets/product-detail/ui/ProductReviewsSection";
import { ReviewsSkeleton } from "@/widgets/product-detail/ui/ReviewsSkeleton";
import {
  CompareToggleButton,
  FloatingCompareCart,
} from "@/features/product-compare";

// PDP Cache Components(PPR): getProductById/getDeparturesByProduct 가 `use cache`
// (cacheLife revalidate:3600)라 1시간 TTL이 데이터 레이어로 이전됨. 사용자/쿠키 의존 0 →
// 정적 셸 prerender + 캐시 데이터, 리뷰만 <Suspense> 스트리밍. [ADR-0053]
//
// generateStaticParams 의도적 부재 — 빌드 prerender 0개, 전 PDP를 on-demand ISR로.
// 과거엔 전체 PUBLISHED 상품을 빌드 때 prerender 했으나, 페이지당 2쿼리
// (product.findUnique + departure.findMany)를 connection_limit=1 에 동시 투입해
// 빌드 시 커넥션 풀이 고갈(P2024)됐다. PDP 데이터는 위 use cache + cacheLife(3600)이라
// 첫 요청 시 prerender(◐ PPR) + 캐시되면 충분 — 빌드가 DB 를 칠 이유가 없다.
// ⚠️ generateStaticParams 를 `return []` 로 두지 말 것: Cache Components 는 빈 결과를
//    거부(EmptyGenerateStaticParamsError)한다. on-demand 로 두려면 함수 자체를 두지 않는다.

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProductDetailPage({ params }: PageProps) {
  const { id } = await params;

  // 본문(상품·출발일)만 우선 await → 즉시 페인트. 리뷰는 아래 Suspense 로 스트리밍.
  const [product, departures] = await Promise.all([
    getProductById(id),
    getDeparturesByProduct(id),
  ]);

  if (product === null) {
    notFound();
  }

  return (
    <>
      <ProductDetail
        product={product}
        departures={departures}
        compareButton={<CompareToggleButton productId={id} size="md" />}
        reviewsSection={
          <Suspense fallback={<ReviewsSkeleton />}>
            <ProductReviewsSection productId={id} />
          </Suspense>
        }
      />
      <FloatingCompareCart />
    </>
  );
}
