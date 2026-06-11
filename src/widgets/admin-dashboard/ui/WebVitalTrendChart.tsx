"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { VitalTrendPoint } from "@/entities/analytics";

// LCP/INP p75 추이 라인. window/ResizeObserver 의존 → 클라이언트 리프 격리.
// 서버가 메트릭별로 pivot한 배열을 받는다. DB·env import 없음.
export function WebVitalTrendChart({
  data,
}: {
  data: { date: string; LCP: number | null; INP: number | null }[];
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
        성능 데이터가 아직 없습니다.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "#9ca3af" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(d: string) => d.slice(5)}
        />
        <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={48} />
        <Tooltip />
        <Line type="monotone" dataKey="LCP" stroke="#2563eb" strokeWidth={2} dot={false} name="LCP(ms)" />
        <Line type="monotone" dataKey="INP" stroke="#16a34a" strokeWidth={2} dot={false} name="INP(ms)" />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** trend 평탄 배열(메트릭별 행) → 차트용 일자별 pivot. 순수 변환. */
export function pivotTrend(
  points: VitalTrendPoint[],
): { date: string; LCP: number | null; INP: number | null }[] {
  const byDate = new Map<string, { date: string; LCP: number | null; INP: number | null }>();
  for (const p of points) {
    const row = byDate.get(p.date) ?? { date: p.date, LCP: null, INP: null };
    if (p.metric === "LCP") row.LCP = p.p75;
    if (p.metric === "INP") row.INP = p.p75;
    byDate.set(p.date, row);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
