import { Prisma } from "@prisma/client";
import { cacheTag, cacheLife } from "next/cache";
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

// [Phase 5-C/ADR-0053] day-key 보존: from/to는 filter.ts에서 UTC 자정으로 day-aligned
// 결정론적 생성(from=startDay 00:00, to=endDay+1d 00:00)이라 use cache 인자로 직접
// 넘겨도 키가 (from,to,product) 일 단위로 안정. [ADR-0032] 60s TTL 자연만료 정책 유지.
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
  "use cache";
  cacheTag(TAG_DASHBOARD);
  cacheLife({ revalidate: 60 });
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
  "use cache";
  cacheTag(TAG_DASHBOARD);
  cacheLife({ revalidate: 60 });
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
  "use cache";
  cacheTag(TAG_DASHBOARD);
  cacheLife({ revalidate: 60 });
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
  "use cache";
  cacheTag(TAG_DASHBOARD);
  cacheLife({ revalidate: 60 });
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
  "use cache";
  cacheTag(TAG_DASHBOARD);
  cacheLife({ revalidate: 60 });
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
  "use cache";
  cacheTag(TAG_DASHBOARD);
  cacheLife({ revalidate: 60 });
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
  "use cache";
  cacheTag(TAG_DASHBOARD);
  cacheLife({ revalidate: 300 });
  return db.product.findMany({
    select: { id: true, title: true },
    orderBy: { title: "asc" },
  });
}

// ─── 캐시 래핑 (use cache) — 키는 private fn 인자에서 자동 생성 ───
// range 종속(from,to,product) 4종 / 스냅샷(product) 2종 / 무인자 1종.
// 함수 위치 해시가 키에 포함되므로 _revenue/_penalty 등은 자동으로 키 분리.
export function getRevenueSummary(f: DashboardFilter) {
  return _revenue(f.from, f.to, f.productId);
}
export function getPenaltyRevenue(f: DashboardFilter) {
  return _penalty(f.from, f.to, f.productId);
}
export function getCancellationStats(f: DashboardFilter) {
  return _cancellation(f.from, f.to, f.productId);
}
export function getSeatOccupancy(f: DashboardFilter) {
  return _occupancy(f.productId);
}
export function getRevenueTrend(f: DashboardFilter) {
  return _trend(f.from, f.to, f.bucket, f.productId);
}
export function getBookingStatusDistribution(f: DashboardFilter) {
  return _statusDistribution(f.productId);
}
export function getProductOptions() {
  return _productOptions();
}
