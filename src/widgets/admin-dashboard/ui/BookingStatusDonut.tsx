"use client";

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { StatusSlice } from "@/entities/analytics";

const COLORS: Record<string, string> = {
  "PAID/READY": "#b91c1c",
  결제대기: "#f59e0b",
  완료: "#2563eb",
  취소: "#9ca3af",
  기타: "#d1d5db",
};

export function BookingStatusDonut({ data }: { data: StatusSlice[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
        예약 데이터가 없습니다.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="status"
          innerRadius={55}
          outerRadius={85}
          paddingAngle={2}
        >
          {data.map((d) => (
            <Cell key={d.status} fill={COLORS[d.status] ?? "#d1d5db"} />
          ))}
        </Pie>
        <Tooltip formatter={(v: number, n: string) => [`${v}건`, n]} />
        <Legend
          verticalAlign="middle"
          align="right"
          layout="vertical"
          iconType="circle"
          wrapperStyle={{ fontSize: 12 }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
