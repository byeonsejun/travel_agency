import { TransactionFallback } from "@/shared/ui/TransactionFallback";

// route-level 로딩 경계 — 네비게이션 즉시 스켈레톤(빈 화면 방지).
// page.tsx 의 정적 셸(제목) + in-page Suspense fallback(TransactionFallback "detail")을
// 그대로 복제해 loading → 페이지 셸 전환 시 layout shift 를 없앤다. [ADR-0053]
export default function BookingDetailLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold text-foreground">예약 상세</h1>
      <TransactionFallback variant="detail" />
    </div>
  );
}
