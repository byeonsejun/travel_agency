import { describe, it, expect } from "vitest";
import type { VitalTrendPoint } from "@/entities/analytics";
import { pivotTrend } from "../pivotTrend";

describe("pivotTrend", () => {
  it("같은 날짜의 LCP·INP를 한 행으로 합친다", () => {
    const points: VitalTrendPoint[] = [
      { date: "2026-06-10", metric: "LCP", p75: 2100 },
      { date: "2026-06-10", metric: "INP", p75: 180 },
    ];
    expect(pivotTrend(points)).toEqual([{ date: "2026-06-10", LCP: 2100, INP: 180 }]);
  });

  it("누락된 메트릭은 null로 채운다", () => {
    const points: VitalTrendPoint[] = [{ date: "2026-06-10", metric: "LCP", p75: 2100 }];
    expect(pivotTrend(points)).toEqual([{ date: "2026-06-10", LCP: 2100, INP: null }]);
  });

  it("LCP·INP 외 메트릭(CLS 등)은 무시한다", () => {
    const points: VitalTrendPoint[] = [
      { date: "2026-06-10", metric: "CLS", p75: 0.05 },
      { date: "2026-06-10", metric: "LCP", p75: 2100 },
    ];
    expect(pivotTrend(points)).toEqual([{ date: "2026-06-10", LCP: 2100, INP: null }]);
  });

  it("날짜 오름차순으로 정렬한다 (입력 순서 무관)", () => {
    const points: VitalTrendPoint[] = [
      { date: "2026-06-12", metric: "LCP", p75: 2300 },
      { date: "2026-06-10", metric: "LCP", p75: 2100 },
      { date: "2026-06-11", metric: "LCP", p75: 2200 },
    ];
    expect(pivotTrend(points).map((r) => r.date)).toEqual([
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
    ]);
  });

  it("빈 입력은 빈 배열을 반환한다", () => {
    expect(pivotTrend([])).toEqual([]);
  });

  it("입력 배열을 변이하지 않는다", () => {
    const points: VitalTrendPoint[] = [
      { date: "2026-06-12", metric: "LCP", p75: 2300 },
      { date: "2026-06-10", metric: "INP", p75: 180 },
    ];
    const snapshot = JSON.parse(JSON.stringify(points));
    pivotTrend(points);
    expect(points).toEqual(snapshot);
  });
});
