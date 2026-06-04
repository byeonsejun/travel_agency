import type { DashboardData, RangeKey } from "@/entities/analytics";
import { DashboardKpiCards } from "./DashboardKpiCards";
import { DashboardRangeFilter } from "./DashboardRangeFilter";
import { RevenueTrendChart } from "./RevenueTrendChart";
import { BookingStatusDonut } from "./BookingStatusDonut";

export function AdminDashboard({
  data,
  range,
}: {
  data: DashboardData;
  range: RangeKey;
}) {
  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">운영 대시보드</h1>
        <DashboardRangeFilter active={range} />
      </div>

      <DashboardKpiCards
        revenue={data.revenue}
        penaltyRevenue={data.penaltyRevenue}
        cancellation={data.cancellation}
        occupancy={data.occupancy}
      />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.7fr_1fr]">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900">매출 추이</h3>
          <p className="mb-3 text-[11.5px] text-gray-400">
            일별 결제액 vs 환불액
          </p>
          <RevenueTrendChart data={data.trend} />
        </section>
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900">예약 상태 분포</h3>
          <p className="mb-3 text-[11.5px] text-gray-400">현재 전체 예약 기준</p>
          <BookingStatusDonut data={data.statusDistribution} />
        </section>
      </div>
    </div>
  );
}
