import { Badge } from "@/shared/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import type { WebVitalP75, RouteVitalP75, VitalTrendPoint } from "@/entities/analytics";
import { WebVitalTrendChart } from "./WebVitalTrendChart";
import { pivotTrend } from "../model/pivotTrend";

// p75 값을 web-vitals 임계로 tone 매핑(신호등). 단위: ms(CLS만 무차원).
const THRESHOLDS: Record<string, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

function toneFor(metric: string, value: number): "success" | "warning" | "destructive" {
  const t = THRESHOLDS[metric];
  if (!t) return "warning";
  if (value <= t[0]) return "success";
  if (value <= t[1]) return "warning";
  return "destructive";
}

function fmt(metric: string, value: number): string {
  return metric === "CLS" ? value.toFixed(3) : `${Math.round(value)}ms`;
}

// 카드로 노출할 핵심 3종 순서.
const CORE = ["LCP", "INP", "CLS"] as const;

export function PerformancePanel({
  summary,
  byRoute,
  trend,
}: {
  summary: WebVitalP75[];
  byRoute: RouteVitalP75[];
  trend: VitalTrendPoint[];
}) {
  const summaryMap = new Map(summary.map((s) => [s.metric, s]));

  return (
    <section className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h3 className="text-sm font-bold text-foreground">실사용자 성능 (Web Vitals p75 · 최근 7일)</h3>
      <p className="mb-3 text-[11.5px] text-muted-foreground">
        실제 방문자 측정값. 녹색=good, 노랑=needs-improvement, 빨강=poor (web-vitals 임계).
      </p>

      {/* p75 카드 3종 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {CORE.map((metric) => {
          const s = summaryMap.get(metric);
          return (
            <div key={metric} className="rounded-xl border border-border p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">{metric} p75</span>
                {s ? <Badge variant={toneFor(metric, s.p75)}>{fmt(metric, s.p75)}</Badge> : null}
              </div>
              <div className="mt-1 text-lg font-bold text-foreground">
                {s ? fmt(metric, s.p75) : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {s ? `${s.sampleCount} samples` : "데이터 없음"}
              </div>
            </div>
          );
        })}
      </div>

      {/* 추이 차트 */}
      <div className="mt-4">
        <WebVitalTrendChart data={pivotTrend(trend)} />
      </div>

      {/* route별 테이블 */}
      <div className="mt-4 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Route</TableHead>
              <TableHead>Metric</TableHead>
              <TableHead>p75</TableHead>
              <TableHead>Samples</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byRoute.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                  수집된 데이터가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              byRoute.map((r) => (
                <TableRow key={`${r.route}:${r.metric}`}>
                  <TableCell className="font-mono text-xs">{r.route}</TableCell>
                  <TableCell>{r.metric}</TableCell>
                  <TableCell>
                    <Badge variant={toneFor(r.metric, r.p75)}>{fmt(r.metric, r.p75)}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.sampleCount}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
