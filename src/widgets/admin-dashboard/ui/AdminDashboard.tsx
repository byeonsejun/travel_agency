// src/widgets/admin-dashboard/ui/AdminDashboard.tsx
import type {
  DashboardData,
  ProductOption,
  WebVitalP75,
  RouteVitalP75,
  VitalTrendPoint,
} from "@/entities/analytics";
import { PRESETS, presetRange } from "@/entities/analytics";
import { KpiDrilldownGrid } from "@/features/admin-dashboard-drilldown";
import { DateRangePicker } from "./DateRangePicker";
import { ProductSelect } from "./ProductSelect";
import { RevenueTrendChart } from "./RevenueTrendChart";
import { BookingStatusDonut } from "./BookingStatusDonut";
import { PerformancePanel } from "./PerformancePanel";

export function AdminDashboard({
  data,
  start,
  end,
  productId,
  productOptions,
  rum,
}: {
  data: DashboardData;
  start: string;
  end: string;
  productId: string | null;
  productOptions: ProductOption[];
  rum: { summary: WebVitalP75[]; byRoute: RouteVitalP75[]; trend: VitalTrendPoint[] };
}) {
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-foreground">운영 대시보드</h1>
        <div className="flex flex-wrap items-center gap-2">
          <ProductSelect options={productOptions} current={productId} />
          {/* presetRange를 서버에서 미리 계산해 prop으로 주입 — client(DateRangePicker)가
              'use cache'를 품은 @/entities/analytics 배럴을 직접 import하지 않도록(서버 그래프
              누출 방지, [ADR-0053]). 무인자 presetRange의 'now'는 요청 시점(동적) = 기존 동작 보존. */}
          <DateRangePicker
            key={start + end}
            start={start}
            end={end}
            presets={PRESETS.map((p) => ({ ...p, ...presetRange(p.key) }))}
          />
        </div>
      </div>

      <KpiDrilldownGrid
        revenue={data.revenue}
        penaltyRevenue={data.penaltyRevenue}
        cancellation={data.cancellation}
        occupancy={data.occupancy}
        start={start}
        end={end}
        productId={productId}
      />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.7fr_1fr]">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h3 className="text-sm font-bold text-foreground">매출 추이</h3>
          <p className="mb-3 text-[11.5px] text-muted-foreground">
            {data.trend.length > 0 ? "기간 내 결제액 vs 환불액" : "데이터 없음"}
          </p>
          <RevenueTrendChart data={data.trend} />
        </section>
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h3 className="text-sm font-bold text-foreground">예약 상태 분포</h3>
          <p className="mb-3 text-[11.5px] text-muted-foreground">
            {productId ? "선택 상품 기준" : "전체 예약 기준"}
          </p>
          <BookingStatusDonut data={data.statusDistribution} />
        </section>
      </div>

      <PerformancePanel summary={rum.summary} byRoute={rum.byRoute} trend={rum.trend} />
    </div>
  );
}
