"use client";
import { useState } from "react";
import type {
  RevenueSummary,
  CancellationStats,
  SeatOccupancy,
  DrilldownMetric,
  RangeKey,
} from "@/entities/analytics";
import { formatKRW, formatPercent } from "@/widgets/admin-dashboard/ui/format";
import { DrilldownSheet } from "./DrilldownSheet";

interface Props {
  revenue: RevenueSummary;
  penaltyRevenue: number;
  cancellation: CancellationStats;
  occupancy: SeatOccupancy;
  range: RangeKey;
}

function Card({
  label,
  dot,
  value,
  caption,
  onClick,
}: {
  label: string;
  dot: string;
  value: string;
  caption: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-colors hover:border-red-300 hover:bg-red-50/30"
    >
      <div className="flex items-center gap-2 text-[12.5px] font-semibold text-gray-500">
        <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
        {label}
        <span className="ml-auto text-[11px] font-normal text-gray-300">클릭 →</span>
      </div>
      <div className="mt-2.5 text-[25px] font-extrabold tracking-tight text-gray-900">
        {value}
      </div>
      <div className="mt-1.5 text-xs text-gray-400">{caption}</div>
    </button>
  );
}

export function KpiDrilldownGrid({
  revenue,
  penaltyRevenue,
  cancellation,
  occupancy,
  range,
}: Props) {
  const [open, setOpen] = useState<DrilldownMetric | null>(null);
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card
          label="순매출 (결제−환불)"
          dot="#b91c1c"
          value={formatKRW(revenue.net)}
          caption={`결제 ${formatKRW(revenue.paid)} · 환불 ${formatKRW(revenue.refunded)}`}
          onClick={() => setOpen("revenue")}
        />
        <Card
          label="위약금 수익"
          dot="#f59e0b"
          value={formatKRW(penaltyRevenue)}
          caption="성공 환불의 동결 위약금 누적"
          onClick={() => setOpen("penalty")}
        />
        <Card
          label="취소율"
          dot="#dc2626"
          value={formatPercent(cancellation.rate)}
          caption={`취소 ${cancellation.canceled} / 예약 ${cancellation.total}`}
          onClick={() => setOpen("cancellation")}
        />
        <Card
          label="좌석 점유율 (현재)"
          dot="#2563eb"
          value={formatPercent(occupancy.rate)}
          caption={`예약 ${occupancy.booked} / 정원 ${occupancy.capacity}`}
          onClick={() => setOpen("occupancy")}
        />
      </div>
      {open && (
        <DrilldownSheet metric={open} range={range} onClose={() => setOpen(null)} />
      )}
    </>
  );
}
