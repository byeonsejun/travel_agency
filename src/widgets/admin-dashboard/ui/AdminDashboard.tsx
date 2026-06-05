// src/widgets/admin-dashboard/ui/AdminDashboard.tsx
import type { DashboardData, ProductOption } from "@/entities/analytics";
import { DashboardKpiCards } from "./DashboardKpiCards";
import { DateRangePicker } from "./DateRangePicker";
import { ProductSelect } from "./ProductSelect";
import { RevenueTrendChart } from "./RevenueTrendChart";
import { BookingStatusDonut } from "./BookingStatusDonut";

export function AdminDashboard({
  data,
  start,
  end,
  productId,
  productOptions,
}: {
  data: DashboardData;
  start: string;
  end: string;
  productId: string | null;
  productOptions: ProductOption[];
}) {
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">운영 대시보드</h1>
        <div className="flex flex-wrap items-center gap-2">
          <ProductSelect options={productOptions} current={productId} />
          <DateRangePicker start={start} end={end} />
        </div>
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
            {data.trend.length > 0 ? "기간 내 결제액 vs 환불액" : "데이터 없음"}
          </p>
          <RevenueTrendChart data={data.trend} />
        </section>
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900">예약 상태 분포</h3>
          <p className="mb-3 text-[11.5px] text-gray-400">
            {productId ? "선택 상품 기준" : "전체 예약 기준"}
          </p>
          <BookingStatusDonut data={data.statusDistribution} />
        </section>
      </div>
    </div>
  );
}
