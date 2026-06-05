# Phase 10 — Dashboard Custom Date Range & Per-Product Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영 대시보드의 기간 제어를 고정 프리셋에서 임의 `start`/`end` 날짜로 확장하고, 상품별 필터(productId)를 추가해 6개 집계 전부를 상품 스코프로 재계산한다.

**Architecture:** URL Search Params(`?start&end&productId`)를 SSOT로 삼고, `parseFilter`가 날짜를 `YYYY-MM-DD` 일 경계로 양자화해 `unstable_cache` 키 폭발을 막는다. 프리셋은 start/end를 채우는 `<Link>` 숏컷으로 강등. `DateRangePicker`·`ProductSelect`를 격리된 `'use client'` 리프 island로 분리하고 `useTransition` 펜딩 처리.

**Tech Stack:** Next.js 15 App Router(force-dynamic RSC), Prisma `$queryRaw` + `Prisma.sql`, `unstable_cache`, Zod, Vitest, 네이티브 `<input type="date">`.

**참고 spec:** `docs/superpowers/specs/2026-06-05-phase10-dashboard-filters.md`

---

## File Structure

**신규**
- `src/entities/analytics/model/filter.ts` — `parseFilter` 순수 함수 (parseRange 대체).
- `src/entities/analytics/model/presets.ts` — 프리셋 → start/end 숏컷 계산.
- `src/entities/analytics/model/__tests__/filter.test.ts`
- `src/entities/analytics/model/__tests__/presets.test.ts`
- `src/widgets/admin-dashboard/ui/DateRangePicker.tsx` — `'use client'` 리프.
- `src/widgets/admin-dashboard/ui/ProductSelect.tsx` — `'use client'` 리프.
- `src/widgets/admin-dashboard/ui/__tests__/ProductSelect.test.tsx`
- `src/widgets/admin-dashboard/ui/__tests__/DateRangePicker.test.tsx`

**수정**
- `src/entities/analytics/model/types.ts` — `DashboardFilter`/`ProductOption` 추가, `DateRange`/`RangeKey` 제거.
- `src/entities/analytics/api/queries.ts` — 6함수 productId 차원 + 양자화 키, `getProductOptions` 추가.
- `src/entities/analytics/index.ts` — barrel 갱신.
- `src/widgets/admin-dashboard/ui/AdminDashboard.tsx` — island 2개 조립.
- `src/widgets/admin-dashboard/ui/DashboardRangeFilter.tsx` — 프리셋 숏컷 재정의.
- `src/app/(admin)/admin/dashboard/page.tsx` — searchParams 확장 + 7번째 쿼리.

**제거**
- `src/entities/analytics/model/range.ts` + `__tests__/range.test.ts` (filter.ts로 흡수).

---

## Task 1: 타입 정의 — DashboardFilter / ProductOption

**Files:**
- Modify: `src/entities/analytics/model/types.ts`

- [x] **Step 1: `DateRange`/`RangeKey` 제거, 새 타입 추가**

`types.ts` 상단 `RangeKey`·`DateRange` 블록(1~11행)을 아래로 교체:

```ts
export interface DashboardFilter {
  /** 집계 하한(포함), UTC 일 경계 00:00:00.000Z. */
  from: Date;
  /** 집계 상한(미포함), endDay + 1일의 UTC 00:00. */
  to: Date;
  /** 추이 버킷. span ≤ 92일 = day, 초과 = month. */
  bucket: "day" | "month";
  /** null = 전체 상품. */
  productId: string | null;
  /** unstable_cache 키 파트 (직렬화 가능 string). */
  cacheKey: {
    startDay: string; // "YYYY-MM-DD"
    endDay: string; // "YYYY-MM-DD"
    product: string; // productId | "all"
  };
}

export interface ProductOption {
  id: string;
  title: string;
}
```

나머지 인터페이스(`RevenueSummary` … `DashboardData`)는 그대로 유지.

- [x] **Step 2: typecheck (의도된 빨강 확인)**

Run: `npm run typecheck`
Expected: `range.ts`/`queries.ts`/`page.tsx` 등에서 `DateRange`/`RangeKey` 참조 에러 발생 — Task 2~10에서 순차 해소. (이 시점 빨강은 정상)

- [x] **Step 3: Commit**

```bash
git add src/entities/analytics/model/types.ts
git commit -m "feat(analytics): replace DateRange/RangeKey with DashboardFilter type"
```

---

## Task 2: parseFilter 순수 함수 (양자화 + 폴백 + 레거시 매핑)

**Files:**
- Create: `src/entities/analytics/model/filter.ts`
- Test: `src/entities/analytics/model/__tests__/filter.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/entities/analytics/model/__tests__/filter.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseFilter } from "../filter";

describe("parseFilter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T05:30:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("미지정이면 최근 30일, bucket=day", () => {
    const f = parseFilter({});
    expect(f.cacheKey.endDay).toBe("2026-06-05");
    expect(f.cacheKey.startDay).toBe("2026-05-06"); // 30일 전
    expect(f.bucket).toBe("day");
    expect(f.productId).toBeNull();
    expect(f.cacheKey.product).toBe("all");
  });

  it("start/end 일 경계로 양자화 (ms 정밀도 제거)", () => {
    const f = parseFilter({ start: "2026-05-01", end: "2026-05-15" });
    expect(f.cacheKey.startDay).toBe("2026-05-01");
    expect(f.cacheKey.endDay).toBe("2026-05-15");
    // to = endDay + 1일 (미포함 상한)
    expect(f.to.toISOString()).toBe("2026-05-16T00:00:00.000Z");
    expect(f.from.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  it("미래 end 는 오늘로 클램프", () => {
    const f = parseFilter({ start: "2026-06-01", end: "2099-01-01" });
    expect(f.cacheKey.endDay).toBe("2026-06-05");
  });

  it("start > end 면 스왑", () => {
    const f = parseFilter({ start: "2026-05-20", end: "2026-05-10" });
    expect(f.cacheKey.startDay).toBe("2026-05-10");
    expect(f.cacheKey.endDay).toBe("2026-05-20");
  });

  it("오타/빈 날짜는 폴백(30일)", () => {
    const f = parseFilter({ start: "garbage", end: "" });
    expect(f.cacheKey.startDay).toBe("2026-05-06");
    expect(f.cacheKey.endDay).toBe("2026-06-05");
  });

  it("배열 입력은 첫 값 사용", () => {
    const f = parseFilter({ start: ["2026-05-01", "x"], end: ["2026-05-03"] });
    expect(f.cacheKey.startDay).toBe("2026-05-01");
    expect(f.cacheKey.endDay).toBe("2026-05-03");
  });

  it("긴 범위(>92일)는 bucket=month", () => {
    const f = parseFilter({ start: "2026-01-01", end: "2026-06-05" });
    expect(f.bucket).toBe("month");
  });

  it("productId 형식 통과 / 불량은 null", () => {
    expect(parseFilter({ productId: "clabc123xyz" }).productId).toBe("clabc123xyz");
    expect(parseFilter({ productId: "clabc123xyz" }).cacheKey.product).toBe("clabc123xyz");
    expect(parseFilter({ productId: "bad id!" }).productId).toBeNull();
    expect(parseFilter({ productId: "bad id!" }).cacheKey.product).toBe("all");
  });

  it("레거시 ?range= 는 start 미지정 시에만 일수로 매핑", () => {
    const f = parseFilter({ range: "7d" });
    expect(f.cacheKey.startDay).toBe("2026-05-29"); // 7일 전
    expect(f.cacheKey.endDay).toBe("2026-06-05");
    // start 명시되면 레거시 무시
    const f2 = parseFilter({ range: "7d", start: "2026-01-01", end: "2026-01-10" });
    expect(f2.cacheKey.startDay).toBe("2026-01-01");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test -- filter.test`
Expected: FAIL — `Cannot find module '../filter'`.

- [ ] **Step 3: parseFilter 구현**

```ts
// src/entities/analytics/model/filter.ts
import type { DashboardFilter } from "./types";

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 30;
const DAY_BUCKET_MAX = 92;
const PRODUCT_ID_RE = /^[a-z0-9]+$/i; // 느슨한 형식; 존재 검증은 조인이 담당
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface DashboardFilterInput {
  start?: string | string[];
  end?: string | string[];
  productId?: string | string[];
  range?: string | string[]; // 레거시 ?range= 매핑용
}

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

const dayStr = (d: Date): string => d.toISOString().slice(0, 10);

/** "YYYY-MM-DD" → UTC 자정 Date, 형식 불일치/무효는 null. */
function parseDay(raw: string | undefined): Date | null {
  if (!raw || !DAY_RE.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 레거시 range key → 일수(start 폴백 폭). 모르면 null. */
function legacyRangeDays(raw: string | undefined): number | null {
  switch (raw) {
    case "today":
      return 0;
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
    case "all":
      return 100 * 365; // 사실상 epoch 근사 → bucket=month 유도
    default:
      return null;
  }
}

export function parseFilter(input: DashboardFilterInput): DashboardFilter {
  const todayMidnight = new Date();
  todayMidnight.setUTCHours(0, 0, 0, 0);

  let startDay = parseDay(first(input.start));
  let endDay = parseDay(first(input.end));

  // end 폴백 = 오늘, 미래 클램프
  if (!endDay) endDay = todayMidnight;
  if (endDay.getTime() > todayMidnight.getTime()) endDay = todayMidnight;

  // start 폴백 = end − (레거시 일수 || 기본 30일)
  if (!startDay) {
    const days = legacyRangeDays(first(input.range)) ?? DEFAULT_DAYS;
    startDay = new Date(endDay.getTime() - days * DAY_MS);
    startDay.setUTCHours(0, 0, 0, 0);
  }

  // 역전 스왑
  if (startDay.getTime() > endDay.getTime()) {
    const t = startDay;
    startDay = endDay;
    endDay = t;
  }

  const from = startDay;
  const to = new Date(endDay.getTime() + DAY_MS); // endDay 포함 → 미포함 상한

  const spanDays = Math.round((to.getTime() - from.getTime()) / DAY_MS);
  const bucket: "day" | "month" = spanDays <= DAY_BUCKET_MAX ? "day" : "month";

  const rawPid = first(input.productId);
  const productId =
    rawPid && PRODUCT_ID_RE.test(rawPid) ? rawPid : null;

  return {
    from,
    to,
    bucket,
    productId,
    cacheKey: {
      startDay: dayStr(startDay),
      endDay: dayStr(endDay),
      product: productId ?? "all",
    },
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test -- filter.test`
Expected: PASS (9 케이스). 만약 productId 케이스가 모호하면 단언을 `expect(parseFilter({ productId: "clabc123" }).productId).toBe("clabc123")` 로 단순화.

- [ ] **Step 5: Commit**

```bash
git add src/entities/analytics/model/filter.ts src/entities/analytics/model/__tests__/filter.test.ts
git commit -m "feat(analytics): parseFilter with day-quantized cache keys"
```

---

## Task 3: 프리셋 숏컷 계산 (presets.ts)

**Files:**
- Create: `src/entities/analytics/model/presets.ts`
- Test: `src/entities/analytics/model/__tests__/presets.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/entities/analytics/model/__tests__/presets.test.ts
import { describe, it, expect } from "vitest";
import { presetRange, PRESETS } from "../presets";

const NOW = new Date("2026-06-05T05:30:00.000Z");

describe("presetRange", () => {
  it("today: start=end=오늘", () => {
    expect(presetRange("today", NOW)).toEqual({
      start: "2026-06-05",
      end: "2026-06-05",
    });
  });
  it("7d: start=7일 전, end=오늘", () => {
    expect(presetRange("7d", NOW)).toEqual({
      start: "2026-05-29",
      end: "2026-06-05",
    });
  });
  it("30d", () => {
    expect(presetRange("30d", NOW).start).toBe("2026-05-06");
  });
  it("90d", () => {
    expect(presetRange("90d", NOW).start).toBe("2026-03-07");
  });
  it("all: start=2000-01-01", () => {
    expect(presetRange("all", NOW)).toEqual({
      start: "2000-01-01",
      end: "2026-06-05",
    });
  });
  it("PRESETS 는 5개 라벨", () => {
    expect(PRESETS.map((p) => p.key)).toEqual([
      "today",
      "7d",
      "30d",
      "90d",
      "all",
    ]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test -- presets.test`
Expected: FAIL — `Cannot find module '../presets'`.

- [ ] **Step 3: 구현**

```ts
// src/entities/analytics/model/presets.ts
export type PresetKey = "today" | "7d" | "30d" | "90d" | "all";

export interface PresetRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "오늘" },
  { key: "7d", label: "7일" },
  { key: "30d", label: "30일" },
  { key: "90d", label: "90일" },
  { key: "all", label: "전체" },
];

const DAY_MS = 86_400_000;
const dayStr = (d: Date): string => d.toISOString().slice(0, 10);

export function presetRange(key: PresetKey, now: Date = new Date()): PresetRange {
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  const endStr = dayStr(end);

  if (key === "today") return { start: endStr, end: endStr };
  if (key === "all") return { start: "2000-01-01", end: endStr };

  const days = key === "7d" ? 7 : key === "30d" ? 30 : 90;
  const start = new Date(end.getTime() - days * DAY_MS);
  return { start: dayStr(start), end: endStr };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test -- presets.test`
Expected: PASS (6 케이스).

- [ ] **Step 5: Commit**

```bash
git add src/entities/analytics/model/presets.ts src/entities/analytics/model/__tests__/presets.test.ts
git commit -m "feat(analytics): preset shortcut range computation"
```

---

## Task 4: 쿼리 layer — productId 차원 + 양자화 키 + getProductOptions

**Files:**
- Modify: `src/entities/analytics/api/queries.ts`

- [ ] **Step 1: productId 필터 헬퍼 + 6 집계 함수 시그니처 변경**

`queries.ts`의 import·헬퍼 영역을 갱신하고, 각 `_fn`이 `productId: string | null`을 받아 조건부 `Prisma.sql` 조각을 합성하도록 수정한다. 아래로 파일 전체를 교체:

```ts
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
```

- [ ] **Step 2: typecheck (queries.ts 단독 통과 확인)**

Run: `npm run typecheck`
Expected: `queries.ts` 관련 에러 0. 남은 에러는 `index.ts`/`page.tsx`/위젯(Task 5~10) 뿐. `DateRange` import 잔존 에러가 queries.ts에 없어야 함.

- [ ] **Step 3: Commit**

```bash
git add src/entities/analytics/api/queries.ts
git commit -m "feat(analytics): add productId dimension + quantized cache keys to 6 aggregates"
```

---

## Task 5: barrel 갱신 (index.ts)

**Files:**
- Modify: `src/entities/analytics/index.ts`

- [ ] **Step 1: barrel 교체**

전체를 아래로 교체:

```ts
export { parseFilter } from "./model/filter";
export type { DashboardFilterInput } from "./model/filter";
export { presetRange, PRESETS } from "./model/presets";
export type { PresetKey, PresetRange } from "./model/presets";
export type {
  DashboardFilter,
  ProductOption,
  RevenueSummary,
  CancellationStats,
  SeatOccupancy,
  RevenueTrendPoint,
  StatusSlice,
  DashboardData,
} from "./model/types";
export {
  getRevenueSummary,
  getPenaltyRevenue,
  getCancellationStats,
  getSeatOccupancy,
  getRevenueTrend,
  getBookingStatusDistribution,
  getProductOptions,
  TAG_DASHBOARD,
} from "./api/queries";
```

- [ ] **Step 2: 구식 range.ts 제거**

Run:
```bash
git rm src/entities/analytics/model/range.ts src/entities/analytics/model/__tests__/range.test.ts
```

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: 남은 에러는 `page.tsx`·`AdminDashboard.tsx`·`DashboardRangeFilter.tsx` 뿐(Task 6~10). analytics 슬라이스 내부 에러 0.

- [ ] **Step 4: Commit**

```bash
git add src/entities/analytics/index.ts
git commit -m "feat(analytics): export parseFilter/presets/getProductOptions, drop parseRange"
```

---

## Task 6: ProductSelect island

**Files:**
- Create: `src/widgets/admin-dashboard/ui/ProductSelect.tsx`
- Test: `src/widgets/admin-dashboard/ui/__tests__/ProductSelect.test.tsx`

- [ ] **Step 1: 실패 테스트 작성 (URL 갱신 + start/end 보존)**

```tsx
// src/widgets/admin-dashboard/ui/__tests__/ProductSelect.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProductSelect } from "../ProductSelect";

const push = vi.fn();
let searchParams = new URLSearchParams("start=2026-05-01&end=2026-05-15");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}));

describe("ProductSelect", () => {
  beforeEach(() => {
    push.mockClear();
    searchParams = new URLSearchParams("start=2026-05-01&end=2026-05-15");
  });

  it("상품 선택 시 productId 추가하고 start/end 보존", () => {
    render(
      <ProductSelect
        options={[{ id: "p1", title: "도쿄" }]}
        current={null}
      />
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "p1" } });
    expect(push).toHaveBeenCalledTimes(1);
    const url = push.mock.calls[0][0] as string;
    expect(url).toContain("productId=p1");
    expect(url).toContain("start=2026-05-01");
    expect(url).toContain("end=2026-05-15");
  });

  it("전체(all) 선택 시 productId 제거", () => {
    searchParams = new URLSearchParams("start=2026-05-01&productId=p1");
    render(
      <ProductSelect options={[{ id: "p1", title: "도쿄" }]} current="p1" />
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "all" } });
    const url = push.mock.calls[0][0] as string;
    expect(url).not.toContain("productId");
    expect(url).toContain("start=2026-05-01");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test -- ProductSelect.test`
Expected: FAIL — `Cannot find module '../ProductSelect'`.

- [ ] **Step 3: 구현 (SortSelect 패턴)**

```tsx
// src/widgets/admin-dashboard/ui/ProductSelect.tsx
"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ProductOption } from "@/entities/analytics";

export function ProductSelect({
  options,
  current,
}: {
  options: ProductOption[];
  current: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = new URLSearchParams(params.toString());
    const value = e.target.value;
    if (value === "all") next.delete("productId");
    else next.set("productId", value);
    // start/end 는 params 복사로 자동 보존. useTransition: 타이머 없음 → cleanup 불요.
    startTransition(() => {
      router.push(`/admin/dashboard?${next.toString()}`);
    });
  };

  return (
    <div className="relative inline-flex items-center">
      <select
        value={current ?? "all"}
        onChange={handleChange}
        disabled={isPending}
        aria-busy={isPending}
        className={`rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12.5px] font-medium text-gray-700 hover:border-gray-400 focus:border-red-500 focus:outline-none ${
          isPending ? "opacity-50" : ""
        }`}
      >
        <option value="all">전체 상품</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.title}
          </option>
        ))}
      </select>
      {isPending && (
        <span
          aria-hidden="true"
          className="absolute right-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-red-600"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test -- ProductSelect.test`
Expected: PASS (2 케이스).

- [ ] **Step 5: Commit**

```bash
git add src/widgets/admin-dashboard/ui/ProductSelect.tsx src/widgets/admin-dashboard/ui/__tests__/ProductSelect.test.tsx
git commit -m "feat(admin-dashboard): ProductSelect island (productId URL sync, preserves dates)"
```

---

## Task 7: DateRangePicker island

**Files:**
- Create: `src/widgets/admin-dashboard/ui/DateRangePicker.tsx`
- Test: `src/widgets/admin-dashboard/ui/__tests__/DateRangePicker.test.tsx`

- [ ] **Step 1: 실패 테스트 작성 (적용 시 start/end 갱신 + productId 보존)**

```tsx
// src/widgets/admin-dashboard/ui/__tests__/DateRangePicker.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DateRangePicker } from "../DateRangePicker";

const push = vi.fn();
let searchParams = new URLSearchParams("productId=p1");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}));

describe("DateRangePicker", () => {
  beforeEach(() => {
    push.mockClear();
    searchParams = new URLSearchParams("productId=p1");
  });

  it("적용 시 입력한 start/end 로 push, productId 보존", () => {
    render(<DateRangePicker start="2026-05-01" end="2026-05-15" />);
    fireEvent.change(screen.getByLabelText("시작일"), {
      target: { value: "2026-04-01" },
    });
    fireEvent.change(screen.getByLabelText("종료일"), {
      target: { value: "2026-04-30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    const url = push.mock.calls[0][0] as string;
    expect(url).toContain("start=2026-04-01");
    expect(url).toContain("end=2026-04-30");
    expect(url).toContain("productId=p1");
  });

  it("프리셋(7일) 클릭 시 즉시 push", () => {
    render(<DateRangePicker start="2026-05-01" end="2026-05-15" />);
    fireEvent.click(screen.getByRole("button", { name: "7일" }));
    expect(push).toHaveBeenCalledTimes(1);
    const url = push.mock.calls[0][0] as string;
    expect(url).toContain("start=");
    expect(url).toContain("productId=p1");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test -- DateRangePicker.test`
Expected: FAIL — `Cannot find module '../DateRangePicker'`.

- [ ] **Step 3: 구현 (네이티브 date input + 프리셋 칩)**

```tsx
// src/widgets/admin-dashboard/ui/DateRangePicker.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PRESETS, presetRange } from "@/entities/analytics";

export function DateRangePicker({
  start,
  end,
}: {
  start: string;
  end: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  // 로컬 편집 버퍼(비제어 대용). URL 이 SSOT지만 "적용" 전까지 입력 누적이 필요.
  const [draftStart, setDraftStart] = useState(start);
  const [draftEnd, setDraftEnd] = useState(end);

  const pushWith = (s: string, e: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("start", s);
    next.set("end", e);
    startTransition(() => {
      router.push(`/admin/dashboard?${next.toString()}`);
    });
  };

  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <div className="inline-flex gap-0.5 rounded-lg border border-gray-200 bg-white p-1 text-[12px]">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => {
              const r = presetRange(p.key);
              setDraftStart(r.start);
              setDraftEnd(r.end);
              pushWith(r.start, r.end);
            }}
            className="rounded-md px-2.5 py-1 text-gray-500 hover:bg-gray-100"
          >
            {p.label}
          </button>
        ))}
      </div>

      <label className="sr-only" htmlFor="dash-start">
        시작일
      </label>
      <input
        id="dash-start"
        aria-label="시작일"
        type="date"
        value={draftStart}
        onChange={(e) => setDraftStart(e.target.value)}
        className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[12.5px] text-gray-700"
      />
      <span className="text-gray-400">~</span>
      <label className="sr-only" htmlFor="dash-end">
        종료일
      </label>
      <input
        id="dash-end"
        aria-label="종료일"
        type="date"
        value={draftEnd}
        onChange={(e) => setDraftEnd(e.target.value)}
        className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[12.5px] text-gray-700"
      />
      <button
        type="button"
        onClick={() => pushWith(draftStart, draftEnd)}
        disabled={isPending}
        aria-busy={isPending}
        className={`rounded-lg bg-red-700 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-red-800 ${
          isPending ? "opacity-50" : ""
        }`}
      >
        적용
      </button>
    </div>
  );
}
```

> 참고: `value`+`onChange`로 제어하지만 SSOT는 URL이다. 로컬 state는 "적용 전 편집 버퍼"일 뿐 — 적용 시 URL push로 RSC 재요청, 마운트 시 props(`start`/`end`)가 초기값. 타이머/리스너 없음 → cleanup 불요.

- [ ] **Step 4: 통과 확인**

Run: `npm run test -- DateRangePicker.test`
Expected: PASS (2 케이스).

- [ ] **Step 5: Commit**

```bash
git add src/widgets/admin-dashboard/ui/DateRangePicker.tsx src/widgets/admin-dashboard/ui/__tests__/DateRangePicker.test.tsx
git commit -m "feat(admin-dashboard): DateRangePicker island (native date inputs + preset chips)"
```

---

## Task 8: DashboardRangeFilter 제거 / AdminDashboard 조립

**Files:**
- Modify: `src/widgets/admin-dashboard/ui/AdminDashboard.tsx`
- Delete: `src/widgets/admin-dashboard/ui/DashboardRangeFilter.tsx`

- [ ] **Step 1: 구식 DashboardRangeFilter 제거**

Run:
```bash
git rm src/widgets/admin-dashboard/ui/DashboardRangeFilter.tsx
```

(프리셋은 DateRangePicker 내부 칩으로 흡수됨 — 별도 컴포넌트 불요.)

- [ ] **Step 2: AdminDashboard 교체 (island 2개 조립)**

```tsx
// src/widgets/admin-dashboard/ui/AdminDashboard.tsx
import type { DashboardData, ProductOption } from "@/entities/analytics";
import { DashboardKpiCards } from "./DashboardKpiCards";
import { DateRangePicker } from "./DateRangePicker";
import { ProductSelect } from "./ProductSelect";
import { RevenueTrendChart } from "./RevenueTrendChart";
import { BookingStatusDonut } from "./BookingStatusDonut";

export function AdminDashboard({
  data,
  start,
  end,
  productId,
  productOptions,
}: {
  data: DashboardData;
  start: string;
  end: string;
  productId: string | null;
  productOptions: ProductOption[];
}) {
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">운영 대시보드</h1>
        <div className="flex flex-wrap items-center gap-2">
          <ProductSelect options={productOptions} current={productId} />
          <DateRangePicker start={start} end={end} />
        </div>
      </div>

      <DashboardKpiCards
        revenue={data.revenue}
        penaltyRevenue={data.penaltyRevenue}
        cancellation={data.cancellation}
        occupancy={data.occupancy}
      />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.7fr_1fr]">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900">매출 추이</h3>
          <p className="mb-3 text-[11.5px] text-gray-400">
            {data.trend.length > 0 ? "기간 내 결제액 vs 환불액" : "데이터 없음"}
          </p>
          <RevenueTrendChart data={data.trend} />
        </section>
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900">예약 상태 분포</h3>
          <p className="mb-3 text-[11.5px] text-gray-400">
            {productId ? "선택 상품 기준" : "전체 예약 기준"}
          </p>
          <BookingStatusDonut data={data.statusDistribution} />
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: 남은 에러는 `page.tsx`(Task 9)뿐.

- [ ] **Step 4: Commit**

```bash
git add src/widgets/admin-dashboard/ui/AdminDashboard.tsx
git commit -m "feat(admin-dashboard): compose ProductSelect + DateRangePicker, drop RangeFilter"
```

---

## Task 9: page.tsx 배선 (searchParams 확장 + 7쿼리 병렬)

**Files:**
- Modify: `src/app/(admin)/admin/dashboard/page.tsx`

- [ ] **Step 1: page 교체**

```tsx
// src/app/(admin)/admin/dashboard/page.tsx
import {
  parseFilter,
  getRevenueSummary,
  getPenaltyRevenue,
  getCancellationStats,
  getSeatOccupancy,
  getRevenueTrend,
  getBookingStatusDistribution,
  getProductOptions,
} from "@/entities/analytics";
import { AdminDashboard } from "@/widgets/admin-dashboard";

// admin route 는 항상 신선(권한 검증 + 운영 즉시성). 집계 SQL 은 내부 60s 캐시로 흡수.
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    start?: string;
    end?: string;
    productId?: string;
    range?: string; // 레거시 북마크 호환
  }>;
}) {
  const sp = await searchParams;
  const filter = parseFilter(sp);

  // 독립 집계 6종 + 상품 옵션 병렬 (N+1 0).
  const [
    revenue,
    penaltyRevenue,
    cancellation,
    occupancy,
    trend,
    statusDistribution,
    productOptions,
  ] = await Promise.all([
    getRevenueSummary(filter),
    getPenaltyRevenue(filter),
    getCancellationStats(filter),
    getSeatOccupancy(filter),
    getRevenueTrend(filter),
    getBookingStatusDistribution(filter),
    getProductOptions(),
  ]);

  return (
    <AdminDashboard
      start={filter.cacheKey.startDay}
      end={filter.cacheKey.endDay}
      productId={filter.productId}
      productOptions={productOptions}
      data={{
        revenue,
        penaltyRevenue,
        cancellation,
        occupancy,
        trend,
        statusDistribution,
      }}
    />
  );
}
```

- [ ] **Step 2: 전체 typecheck 통과**

Run: `npm run typecheck`
Expected: 에러 0 (전 슬라이스 정합).

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/admin/dashboard/page.tsx"
git commit -m "feat(admin-dashboard): wire parseFilter + product options into page"
```

---

## Task 10: 종합 검증 (QA 증거 수집)

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 전체 테스트·타입·린트**

Run:
```bash
npm run typecheck && npm run test && npm run lint
```
Expected: 모두 통과. `filter.test`/`presets.test`/`ProductSelect.test`/`DateRangePicker.test` 포함 green.

- [ ] **Step 2: client 경계 회귀 확인 (정확히 4개)**

Run:
```bash
grep -rl "use client" src/widgets/admin-dashboard/ui/
```
Expected: 정확히 4개 — `RevenueTrendChart.tsx`, `BookingStatusDonut.tsx`, `ProductSelect.tsx`, `DateRangePicker.tsx`. ([ADR-0033] 차트 격리 무손상 + 신규 island 2개.)

- [ ] **Step 3: 런타임 증거 — 상품 스코핑 동작**

dev 서버 기동 후 admin 매직링크 로그인(`npm run dev` 콘솔의 `📧 [DEV] Magic link`). 아래 SQL 대조로 KPI 정확성 증거 수집:

Run (DB count 기준값):
```bash
npx prisma studio  # 또는 psql 로 특정 productId 의 Payment 합 확인
```
브라우저 검증:
- `/admin/dashboard` → 전체 KPI 표시.
- `/admin/dashboard?start=2026-01-01&end=2026-06-05` → 매출추이 bucket 이 month(>92일).
- 상품 드롭다운에서 seed 상품 1개 선택 → KPI 4종이 전체 대비 감소(또는 동일), URL 에 `productId=` 추가, start/end 보존.
- 존재하지 않는 productId(`?productId=zzz`) → KPI 전부 0, 에러 없음.

증거: 위 4개 URL 의 스크린샷 또는 KPI 수치를 보고서에 인용.

- [ ] **Step 4: 캐시 양자화 증거 (선택)**

같은 `?start=2026-05-01&end=2026-05-15` 를 60초 내 2회 조회 → 서버 로그에 `_revenue` SQL 이 1회만(캐시 적중). `to` 가 ms 가 아닌 일 경계라 키 동일.

- [ ] **Step 5: 플랜 체크박스 최종 확인**

Run:
```bash
grep -n "\- \[ \]" docs/superpowers/plans/2026-06-05-phase10-dashboard-filters-plan.md
```
Expected: Task 10까지 완료 시 출력 없음(전부 `[x]`). 남으면 미완료 항목 처리 후 진행.

- [ ] **Step 6: Commit (검증 로그 + 체크박스 동기화)**

```bash
git add docs/superpowers/plans/2026-06-05-phase10-dashboard-filters-plan.md
git commit -m "test(admin-dashboard): Phase 10 verification evidence + plan checkbox sync"
```

---

## Task 11: ADR-0037 발행

**Files:**
- Create: `docs/superpowers/adr/0037-dashboard-quantized-cache-keys.md`
- Modify: `docs/superpowers/adr/README.md`

> ⚠️ 넘버링: 저장소 실제 최신 ADR은 **0036**이다. (지시상 언급된 "Phase 9 ADR-0037"은 저장소에 부재 — 0038로 가면 0037 갭 발생.) 따라서 **0037**로 발행해 시퀀스 연속성 유지. 발행 전 `ls docs/superpowers/adr/ | tail -3` 로 재확인.

- [ ] **Step 1: template 복사 후 작성**

`docs/superpowers/adr/template.md` 를 복사해 `0037-dashboard-quantized-cache-keys.md` 작성. 4섹션 고정:
- **Context**: enum(`range.key`) 키 → 임의 start/end 전환 시 `to=now`(ms) 가 매 요청 유니크해 `unstable_cache` 영구 미스. 상품 차원까지 추가되면 키 카디널리티 폭발.
- **Decision**: start/end 를 `YYYY-MM-DD` 일 경계로 양자화 + `to` 를 오늘-끝으로 클램프해 키 안정화. 키 = `["dash-X", startDay, endDay, productId|"all"]`. 프리셋은 RangeKey 제거 후 start/end 를 채우는 `<Link>` 숏컷으로 강등.
- **Consequences**: (+) 과거 고정구간·동일일 동시조회 캐시 적중, 60s TTL 의미 보존. (+) 상품 스코프 6쿼리 일관. (−) 자정 경과 시 "오늘" 키 변경(의도된 신선화). (−) 키 카디널리티 = 구간수×상품수 (TTL 60s 로 흡수).
- **Alternatives Considered**: (a) 커스텀 비캐시 — 동시/반복 조회 보호막 상실로 거부. (b) `unstable_cache` 전면 제거 — DB 부하 + force-dynamic 매요청 재집계로 거부. (c) `react-day-picker` 등 캘린더 라이브러리 — 무의존성·RSC 친화 위배(네이티브 `<input type="date">` 충분)로 거부.

- [ ] **Step 2: README 인덱스 한 줄 추가**

`docs/superpowers/adr/README.md` 표 끝(0036 행 다음)에 추가:
```markdown
| 0037  | [대시보드 start/end 일 양자화 캐시 키 + 프리셋=숏컷 (Phase 10)](./0037-dashboard-quantized-cache-keys.md) | Accepted | 2026-06-05   |
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/adr/0037-dashboard-quantized-cache-keys.md docs/superpowers/adr/README.md
git commit -m "docs(adr): 0037 dashboard quantized cache keys + preset shortcuts"
```

---

## 최종 체크리스트

- [ ] `parseFilter` 양자화·폴백·클램프·스왑·레거시 매핑 단위 테스트 green
- [ ] `presetRange` 5종 단위 테스트 green
- [ ] 6 집계 함수 productId 차원 + 양자화 키 적용, productId=null 시 하위호환
- [ ] `getProductOptions` 드롭다운 소스 (5m 캐시)
- [ ] `ProductSelect`/`DateRangePicker` island URL 동기화 + start/end·productId 상호 보존 테스트 green
- [ ] `AdminDashboard` island 2개 조립, `DashboardRangeFilter` 제거
- [ ] `page.tsx` 7쿼리 병렬 + 레거시 range 호환
- [ ] client 경계 정확히 4개 (grep 증거)
- [ ] 런타임 상품 스코핑 + 미존재 productId=0 증거
- [ ] `npm run typecheck && npm run test && npm run lint` 전부 green
- [ ] ADR-0037 발행 + README 인덱스
```
