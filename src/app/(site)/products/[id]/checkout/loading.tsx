import { CompassLoader } from "@/shared/ui/CompassLoader";
import { TransactionFallback } from "@/shared/ui/TransactionFallback";

// route-level 로딩 경계 — 네비게이션 즉시 스켈레톤(빈 화면 방지).
// page.tsx 의 정적 셸(제목) + in-page Suspense fallback(TransactionFallback "form")을
// 그대로 복제해 loading → 페이지 셸 전환 시 layout shift 를 없앤다. [ADR-0053]
export default function CheckoutLoading() {
  return (
    <>
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="mb-6 text-2xl font-bold text-foreground">예약 정보 입력</h1>
        <TransactionFallback variant="form" />
      </div>
      {/* 2단계 로딩: 스켈레톤 위 나침반 오버레이. 1단계와 동일 CompassLoader → seamless 인계. */}
      <CompassLoader />
    </>
  );
}
