import {
  parseRange,
  getRevenueSummary,
  getPenaltyRevenue,
  getCancellationStats,
  getSeatOccupancy,
  getRevenueTrend,
  getBookingStatusDistribution,
} from "@/entities/analytics";
import { AdminDashboard } from "@/widgets/admin-dashboard";

// admin route 는 항상 신선(권한 검증 + 운영 즉시성). 집계 SQL 은 내부 60s 캐시로 흡수.
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rangeParam } = await searchParams;
  const range = parseRange(rangeParam);

  // 독립 집계 6종 병렬 (N+1 0).
  const [
    revenue,
    penaltyRevenue,
    cancellation,
    occupancy,
    trend,
    statusDistribution,
  ] = await Promise.all([
    getRevenueSummary(range),
    getPenaltyRevenue(range),
    getCancellationStats(range),
    getSeatOccupancy(),
    getRevenueTrend(range),
    getBookingStatusDistribution(),
  ]);

  return (
    <AdminDashboard
      range={range.key}
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
