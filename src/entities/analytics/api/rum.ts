import { Prisma } from "@prisma/client";
import { cacheTag, cacheLife } from "next/cache";
import { db } from "@/shared/lib/db";
import type { WebVitalP75, RouteVitalP75, VitalTrendPoint } from "../model/types";

export const TAG_RUM = "analytics:rum";
// [Phase 5-C/ADR-0053] 시간 윈도우는 SQL NOW()(쿼리 시점 평가)라 use cache 미스마다
// 정상 재평가. 60s TTL로 흡수. 무인자 → 함수 위치 해시가 고정 키.

const num = (v: unknown): number => (v == null ? 0 : Number(v));

// 메트릭별 p75 (최근 7일).
async function _summary(): Promise<WebVitalP75[]> {
  "use cache";
  cacheTag(TAG_RUM);
  cacheLife({ revalidate: 60 });
  const rows = await db.$queryRaw<{ metric: string; p75: number | null; count: bigint }[]>(Prisma.sql`
    SELECT metric,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75,
           COUNT(*) AS count
    FROM "WebVitalEvent"
    WHERE "createdAt" >= NOW() - INTERVAL '7 days'
    GROUP BY metric
  `);
  return rows.map((r) => ({ metric: r.metric, p75: num(r.p75), sampleCount: num(r.count) }));
}

// route×메트릭별 p75 (최근 7일).
async function _byRoute(): Promise<RouteVitalP75[]> {
  "use cache";
  cacheTag(TAG_RUM);
  cacheLife({ revalidate: 60 });
  const rows = await db.$queryRaw<{ route: string; metric: string; p75: number | null; count: bigint }[]>(Prisma.sql`
    SELECT route, metric,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75,
           COUNT(*) AS count
    FROM "WebVitalEvent"
    WHERE "createdAt" >= NOW() - INTERVAL '7 days'
    GROUP BY route, metric
    ORDER BY route ASC, metric ASC
  `);
  return rows.map((r) => ({ route: r.route, metric: r.metric, p75: num(r.p75), sampleCount: num(r.count) }));
}

// 일자×메트릭별 p75 추이 (최근 14일).
async function _trend(): Promise<VitalTrendPoint[]> {
  "use cache";
  cacheTag(TAG_RUM);
  cacheLife({ revalidate: 60 });
  const rows = await db.$queryRaw<{ day: Date; metric: string; p75: number | null }[]>(Prisma.sql`
    SELECT date_trunc('day', "createdAt") AS day, metric,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75
    FROM "WebVitalEvent"
    WHERE "createdAt" >= NOW() - INTERVAL '14 days'
    GROUP BY day, metric
    ORDER BY day ASC
  `);
  return rows.map((r) => ({
    date: r.day.toISOString().slice(0, 10),
    metric: r.metric,
    p75: num(r.p75),
  }));
}

export function getWebVitalSummary(): Promise<WebVitalP75[]> {
  return _summary();
}
export function getWebVitalByRoute(): Promise<RouteVitalP75[]> {
  return _byRoute();
}
export function getWebVitalTrend(): Promise<VitalTrendPoint[]> {
  return _trend();
}
