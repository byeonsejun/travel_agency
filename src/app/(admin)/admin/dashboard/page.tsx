// src/app/(admin)/admin/dashboard/page.tsx
import {
  parseFilter,
  getRevenueSummary,
  getPenaltyRevenue,
  getCancellationStats,
  getSeatOccupancy,
  getRevenueTrend,
  getBookingStatusDistribution,
  getProductOptions,
} from "@/entities/analytics";
import { AdminDashboard } from "@/widgets/admin-dashboard";

// admin route 는 항상 신선(권한 검증 + 운영 즉시성). 집계 SQL 은 내부 60s 캐시로 흡수.
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    start?: string;
    end?: string;
    productId?: string;
    range?: string; // 레거시 북마크 호환
  }>;
}) {
  const sp = await searchParams;
  const filter = parseFilter(sp);

  // 독립 집계 6종 + 상품 옵션 병렬 (N+1 0).
  const [
    revenue,
    penaltyRevenue,
    cancellation,
    occupancy,
    trend,
    statusDistribution,
    productOptions,
  ] = await Promise.all([
    getRevenueSummary(filter),
    getPenaltyRevenue(filter),
    getCancellationStats(filter),
    getSeatOccupancy(filter),
    getRevenueTrend(filter),
    getBookingStatusDistribution(filter),
    getProductOptions(),
  ]);

  return (
    <AdminDashboard
      start={filter.cacheKey.startDay}
      end={filter.cacheKey.endDay}
      productId={filter.productId}
      productOptions={productOptions}
      data={{
        revenue,
        penaltyRevenue,
        cancellation,
        occupancy,
        trend,
        statusDistribution,
      }}
    />
  );
}
