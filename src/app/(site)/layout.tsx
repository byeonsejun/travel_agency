import { Suspense } from "react";
import { SiteHeader } from "@/widgets/site-header";
import { SiteFooter } from "@/widgets/site-footer";
import { GlobalRouteProgress } from "@/shared/ui/GlobalRouteProgress";
import { NavigationLoadingOverlay } from "@/shared/ui/NavigationLoadingOverlay";
import { WebVitalsReporter } from "@/features/rum";

export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // cookies 의존 auth() 호출은 SiteHeader 내부 UserNavIsland 의 client-fetch 로 격리 (ADR-0018).
  // layout 본체는 cookies 의존 0 → 모든 자식 페이지 정적 prerender 자격 회복
  // (특히 /products/[id] 가 ISR `●` 표기로 승격).
  return (
    <>
      {/* 전역 라우트 진행 바 — useSearchParams 사용으로 Suspense 경계 필수
          (정적 prerender 시 fallback=null 로 페이지 dynamic 강등 방지, ADR-0035). */}
      <Suspense fallback={null}>
        <GlobalRouteProgress />
      </Suspense>
      {/* 느린 라우트 이동(400ms+) 시 얕은 딤 + 회전 나침반 오버레이.
          진행 바와 같은 신호원(useNavigationSignal) 공유, useSearchParams 사용으로
          Suspense 경계 필수(정적 prerender 시 fallback=null, ADR-0035·GlobalRouteProgress와 동형). */}
      <Suspense fallback={null}>
        <NavigationLoadingOverlay />
      </Suspense>
      <SiteHeader />
      <main className="min-h-[60vh]">{children}</main>
      <SiteFooter />
      {/* RUM 리포터 — usePathname() 동적 읽기 → Suspense 경계 필수
          (정적 prerender 시 fallback=null, [ADR-0053] · GlobalRouteProgress와 동형). */}
      <Suspense fallback={null}>
        <WebVitalsReporter />
      </Suspense>
    </>
  );
}
