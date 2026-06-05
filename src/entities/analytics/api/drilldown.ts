import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { db } from "@/shared/lib/db";
import { TAG_DASHBOARD } from "./queries";
import type {
  DateRange,
  DrilldownResult,
  RevenueRow,
  PenaltyRow,
  CancellationRow,
  OccupancyRow,
} from "../model/types";

const MAX = 5000;
const CACHE_OPTS = { revalidate: 60, tags: [TAG_DASHBOARD] };
const num = (v: unknown): number => (v == null ? 0 : Number(v));

function pack<T>(rows: (T & { _total: bigint | number })[]): DrilldownResult<T> {
  const total = num(rows[0]?._total);
  return { rows: rows.map(({ _total, ...rest }) => rest as unknown as T), total, capped: total > MAX };
}

async function _revenue(from: Date, to: Date): Promise<DrilldownResult<RevenueRow>> {
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
    ORDER BY p."paidAt" DESC
    LIMIT ${MAX}
  `);
  return pack(rows);
}

async function _penalty(from: Date, to: Date): Promise<DrilldownResult<PenaltyRow>> {
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
    ORDER BY rj."updatedAt" DESC
    LIMIT ${MAX}
  `);
  return pack(rows);
}

async function _cancellation(from: Date, to: Date): Promise<DrilldownResult<CancellationRow>> {
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
    ORDER BY b."createdAt" DESC
    LIMIT ${MAX}
  `);
  return pack(rows);
}

async function _occupancy(): Promise<DrilldownResult<OccupancyRow>> {
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
    ORDER BY d."departureDate" ASC
    LIMIT ${MAX}
  `);
  return pack(rows);
}

export function getRevenueRows(r: DateRange) {
  return unstable_cache(() => _revenue(r.from, r.to), ["dd-revenue", r.key], CACHE_OPTS)();
}
export function getPenaltyRows(r: DateRange) {
  return unstable_cache(() => _penalty(r.from, r.to), ["dd-penalty", r.key], CACHE_OPTS)();
}
export function getCancellationRows(r: DateRange) {
  return unstable_cache(() => _cancellation(r.from, r.to), ["dd-cancel", r.key], CACHE_OPTS)();
}
export function getOccupancyRows() {
  return unstable_cache(() => _occupancy(), ["dd-occupancy"], CACHE_OPTS)();
}
