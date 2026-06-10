import { ProductImage, InclusionList, ItineraryTimeline } from "@/entities/product";
import { formatTagLabel } from "@/shared/lib/format";
import type { ProductDetail } from "@/entities/product/model/types";
import type { DepartureSummary } from "@/entities/departure/model/types";
import { LiveDepartureList } from "@/features/live-seat";
import { WishlistHeartIsland } from "@/features/wishlist";

type ProductDetailProps = {
  product: ProductDetail;
  departures: DepartureSummary[];
  // 비교 모드 토글 슬롯 — features/product-compare 를 직접 import 하지 않도록
  // 의존성 역전 유지 (ProductCard 와 동일 패턴).
  compareButton?: import("react").ReactNode;
  // 리뷰 섹션 슬롯 — widgets/review-list 를 직접 import 하지 않아 PDP 위젯이
  // 리뷰 도메인을 모르도록 유지. 페이지에서 stats/list 인스턴스를 주입.
  reviewsSection?: import("react").ReactNode;
};

export function ProductDetail({
  product,
  departures,
  compareButton,
  reviewsSection,
}: ProductDetailProps) {
  const isClosed = product.status === "CLOSED";

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-8">
      {/* 1. Hero 이미지 영역 */}
      <div className="relative overflow-hidden rounded-2xl">
        <div className="h-96 w-full bg-secondary">
          <ProductImage
            src={product.heroImageUrl}
            alt={product.title}
            className="h-full w-full"
          />
        </div>

        <div className="absolute right-4 top-4 z-10">
          <WishlistHeartIsland
            productId={product.id}
            returnTo={`/products/${product.id}`}
            size="md"
          />
        </div>

        {/* CLOSED 오버레이 */}
        {isClosed && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="text-center">
              <p className="text-3xl font-extrabold text-destructive">판매종료</p>
            </div>
          </div>
        )}
      </div>

      {/* 2. 헤더 정보 */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-primary">{product.destination}</p>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground">{product.title}</h1>
            <p className="text-muted-foreground">
              {product.durationNights}박 {product.durationDays}일
            </p>
          </div>
          {compareButton && <div className="shrink-0">{compareButton}</div>}
        </div>

        {/* 태그 배지들 */}
        {product.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {product.tags.map((tagObj) => (
              <span
                key={`${product.id}-${tagObj.tag}`}
                className="inline-block rounded-full bg-secondary px-3 py-1 text-sm font-medium text-muted-foreground"
              >
                {formatTagLabel(tagObj.tag)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 3. AI 요약 박스 */}
      {product.aiSummary && (
        <div className="rounded-lg border border-primary/15 bg-primary/5 p-4 md:p-6">
          <div className="flex gap-3">
            <span className="text-xl text-primary">✦</span>
            <div>
              <h3 className="mb-2 font-bold text-foreground">AI 추천 포인트</h3>
              <p className="text-muted-foreground">{product.aiSummary}</p>
            </div>
          </div>
        </div>
      )}

      {/* 4. 기준가 카드 */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-card md:p-6">
        <p className="text-sm text-muted-foreground">기준 가격 (성인 기준)</p>
        <p className="flex items-baseline gap-1">
          <span className="text-2xl font-extrabold text-foreground">
            {product.basePriceAdult.toLocaleString("ko-KR")}
          </span>
          <span className="text-sm text-muted-foreground">원~</span>
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          출발일별로 가격이 상이할 수 있습니다.
        </p>
      </div>

      {/* 5. 출발일 섹션 — 클라이언트 폴링(20s)으로 잔여 좌석 신선도 보장 + low-stock 강조 */}
      <div className="space-y-4">
        <h2 className="text-2xl font-extrabold tracking-tight text-foreground">출발일 일정</h2>
        <LiveDepartureList
          productId={product.id}
          initialDepartures={isClosed ? [] : departures}
        />
      </div>

      {/* 6. 포함/불포함 섹션 */}
      <div className="space-y-4">
        <h2 className="text-2xl font-extrabold tracking-tight text-foreground">포함/불포함 사항</h2>
        <InclusionList inclusions={product.inclusions} />
      </div>

      {/* 7. 일정 섹션 */}
      <div className="space-y-4">
        <h2 className="text-2xl font-extrabold tracking-tight text-foreground">여행 일정</h2>
        <ItineraryTimeline days={product.itineraryDays} />
      </div>

      {/* 8. 후기 섹션 (페이지에서 주입) */}
      {reviewsSection && (
        <div className="space-y-4">
          <h2 className="text-2xl font-extrabold tracking-tight text-foreground">여행자 후기</h2>
          {reviewsSection}
        </div>
      )}
    </div>
  );
}
