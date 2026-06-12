import type { VitalTrendPoint } from "@/entities/analytics";

/** 차트가 소비하는 일자별 행(메트릭별 컬럼). client 리프와 공유하는 plain 타입. */
export type WebVitalTrendRow = {
  date: string;
  LCP: number | null;
  INP: number | null;
};

/**
 * trend 평탄 배열(메트릭별 행) → 차트용 일자별 pivot. 순수 변환.
 *
 * ⚠️ 이 함수는 server 컴포넌트(`PerformancePanel`)가 호출하므로 `'use client'`
 * 모듈에 두면 안 된다(client export 는 서버에서 invoke 불가 — RSC 경계). 차트
 * (`WebVitalTrendChart`)는 client 리프라 여기 pivot 결과(plain 배열)만 props 로 받는다.
 */
export function pivotTrend(points: VitalTrendPoint[]): WebVitalTrendRow[] {
  const byDate = new Map<string, WebVitalTrendRow>();
  for (const p of points) {
    const row = byDate.get(p.date) ?? { date: p.date, LCP: null, INP: null };
    if (p.metric === "LCP") row.LCP = p.p75;
    if (p.metric === "INP") row.INP = p.p75;
    byDate.set(p.date, row);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
