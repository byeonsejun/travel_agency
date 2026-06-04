import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { db } from "@/shared/lib/db";
import type {
  DateRange,
  RevenueSummary,
  CancellationStats,
  SeatOccupancy,
  RevenueTrendPoint,
  StatusSlice,
} from "../model/types";

export const TAG_DASHBOARD = "analytics:dashboard";

// $queryRaw 는 SUM 을 bigint(또는 string) 으로 반환할 수 있어 Number() 정규화.
const num = (v: unknown): number => (v == null ? 0 : Number(v));

// ─── KPI 1: 순매출 ───────────────────────────────────────────────
async function _revenue(from: Date, to: Date): Promise<RevenueSummary> {
  const rows = await db.$queryRaw<{ paid: bigint; refunded: bigint }[]>(Prisma.sql`
    SELECT
      COALESCE((SELECT SUM(amount) FROM "Payment"
                WHERE "paidAt" >= ${from} AND "paidAt" < ${to}), 0) AS paid,
      COALESCE((SELECT SUM(amount) FROM "RefundJob"
                WHERE status = 'SUCCEEDED'
                  AND "updatedAt" >= ${from} AND "updatedAt" < ${to}), 0) AS refunded
  `);
  const paid = num(rows[0]?.paid);
  const refunded = num(rows[0]?.refunded);
  return { paid, refunded, net: paid - refunded };
}

// ─── KPI 2: 위약금 수익 ──────────────────────────────────────────
async function _penalty(from: Date, to: Date): Promise<number> {
  const rows = await db.$queryRaw<{ penalty: bigint }[]>(Prisma.sql`
    SELECT COALESCE(SUM("penaltyAmount"), 0) AS penalty
    FROM "RefundJob"
    WHERE status = 'SUCCEEDED' AND "updatedAt" >= ${from} AND "updatedAt" < ${to}
  `);
  return num(rows[0]?.penalty);
}

// ─── KPI 3: 취소율 (코호트: createdAt∈range) ────────────────────
async function _cancellation(from: Date, to: Date): Promise<CancellationStats> {
  const rows = await db.$queryRaw<{ total: bigint; canceled: bigint }[]>(Prisma.sql`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (
        WHERE status IN ('CANCELED_BY_USER', 'CANCELED_BY_AGENCY')
      ) AS canceled
    FROM "Booking"
    WHERE "createdAt" >= ${from} AND "createdAt" < ${to}
  `);
  const total = num(rows[0]?.total);
  const canceled = num(rows[0]?.canceled);
  return { total, canceled, rate: total === 0 ? 0 : canceled / total };
}

// ─── KPI 4: 좌석 점유율 (현재 스냅샷, range 무관) ────────────────
async function _occupancy(): Promise<SeatOccupancy> {
  const rows = await db.$queryRaw<{ booked: bigint; capacity: bigint }[]>(Prisma.sql`
    SELECT
      COALESCE(SUM("bookedSeats"), 0) AS booked,
      COALESCE(SUM(capacity), 0) AS capacity
    FROM "Departure"
    WHERE "departureDate" >= CURRENT_DATE AND status <> 'CANCELED'
  `);
  const booked = num(rows[0]?.booked);
  const capacity = num(rows[0]?.capacity);
  return { booked, capacity, rate: capacity === 0 ? 0 : booked / capacity };
}

// ─── 차트 1: 매출 추이 (일/월 버킷) ─────────────────────────────
async function _trend(
  from: Date,
  to: Date,
  bucket: "day" | "month"
): Promise<RevenueTrendPoint[]> {
  const unit = bucket === "month" ? "month" : "day";
  const rows = await db.$queryRaw<{ date: Date; paid: bigint; refunded: bigint }[]>(Prisma.sql`
    WITH paid AS (
      SELECT date_trunc(${unit}, "paidAt") AS d, SUM(amount) AS amt
      FROM "Payment" WHERE "paidAt" >= ${from} AND "paidAt" < ${to}
      GROUP BY 1
    ),
    ref AS (
      SELECT date_trunc(${unit}, "updatedAt") AS d, SUM(amount) AS amt
      FROM "RefundJob"
      WHERE status = 'SUCCEEDED' AND "updatedAt" >= ${from} AND "updatedAt" < ${to}
      GROUP BY 1
    )
    SELECT
      COALESCE(paid.d, ref.d) AS date,
      COALESCE(paid.amt, 0) AS paid,
      COALESCE(ref.amt, 0) AS refunded
    FROM paid FULL OUTER JOIN ref ON paid.d = ref.d
    ORDER BY 1
  `);
  return rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    paid: num(r.paid),
    refunded: num(r.refunded),
  }));
}

// ─── 차트 2: 예약 상태 분포 (현재 스냅샷) ───────────────────────
const STATUS_GROUP: Record<string, string> = {
  PAID: "PAID/READY",
  READY: "PAID/READY",
  COMPLETED: "완료",
  RECEIVED: "결제대기",
  AWAITING_GROUP: "결제대기",
  DEPARTURE_CONFIRMED: "결제대기",
  CANCELED_BY_USER: "취소",
  CANCELED_BY_AGENCY: "취소",
};

async function _statusDistribution(): Promise<StatusSlice[]> {
  const rows = await db.$queryRaw<{ status: string; n: bigint }[]>(Prisma.sql`
    SELECT status::text AS status, COUNT(*) AS n FROM "Booking" GROUP BY status
  `);
  const grouped = new Map<string, number>();
  for (const r of rows) {
    const label = STATUS_GROUP[r.status] ?? "기타";
    grouped.set(label, (grouped.get(label) ?? 0) + num(r.n));
  }
  return [...grouped.entries()].map(([status, count]) => ({ status, count }));
}

// ─── 캐시 래핑 (60s TTL, key 에 range 포함) ─────────────────────
// 주의: unstable_cache 는 Date 인자를 key 로 직렬화하지 못하므로
// range.key 를 명시 key 파트로 넘긴다(키 충돌·stale 방지).
export function getRevenueSummary(r: DateRange) {
  return unstable_cache(() => _revenue(r.from, r.to), ["dash-revenue", r.key], {
    revalidate: 60,
    tags: [TAG_DASHBOARD],
  })();
}
export function getPenaltyRevenue(r: DateRange) {
  return unstable_cache(() => _penalty(r.from, r.to), ["dash-penalty", r.key], {
    revalidate: 60,
    tags: [TAG_DASHBOARD],
  })();
}
export function getCancellationStats(r: DateRange) {
  return unstable_cache(
    () => _cancellation(r.from, r.to),
    ["dash-cancel", r.key],
    { revalidate: 60, tags: [TAG_DASHBOARD] }
  )();
}
export function getSeatOccupancy() {
  return unstable_cache(() => _occupancy(), ["dash-occupancy"], {
    revalidate: 60,
    tags: [TAG_DASHBOARD],
  })();
}
export function getRevenueTrend(r: DateRange) {
  return unstable_cache(
    () => _trend(r.from, r.to, r.bucket),
    ["dash-trend", r.key],
    { revalidate: 60, tags: [TAG_DASHBOARD] }
  )();
}
export function getBookingStatusDistribution() {
  return unstable_cache(() => _statusDistribution(), ["dash-status"], {
    revalidate: 60,
    tags: [TAG_DASHBOARD],
  })();
}
