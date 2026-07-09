import { CompassLoader } from "@/shared/ui/CompassLoader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { ProductCardSkeleton } from "@/widgets/product-card-list/ui/ProductCardSkeleton";

export default function SearchLoading() {
  return (
    <>
      <div className="mx-auto max-w-7xl px-6 py-12">
        <section className="mb-8">
          <Skeleton className="mb-6 h-9 w-32" />
          <div className="flex gap-2">
            <Skeleton className="h-12 flex-1 rounded-lg" />
            <Skeleton className="h-12 w-20 rounded-lg" />
          </div>
        </section>
        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      </div>
      {/* 2단계 로딩: 스켈레톤 위 나침반 오버레이. 1단계와 동일 CompassLoader → seamless 인계. */}
      <CompassLoader />
    </>
  );
}
