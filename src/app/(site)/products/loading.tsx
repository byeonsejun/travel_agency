import { Skeleton } from "@/shared/ui/Skeleton";
import { ProductCardSkeleton } from "@/widgets/product-card-list/ui/ProductCardSkeleton";

export default function ProductsLoading() {
  return (
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
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
