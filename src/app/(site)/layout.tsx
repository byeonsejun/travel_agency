import { Suspense } from "react";
import { SiteHeader } from "@/widgets/site-header";
import { SiteFooter } from "@/widgets/site-footer";
import { GlobalRouteProgress } from "@/shared/ui/GlobalRouteProgress";
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
      <SiteHeader />
      <main className="min-h-[60vh]">{children}</main>
      <SiteFooter />
      <WebVitalsReporter />
    </>
  );
}
