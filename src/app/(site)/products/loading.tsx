import { CompassLoader } from "@/shared/ui/CompassLoader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { ProductCardSkeleton } from "@/widgets/product-card-list";

export default function ProductsLoading() {
  return (
    <>
      <div className="mx-auto max-w-7xl px-6 py-12">
        {/* 필터바 영역 */}
        <div className="mb-6 space-y-4 border-b border-gray-200 pb-6">
          <div className="flex gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-20" />
            ))}
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-10 w-48" />
          </div>
        </div>
        {/* 카드 그리드 */}
        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      </div>
      {/* 2단계 로딩: 스켈레톤 위 나침반 오버레이(딤 너머로 스켈레톤 비침).
          1단계 오버레이와 동일한 CompassLoader → URL 커밋 순간 seamless 인계. */}
      <CompassLoader />
    </>
  );
}
