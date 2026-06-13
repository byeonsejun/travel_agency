import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getProductById, getAllPublishedProductIds } from "@/entities/product";
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

// PUBLISHED 상품을 build time 에 prerender — generateStaticParams 보존.
// dynamicParams = true (default) 이므로 신규 등록 상품은 첫 요청 시 on-demand 캐시.
export async function generateStaticParams(): Promise<{ id: string }[]> {
  const ids = await getAllPublishedProductIds();
  return ids.map((id) => ({ id }));
}

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
