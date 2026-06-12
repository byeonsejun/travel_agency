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
import type { WebVitalTrendRow } from "../model/pivotTrend";

// LCP/INP p75 추이 라인. window/ResizeObserver 의존 → 클라이언트 리프 격리.
// 서버가 `pivotTrend`(../model)로 메트릭별 pivot한 plain 배열을 props로 받는다.
// 순수 변환은 client 모듈 밖(model)에 둔다 — server가 호출하므로(RSC 경계).
export function WebVitalTrendChart({
  data,
}: {
  data: WebVitalTrendRow[];
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
