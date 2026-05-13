import { ProductImage, InclusionList, ItineraryTimeline } from "@/entities/product";
import { DepartureList } from "@/entities/departure";
import type { ProductDetail } from "@/entities/product/model/types";
import type { DepartureSummary } from "@/entities/departure/model/types";

type ProductDetailProps = {
  product: ProductDetail;
  departures: DepartureSummary[];
};

export function ProductDetail({
  product,
  departures,
}: ProductDetailProps) {
  const isClosed = product.status === "CLOSED";

  return (
    <div className="space-y-8">
      {/* 1. Hero 이미지 영역 */}
      <div className="relative">
        <div className="h-96 w-full">
          <ProductImage
            src={product.heroImageUrl}
            alt={product.title}
            className="h-full w-full"
          />
        </div>

        {/* CLOSED 오버레이 */}
        {isClosed && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="text-center">
              <p className="text-3xl font-bold text-red-500">판매종료</p>
            </div>
          </div>
        )}
      </div>

      {/* 2. 헤더 정보 */}
      <div className="space-y-2 px-4 md:px-0">
        <p className="text-sm text-gray-600">{product.destination}</p>
        <h1 className="text-3xl font-bold text-gray-900">{product.title}</h1>
        <p className="text-gray-700">
          {product.durationNights}박 {product.durationDays}일
        </p>

        {/* 태그 배지들 */}
        {product.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {product.tags.map((tagObj) => (
              <span
                key={`${product.id}-${tagObj.tag}`}
                className="inline-block rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-800"
              >
                {tagObj.tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 3. AI 요약 박스 */}
      {product.aiSummary && (
        <div className="rounded-lg bg-indigo-50 p-4 md:p-6">
          <div className="flex gap-3">
            <span className="text-xl">✦</span>
            <div>
              <h3 className="mb-2 font-semibold text-gray-900">AI 추천 포인트</h3>
              <p className="text-gray-700">{product.aiSummary}</p>
            </div>
          </div>
        </div>
      )}

      {/* 4. 기준가 카드 */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 md:p-6">
        <p className="text-sm text-gray-600">기준 가격 (성인 기준)</p>
        <p className="text-2xl font-bold text-gray-900">
          {product.basePriceAdult.toLocaleString()}원~
        </p>
        <p className="mt-2 text-sm text-gray-500">
          출발일별로 가격이 상이할 수 있습니다.
        </p>
      </div>

      {/* 5. 출발일 섹션 */}
      <div className="space-y-4 px-4 md:px-0">
        <h2 className="text-2xl font-bold text-gray-900">출발일 일정</h2>
        <DepartureList departures={isClosed ? [] : departures} />
      </div>

      {/* 6. 포함/불포함 섹션 */}
      <div className="space-y-4 px-4 md:px-0">
        <h2 className="text-2xl font-bold text-gray-900">포함/불포함 사항</h2>
        <InclusionList inclusions={product.inclusions} />
      </div>

      {/* 7. 일정 섹션 */}
      <div className="space-y-4 px-4 md:px-0">
        <h2 className="text-2xl font-bold text-gray-900">여행 일정</h2>
        <ItineraryTimeline days={product.itineraryDays} />
      </div>
    </div>
  );
}
