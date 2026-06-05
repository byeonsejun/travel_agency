"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RevenueTrendPoint } from "@/entities/analytics";
import { formatKRW } from "@/shared/lib/format";

// 차트는 window/ResizeObserver 의존 → 클라이언트 리프로 격리.
// 집계(서버)된 plain 배열만 props 로 받는다. DB·env import 없음.
export function RevenueTrendChart({ data }: { data: RevenueTrendPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-gray-400">
        기간 내 매출 데이터가 없습니다.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "#9ca3af" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(d: string) => d.slice(5)}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#9ca3af" }}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(v: number) => `${Math.round(v / 10000)}만`}
        />
        <Tooltip
          formatter={(value: number, name: string) => [
            formatKRW(value),
            name === "paid" ? "결제" : "환불",
          ]}
          labelStyle={{ fontSize: 12 }}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        <Bar dataKey="paid" fill="#b91c1c" radius={[4, 4, 0, 0]} />
        <Bar dataKey="refunded" fill="#fca5a5" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
