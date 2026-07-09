import { CompassLoader } from "@/shared/ui/CompassLoader";
import { Skeleton } from "@/shared/ui/Skeleton";

// (site) 그룹 catch-all route-level 로딩 경계.
// 자체 loading.tsx 가 없는 (site) 하위 라우트(reviews/new, bookings 결과 화면 등)에
// 네비게이션 즉시 표시되는 *중립* 스켈레톤. 특정 페이지 레이아웃에 과하게 맞추지 않은
// 범용 골격이며, 각 세그먼트가 자체 loading.tsx 를 두면 그쪽이 우선한다(더 구체적인 경계 승리).
// 기존 loading.tsx(products/search/mypage)와 동일하게 Skeleton 프리미티브만 조합한다.
export default function SiteLoading() {
  return (
    <>
      <div className="mx-auto max-w-5xl px-6 py-12">
        {/* 제목 영역 */}
        <div className="mb-8 space-y-3">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        {/* 본문 블록 */}
        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
      {/* 2단계 로딩: 스켈레톤 위 나침반 오버레이. 1단계와 동일 CompassLoader → seamless 인계. */}
      <CompassLoader />
    </>
  );
}
