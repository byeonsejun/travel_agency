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

// PDP 1시간 ISR 실제 활성 (A4 compareIds island + A6 wishlist island + 0018 layout
// auth island 분리 완료). 사용자/쿠키 의존 0 → Next 가 페이지를 정적 prerender 로 승격.
export const revalidate = 3600;

// PUBLISHED 상품을 build time 에 prerender — 빌드 출력에서 `●` (ISR) 표기 활성화.
// dynamicParams = true (default) 이므로 신규 등록 상품은 첫 요청 시 ISR-on-demand.
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
