import { Prisma } from "@prisma/client";
import { cacheTag, cacheLife } from "next/cache";
import { db } from "@/shared/lib/db";
import { TAG_DASHBOARD } from "./queries";
import type {
  DashboardFilter,
  DrilldownResult,
  RevenueRow,
  PenaltyRow,
  CancellationRow,
  OccupancyRow,
} from "../model/types";

const MAX = 5000;
// [Phase 5-C/ADR-0053] day-key 보존은 queries.ts와 동형 — from/to가 day-aligned이라
// use cache 인자(from,to,product)가 일 단위 안정 키. 60s TTL 자연만료 유지.
const num = (v: unknown): number => (v == null ? 0 : Number(v));

// productId 술어 — 모든 드릴다운 쿼리가 Product 를 별칭 `pr` 로 조인하므로
// 컬럼 비교로 race-free 필터. null = 전체 상품(Prisma.empty → 기존 쿼리와 동일).
// KPI 카드(queries.ts)의 productId 필터와 동일 코호트를 보장해 합계가 정합한다.
function pid(productId: string | null): Prisma.Sql {
  return productId ? Prisma.sql`AND pr.id = ${productId}` : Prisma.empty;
}

function pack<T>(rows: (T & { _total: bigint | number })[]): DrilldownResult<T> {
  const total = num(rows[0]?._total);
  return { rows: rows.map(({ _total, ...rest }) => rest as unknown as T), total, capped: total > MAX };
}

async function _revenue(from: Date, to: Date, productId: string | null): Promise<DrilldownResult<RevenueRow>> {
  "use cache";
  cacheTag(TAG_DASHBOARD);
  cacheLife({ revalidate: 60 });
  const rows = await db.$queryRaw<(RevenueRow & { _total: bigint })[]>(Prisma.sql`
    SELECT to_char(p."paidAt", 'YYYY-MM-DD') AS "paidAt",
           p."tossOrderId" AS "orderId", pr.title AS "productTitle",
           COALESCE(u.name, u.email, '(미상)') AS customer,
           p.amount AS amount, p."refundedAmount" AS "refundedAmount",
           p.status::text AS status, COUNT(*) OVER() AS _total
    FROM "Payment" p
    JOIN "Booking" b ON b.id = p."bookingId"
    JOIN "Departure" d ON d.id = b."departureId"
    JOIN "Product" pr ON pr.id = d."productId"
    JOIN "User" u ON u.id = b."userId"
    WHERE p."paidAt" >= ${from} AND p."paidAt" < ${to}
      AND p.status IN ('PAID', 'PARTIAL_CANCELED', 'CANCELED')
      ${pid(productId)}
    ORDER BY p."paidAt" DESC
    LIMIT ${MAX}
  `);
  return pack(rows);
}

async function _penalty(from: Date, to: Date, productId: string | null): Promise<DrilldownResult<PenaltyRow>> {
  "use cache";
  cacheTag(TAG_DASHBOARD);
  cacheLife({ revalidate: 60 });
  const rows = await db.$queryRaw<(PenaltyRow & { _total: bigint })[]>(Prisma.sql`
    SELECT to_char(rj."updatedAt", 'YYYY-MM-DD') AS "processedAt",
           pr.title AS "productTitle",
           COALESCE(u.name, u.email, '(미상)') AS customer,
           rj.kind::text AS kind, rj."baseAmount" AS "baseAmount",
           rj."penaltyAmount" AS "penaltyAmount", rj.amount AS "refundedAmount",
           COUNT(*) OVER() AS _total
    FROM "RefundJob" rj
    JOIN "Booking" b ON b.id = rj."bookingId"
    JOIN "Departure" d ON d.id = b."departureId"
    JOIN "Product" pr ON pr.id = d."productId"
    JOIN "User" u ON u.id = b."userId"
    WHERE rj.status = 'SUCCEEDED' AND rj."updatedAt" >= ${from} AND rj."updatedAt" < ${to}
      ${pid(productId)}
    ORDER BY rj."updatedAt" DESC
    LIMIT ${MAX}
  `);
  return pack(rows);
}

async function _cancellation(from: Date, to: Date, productId: string | null): Promise<DrilldownResult<CancellationRow>> {
  "use cache";
  cacheTag(TAG_DASHBOARD);
  cacheLife({ revalidate: 60 });
  const rows = await db.$queryRaw<(CancellationRow & { _total: bigint })[]>(Prisma.sql`
    SELECT to_char(b."createdAt", 'YYYY-MM-DD') AS "createdAt",
           COALESCE(to_char(b."canceledAt", 'YYYY-MM-DD'), '') AS "canceledAt",
           pr.title AS "productTitle",
           COALESCE(u.name, u.email, '(미상)') AS customer,
           b.status::text AS status,
           COALESCE(b."cancelReason", '') AS "cancelReason",
           b."totalPrice" AS "totalPrice", COUNT(*) OVER() AS _total
    FROM "Booking" b
    JOIN "Departure" d ON d.id = b."departureId"
    JOIN "Product" pr ON pr.id = d."productId"
    JOIN "User" u ON u.id = b."userId"
    WHERE b."createdAt" >= ${from} AND b."createdAt" < ${to}
      AND b.status IN ('CANCELED_BY_USER', 'CANCELED_BY_AGENCY')
      ${pid(productId)}
    ORDER BY b."createdAt" DESC
    LIMIT ${MAX}
  `);
  return pack(rows);
}

async function _occupancy(productId: string | null): Promise<DrilldownResult<OccupancyRow>> {
  "use cache";
  cacheTag(TAG_DASHBOARD);
  cacheLife({ revalidate: 60 });
  const rows = await db.$queryRaw<(OccupancyRow & { _total: bigint })[]>(Prisma.sql`
    SELECT to_char(d."departureDate", 'YYYY-MM-DD') AS "departureDate",
           pr.title AS "productTitle", d.capacity AS capacity,
           d."bookedSeats" AS "bookedSeats",
           CASE WHEN d.capacity = 0 THEN 0
                ELSE round(d."bookedSeats"::numeric * 100 / d.capacity) END::int AS "occupancyPct",
           d.status::text AS status, COUNT(*) OVER() AS _total
    FROM "Departure" d
    JOIN "Product" pr ON pr.id = d."productId"
    WHERE d."departureDate" >= CURRENT_DATE AND d.status <> 'CANCELED'
      ${pid(productId)}
    ORDER BY d."departureDate" ASC
    LIMIT ${MAX}
  `);
  return pack(rows);
}

// 캐시는 private fn의 use cache가 담당 — 키는 인자(from,to,product)에서 자동 생성.
// queries.ts와 동형: range 종속 3종은 (from,to,product) 키, 스냅샷(occupancy)은 product 키.
export function getRevenueRows(f: DashboardFilter) {
  return _revenue(f.from, f.to, f.productId);
}
export function getPenaltyRows(f: DashboardFilter) {
  return _penalty(f.from, f.to, f.productId);
}
export function getCancellationRows(f: DashboardFilter) {
  return _cancellation(f.from, f.to, f.productId);
}
export function getOccupancyRows(f: DashboardFilter) {
  return _occupancy(f.productId);
}
