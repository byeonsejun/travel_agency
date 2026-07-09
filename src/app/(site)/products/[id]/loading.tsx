import { CompassLoader } from "@/shared/ui/CompassLoader";
import { Skeleton } from "@/shared/ui/Skeleton";

export default function ProductDetailLoading() {
  return (
    <>
      <div className="mx-auto max-w-5xl px-6 py-10">
        {/* 히어로 이미지 */}
        <Skeleton className="mb-6 h-80 w-full rounded-xl" />
        {/* 제목 + 가격 */}
        <div className="mb-8 space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-5 w-1/4" />
          <Skeleton className="h-10 w-40" />
        </div>
        {/* 본문 단락 */}
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
      {/* 2단계 로딩: 스켈레톤 위 나침반 오버레이. 1단계와 동일 CompassLoader → seamless 인계. */}
      <CompassLoader />
    </>
  );
}
