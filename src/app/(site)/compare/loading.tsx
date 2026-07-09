import { CompassLoader } from "@/shared/ui/CompassLoader";

// route-level 로딩 경계 — 네비게이션 즉시 스켈레톤(빈 화면 방지).
// compare/page.tsx 의 정적 셸(컨테이너) + in-page Suspense fallback(CompareSkeleton) 을
// 그대로 복제. 제목은 페이지에서도 Suspense 자식 안에 있어 fallback 단계엔 스켈레톤이므로
// 여기서도 스켈레톤 타이틀로 맞춘다(전환 시 layout shift 최소). [ADR-0053]
export default function CompareLoading() {
  return (
    <>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="mb-6 flex items-baseline justify-between">
          <div className="h-7 w-28 animate-pulse rounded bg-muted" />
          <div className="h-4 w-10 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-80 animate-pulse rounded-xl bg-muted" />
      </div>
      {/* 2단계 로딩: 스켈레톤 위 나침반 오버레이. 1단계와 동일 CompassLoader → seamless 인계. */}
      <CompassLoader />
    </>
  );
}
