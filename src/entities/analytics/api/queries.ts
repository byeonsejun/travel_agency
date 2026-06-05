import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { db } from "@/shared/lib/db";
import type {
  DashboardFilter,
  RevenueSummary,
  CancellationStats,
  SeatOccupancy,
  RevenueTrendPoint,
  StatusSlice,
  ProductOption,
} from "../model/types";

export const TAG_DASHBOARD = "analytics:dashboard";
const CACHE_OPTS: { revalidate: number; tags: string[] } = {
  revalidate: 60,
  tags: [TAG_DASHBOARD],
};

const num = (v: unknown): number => (v == null ? 0 : Number(v));

// productId 필터 조각 — bookingId 컬럼 보유 테이블(Payment/RefundJob)용.
// null 이면 Prisma.empty → 기존 단일 테이블 쿼리와 동일(하위호환).
function pidByBooking(productId: string | null): Prisma.Sql {
  return productId
    ? Prisma.sql`AND "bookingId" IN (
        SELECT id FROM "Booking"
        WHERE "departureId" IN (SELECT id FROM "Departure" WHERE "productId" = ${productId})
      )`
    : Prisma.empty;
}

// Booking 테이블 직접 필터(별칭 없는 쿼리)용.
function pidOnBooking(productId: string | null): Prisma.Sql {
  return productId
    ? Prisma.sql`AND "departureId" IN (SELECT id FROM "Departure" WHERE "productId" = ${productId})`
    : Prisma.empty;
}

// Departure 테이블 직접 필터용.
function pidOnDeparture(productId: string | null): Prisma.Sql {
  return productId ? Prisma.sql`AND "productId" = ${productId}` : Prisma.empty;
}

// ─── KPI 1: 순매출 ───────────────────────────────────────────────
async function _revenue(
  from: Date,
  to: Date,
  productId: string | null
): Promise<RevenueSummary> {
  const pf = pidByBooking(productId);
  const rows = await db.$queryRaw<{ paid: bigint; refunded: bigint }[]>(Prisma.sql`
    SELECT
      COALESCE((SELECT SUM(amount) FROM "Payment"
                WHERE "paidAt" >= ${from} AND "paidAt" < ${to}
                  AND status IN ('PAID', 'PARTIAL_CANCELED', 'CANCELED') ${pf}), 0) AS paid,
      COALESCE((SELECT SUM(amount) FROM "RefundJob"
                WHERE status = 'SUCCEEDED'
                  AND "updatedAt" >= ${from} AND "updatedAt" < ${to} ${pf}), 0) AS refunded
  `);
  const paid = num(rows[0]?.paid);
  const refunded = num(rows[0]?.refunded);
  return { paid, refunded, net: paid - refunded };
}

// ─── KPI 2: 위약금 수익 ──────────────────────────────────────────
async function _penalty(
  from: Date,
  to: Date,
  productId: string | null
): Promise<number> {
  const pf = pidByBooking(productId);
  const rows = await db.$queryRaw<{ penalty: bigint }[]>(Prisma.sql`
    SELECT COALESCE(SUM("penaltyAmount"), 0) AS penalty
    FROM "RefundJob"
    WHERE status = 'SUCCEEDED' AND "updatedAt" >= ${from} AND "updatedAt" < ${to} ${pf}
  `);
  return num(rows[0]?.penalty);
}

// ─── KPI 3: 취소율 (코호트: createdAt∈range) ────────────────────
async function _cancellation(
  from: Date,
  to: Date,
  productId: string | null
): Promise<CancellationStats> {
  const pf = pidOnBooking(productId);
  const rows = await db.$queryRaw<{ total: bigint; canceled: bigint }[]>(Prisma.sql`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (
        WHERE status IN ('CANCELED_BY_USER', 'CANCELED_BY_AGENCY')
      ) AS canceled
    FROM "Booking"
    WHERE "createdAt" >= ${from} AND "createdAt" < ${to} ${pf}
  `);
  const total = num(rows[0]?.total);
  const canceled = num(rows[0]?.canceled);
  return { total, canceled, rate: total === 0 ? 0 : canceled / total };
}

// ─── KPI 4: 좌석 점유율 (현재 스냅샷, range 무관 / product 종속) ──
async function _occupancy(productId: string | null): Promise<SeatOccupancy> {
  const pf = pidOnDeparture(productId);
  const rows = await db.$queryRaw<{ booked: bigint; capacity: bigint }[]>(Prisma.sql`
    SELECT
      COALESCE(SUM("bookedSeats"), 0) AS booked,
      COALESCE(SUM(capacity), 0) AS capacity
    FROM "Departure"
    WHERE "departureDate" >= CURRENT_DATE AND status <> 'CANCELED' ${pf}
  `);
  const booked = num(rows[0]?.booked);
  const capacity = num(rows[0]?.capacity);
  return { booked, capacity, rate: capacity === 0 ? 0 : booked / capacity };
}

// ─── 차트 1: 매출 추이 (일/월 버킷) ─────────────────────────────
async function _trend(
  from: Date,
  to: Date,
  bucket: "day" | "month",
  productId: string | null
): Promise<RevenueTrendPoint[]> {
  const pf = pidByBooking(productId);
  const rows = await db.$queryRaw<{ date: Date; paid: bigint; refunded: bigint }[]>(Prisma.sql`
    WITH paid AS (
      SELECT date_trunc(${bucket}, "paidAt") AS d, SUM(amount) AS amt
      FROM "Payment" WHERE "paidAt" >= ${from} AND "paidAt" < ${to} ${pf}
      GROUP BY 1
    ),
    ref AS (
      SELECT date_trunc(${bucket}, "updatedAt") AS d, SUM(amount) AS amt
      FROM "RefundJob"
      WHERE status = 'SUCCEEDED' AND "updatedAt" >= ${from} AND "updatedAt" < ${to} ${pf}
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

// ─── 차트 2: 예약 상태 분포 (현재 스냅샷 / product 종속) ─────────
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

async function _statusDistribution(
  productId: string | null
): Promise<StatusSlice[]> {
  const pf = pidOnBooking(productId);
  const rows = await db.$queryRaw<{ status: string; n: bigint }[]>(Prisma.sql`
    SELECT status::text AS status, COUNT(*) AS n FROM "Booking"
    WHERE 1=1 ${pf}
    GROUP BY status
  `);
  const grouped = new Map<string, number>();
  for (const r of rows) {
    const label = STATUS_GROUP[r.status] ?? "기타";
    grouped.set(label, (grouped.get(label) ?? 0) + num(r.n));
  }
  return [...grouped.entries()].map(([status, count]) => ({ status, count }));
}

// ─── 상품 옵션 (드롭다운 소스) ──────────────────────────────────
async function _productOptions(): Promise<ProductOption[]> {
  return db.product.findMany({
    select: { id: true, title: true },
    orderBy: { title: "asc" },
  });
}

// ─── 캐시 래핑 (range 4종: 양자화 키 / 스냅샷 2종: product 키) ───
export function getRevenueSummary(f: DashboardFilter) {
  const { startDay, endDay, product } = f.cacheKey;
  return unstable_cache(
    () => _revenue(f.from, f.to, f.productId),
    ["dash-revenue", startDay, endDay, product],
    CACHE_OPTS
  )();
}
export function getPenaltyRevenue(f: DashboardFilter) {
  const { startDay, endDay, product } = f.cacheKey;
  return unstable_cache(
    () => _penalty(f.from, f.to, f.productId),
    ["dash-penalty", startDay, endDay, product],
    CACHE_OPTS
  )();
}
export function getCancellationStats(f: DashboardFilter) {
  const { startDay, endDay, product } = f.cacheKey;
  return unstable_cache(
    () => _cancellation(f.from, f.to, f.productId),
    ["dash-cancel", startDay, endDay, product],
    CACHE_OPTS
  )();
}
export function getSeatOccupancy(f: DashboardFilter) {
  return unstable_cache(
    () => _occupancy(f.productId),
    ["dash-occupancy", f.cacheKey.product],
    CACHE_OPTS
  )();
}
export function getRevenueTrend(f: DashboardFilter) {
  const { startDay, endDay, product } = f.cacheKey;
  return unstable_cache(
    () => _trend(f.from, f.to, f.bucket, f.productId),
    ["dash-trend", startDay, endDay, product],
    CACHE_OPTS
  )();
}
export function getBookingStatusDistribution(f: DashboardFilter) {
  return unstable_cache(
    () => _statusDistribution(f.productId),
    ["dash-status", f.cacheKey.product],
    CACHE_OPTS
  )();
}
export function getProductOptions() {
  return unstable_cache(_productOptions, ["dash-product-options"], {
    revalidate: 300,
    tags: [TAG_DASHBOARD],
  })();
}
