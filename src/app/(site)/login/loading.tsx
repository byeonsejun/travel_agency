import { CompassLoader } from "@/shared/ui/CompassLoader";

// route-level 로딩 경계 — 네비게이션 즉시 스켈레톤(빈 화면 방지).
// login/page.tsx 의 정적 셸(중앙 카드 + 제목/부제)은 실제 텍스트 그대로, 폼 영역만
// in-page Suspense fallback(LoginFormSkeleton) 을 복제 → 전환 시 layout shift 없음.
// login 세그먼트 하위(verify/success/error)도 동일한 중앙 카드형이라 이 경계로 커버된다. [ADR-0053]
export default function LoginLoading() {
  return (
    <>
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-secondary px-6 py-16">
        <div className="w-full max-w-sm space-y-6 rounded-2xl border border-border bg-card px-8 py-10 shadow-card">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground">로그인</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              이메일로 로그인 링크를 받으세요
            </p>
          </div>
          <div className="space-y-4">
            <div className="h-16 animate-pulse rounded-lg bg-muted" />
            <div className="h-9 animate-pulse rounded-lg bg-muted" />
            <div className="h-9 animate-pulse rounded-lg bg-muted" />
          </div>
        </div>
      </div>
      {/* 2단계 로딩: 스켈레톤 위 나침반 오버레이. 1단계와 동일 CompassLoader → seamless 인계. */}
      <CompassLoader />
    </>
  );
}
