# Phase 6 — 관리자 운영 대시보드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** admin이 누적된 결제·환불·예약 데이터를 단일 `/admin/dashboard`에서 집계·시각화로 조망한다.

**Architecture:** 집계는 전부 RSC에서 `entities/analytics`의 `$queryRaw`(unstable_cache 60s)로 수행하고, 기간 필터는 URL `searchParams`로 동기화하며, Recharts 차트는 `'use client'` 리프에 plain 배열을 props로 주입해 렌더만 클라이언트로 격리한다.

**Tech Stack:** Next.js 15 App Router · Prisma 5 `$queryRaw` · Recharts(신규) · Vitest 2(TDD) · Tailwind · FSD.

> 참조 스펙: `docs/superpowers/specs/2026-06-04-phase-6-admin-dashboard.md`
> 페르소나: 🏛️ Architect(슬라이스 신설·단방향) / ⚙️ Backend(집계 SQL·캐시) / 🎨 Frontend('use client' 리프·searchParams) / 🔬 QA(증거)

---

## File Structure (decomposition)

```
src/entities/analytics/
  model/range.ts          # parseRange(): 순수함수 — searchParam → DateRange
  model/types.ts          # DateRange, RevenueSummary, RevenueTrendPoint, StatusSlice, DashboardData
  api/queries.ts          # 6개 집계 (unstable_cache + $queryRaw)
  model/__tests__/range.test.ts
  index.ts                # barrel

src/widgets/admin-dashboard/
  ui/AdminDashboard.tsx        # server: 전체 조립
  ui/DashboardKpiCards.tsx     # server: KPI 4 카드
  ui/DashboardRangeFilter.tsx  # server: Link 기반 기간 탭
  ui/RevenueTrendChart.tsx     # 'use client' Recharts BarChart 리프
  ui/BookingStatusDonut.tsx    # 'use client' Recharts PieChart 리프
  ui/format.ts                 # 원화/퍼센트 포맷 순수 헬퍼
  ui/__tests__/format.test.ts
  index.ts                # barrel

src/app/(admin)/admin/dashboard/page.tsx   # RSC 엔트리(force-dynamic)
src/app/(admin)/admin/layout.tsx           # nav에 "대시보드" 추가 (modify)
src/app/(admin)/admin/page.tsx             # redirect → /admin/dashboard (modify)
src/features/auth/ui/UserNavIsland.tsx     # 관리자 링크 href 갱신 (modify, 경로 확인 필요)
package.json                               # recharts 의존성 (modify)
```

세 단계가 Task로 분리된다: **(A) 집계 read-model → (B) 차트/카드 컴포넌트 → (C) 레이아웃 조립·진입점**.

---

## Task 1: recharts 의존성 추가

**Files:**
- Modify: `package.json`

- [ ] **Step 1: recharts 설치**

Run: `npm install recharts@^2.13.0`
Expected: `package.json` dependencies에 `"recharts"` 추가, 설치 성공.

- [ ] **Step 2: 타입 동반 확인**

Run: `node -e "require.resolve('recharts')"`
Expected: 에러 없이 경로 출력 (recharts는 자체 타입 번들 — `@types` 불요).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(dashboard): add recharts for admin dashboard charts"
```

---

## Task 2: `parseRange` 순수함수 (TDD)

기간 필터 입력(searchParam)을 `{ from, to, key, bucket }`으로 변환하는 순수함수. `useState` 대신 URL 기반.

**Files:**
- Create: `src/entities/analytics/model/types.ts`
- Create: `src/entities/analytics/model/range.ts`
- Test: `src/entities/analytics/model/__tests__/range.test.ts`

- [ ] **Step 1: 타입 정의**

`src/entities/analytics/model/types.ts`:
```typescript
export type RangeKey = "today" | "7d" | "30d" | "90d" | "all";

export interface DateRange {
  /** 집계 하한(포함). all 이면 epoch(1970-01-01). */
  from: Date;
  /** 집계 상한(미포함) = 지금. */
  to: Date;
  key: RangeKey;
  /** 추이 차트 버킷 단위. all=월별, 그 외 일별. */
  bucket: "day" | "month";
}

export interface RevenueSummary {
  paid: number; // Σ 결제액(원)
  refunded: number; // Σ 실환불액(원)
  net: number; // paid − refunded
}

export interface CancellationStats {
  total: number; // range 내 생성 booking
  canceled: number; // 그 중 취소
  rate: number; // canceled / total (0~1), total=0 이면 0
}

export interface SeatOccupancy {
  booked: number;
  capacity: number;
  rate: number; // booked / capacity (0~1), capacity=0 이면 0
}

export interface RevenueTrendPoint {
  /** ISO 날짜 문자열 (버킷 라벨). */
  date: string;
  paid: number;
  refunded: number;
}

export interface StatusSlice {
  status: string; // 그룹 라벨 (예: "PAID/READY")
  count: number;
}

export interface DashboardData {
  revenue: RevenueSummary;
  penaltyRevenue: number;
  cancellation: CancellationStats;
  occupancy: SeatOccupancy;
  trend: RevenueTrendPoint[];
  statusDistribution: StatusSlice[];
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/entities/analytics/model/__tests__/range.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseRange } from "../range";

describe("parseRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 고정 기준 시각: 2026-06-04T09:00:00+09:00 (UTC 00:00)
    vi.setSystemTime(new Date("2026-06-04T00:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("기본값: 미지정이면 30d", () => {
    const r = parseRange(undefined);
    expect(r.key).toBe("30d");
    expect(r.bucket).toBe("day");
  });

  it("오타/미지원 값이면 30d 폴백", () => {
    expect(parseRange("garbage").key).toBe("30d");
    expect(parseRange("").key).toBe("30d");
  });

  it("7d: from 은 to 보다 7일 전", () => {
    const r = parseRange("7d");
    expect(r.key).toBe("7d");
    const diffDays = (r.to.getTime() - r.from.getTime()) / 86_400_000;
    expect(Math.round(diffDays)).toBe(7);
  });

  it("today: from 은 오늘 00:00(UTC 기준 자정)", () => {
    const r = parseRange("today");
    expect(r.key).toBe("today");
    expect(r.from.getTime()).toBeLessThan(r.to.getTime());
  });

  it("all: from 은 epoch, bucket 은 month", () => {
    const r = parseRange("all");
    expect(r.from.getTime()).toBe(0);
    expect(r.bucket).toBe("month");
  });

  it("배열(중복 쿼리파라미터) 입력도 안전하게 폴백", () => {
    // Next searchParams 는 string | string[] | undefined
    expect(parseRange(["7d", "30d"] as unknown as string).key).toBe("30d");
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm run test -- src/entities/analytics/model/__tests__/range.test.ts`
Expected: FAIL — `parseRange is not a function` (range.ts 미존재).

- [ ] **Step 4: 최소 구현**

`src/entities/analytics/model/range.ts`:
```typescript
import type { DateRange, RangeKey } from "./types";

const VALID: ReadonlySet<RangeKey> = new Set([
  "today",
  "7d",
  "30d",
  "90d",
  "all",
]);

const DAYS: Record<Exclude<RangeKey, "all" | "today">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/**
 * searchParam(string | string[] | undefined) → DateRange.
 * 미지정·오타·배열 입력은 모두 "30d"로 폴백(.catch 정신). useState 미사용 — URL이 SSOT.
 */
export function parseRange(raw: unknown): DateRange {
  const key: RangeKey =
    typeof raw === "string" && VALID.has(raw as RangeKey)
      ? (raw as RangeKey)
      : "30d";

  const to = new Date();

  if (key === "all") {
    return { from: new Date(0), to, key, bucket: "month" };
  }

  if (key === "today") {
    const from = new Date(to);
    from.setUTCHours(0, 0, 0, 0);
    return { from, to, key, bucket: "day" };
  }

  const from = new Date(to.getTime() - DAYS[key] * 86_400_000);
  return { from, to, key, bucket: "day" };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm run test -- src/entities/analytics/model/__tests__/range.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/entities/analytics/model
git commit -m "feat(analytics): parseRange pure function for URL-based date filter"
```

---

## Task 3: 집계 쿼리 — `queries.ts` (read-model)

6개 집계 함수. 전부 `db.$queryRaw` + `Prisma.sql`, 각각 `unstable_cache`(60s, key에 range 포함).

**Files:**
- Create: `src/entities/analytics/api/queries.ts`
- Create: `src/entities/analytics/index.ts`

- [ ] **Step 1: 집계 함수 구현**

`src/entities/analytics/api/queries.ts`:
```typescript
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
```

- [ ] **Step 2: barrel export**

`src/entities/analytics/index.ts`:
```typescript
export { parseRange } from "./model/range";
export type {
  DateRange,
  RangeKey,
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
  TAG_DASHBOARD,
} from "./api/queries";
```

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors in analytics 모듈).

- [ ] **Step 4: 런타임 증거 — seed 기준 집계 실행**

Run:
```bash
npx tsx -e "
import { db } from './src/shared/lib/db';
import { parseRange } from './src/entities/analytics/model/range';
import { getRevenueSummary, getSeatOccupancy } from './src/entities/analytics/api/queries';
(async () => {
  const r = parseRange('all');
  console.log('revenue(all):', await getRevenueSummary(r));
  console.log('occupancy:', await getSeatOccupancy());
  await db.\$disconnect();
})();
"
```
Expected: 객체 출력(`{ paid, refunded, net }`, `{ booked, capacity, rate }`) — 음수 net 없으면 정상. 에러 0.

- [ ] **Step 5: Commit**

```bash
git add src/entities/analytics
git commit -m "feat(analytics): dashboard aggregation read-model ($queryRaw + 60s cache)"
```

---

## Task 4: 포맷 헬퍼 `format.ts` (TDD)

원화/퍼센트 표시 순수 함수. 카드·차트 공유.

**Files:**
- Create: `src/widgets/admin-dashboard/ui/format.ts`
- Test: `src/widgets/admin-dashboard/ui/__tests__/format.test.ts`

- [ ] **Step 1: 실패하는 테스트**

`src/widgets/admin-dashboard/ui/__tests__/format.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { formatKRW, formatPercent } from "../format";

describe("formatKRW", () => {
  it("천단위 콤마 + 원 기호", () => {
    expect(formatKRW(48230000)).toBe("₩48,230,000");
  });
  it("0원", () => {
    expect(formatKRW(0)).toBe("₩0");
  });
  it("음수(순매출 적자)", () => {
    expect(formatKRW(-1500)).toBe("-₩1,500");
  });
});

describe("formatPercent", () => {
  it("비율(0~1) → 소수1자리 %", () => {
    expect(formatPercent(0.087)).toBe("8.7%");
  });
  it("0", () => {
    expect(formatPercent(0)).toBe("0.0%");
  });
  it("1(=100%)", () => {
    expect(formatPercent(1)).toBe("100.0%");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test -- src/widgets/admin-dashboard/ui/__tests__/format.test.ts`
Expected: FAIL — 모듈 미존재.

- [ ] **Step 3: 구현**

`src/widgets/admin-dashboard/ui/format.ts`:
```typescript
/** 정수(원) → "₩48,230,000" / 음수는 "-₩1,500". */
export function formatKRW(won: number): string {
  const sign = won < 0 ? "-" : "";
  return `${sign}₩${Math.abs(won).toLocaleString("ko-KR")}`;
}

/** 비율(0~1) → "8.7%" (소수 1자리). */
export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test -- src/widgets/admin-dashboard/ui/__tests__/format.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/widgets/admin-dashboard/ui/format.ts src/widgets/admin-dashboard/ui/__tests__/format.test.ts
git commit -m "feat(dashboard): KRW/percent format helpers"
```

---

## Task 5: Recharts 차트 리프 — `RevenueTrendChart` (`'use client'`)

매출 추이 BarChart. 서버가 만든 `RevenueTrendPoint[]`를 props로 받아 렌더만.

**Files:**
- Create: `src/widgets/admin-dashboard/ui/RevenueTrendChart.tsx`

- [ ] **Step 1: 구현**

`src/widgets/admin-dashboard/ui/RevenueTrendChart.tsx`:
```tsx
"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RevenueTrendPoint } from "@/entities/analytics";
import { formatKRW } from "./format";

// 차트는 window/ResizeObserver 의존 → 클라이언트 리프로 격리.
// 집계(서버)된 plain 배열만 props 로 받는다. DB·env import 없음.
export function RevenueTrendChart({ data }: { data: RevenueTrendPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-gray-400">
        기간 내 매출 데이터가 없습니다.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "#9ca3af" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(d: string) => d.slice(5)}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#9ca3af" }}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(v: number) => `${Math.round(v / 10000)}만`}
        />
        <Tooltip
          formatter={(value: number, name: string) => [
            formatKRW(value),
            name === "paid" ? "결제" : "환불",
          ]}
          labelStyle={{ fontSize: 12 }}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        <Bar dataKey="paid" fill="#b91c1c" radius={[4, 4, 0, 0]} />
        <Bar dataKey="refunded" fill="#fca5a5" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/widgets/admin-dashboard/ui/RevenueTrendChart.tsx
git commit -m "feat(dashboard): RevenueTrendChart client leaf (Recharts BarChart)"
```

---

## Task 6: Recharts 차트 리프 — `BookingStatusDonut` (`'use client'`)

예약 상태 분포 PieChart(도넛). `StatusSlice[]` props.

**Files:**
- Create: `src/widgets/admin-dashboard/ui/BookingStatusDonut.tsx`

- [ ] **Step 1: 구현**

`src/widgets/admin-dashboard/ui/BookingStatusDonut.tsx`:
```tsx
"use client";

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { StatusSlice } from "@/entities/analytics";

const COLORS: Record<string, string> = {
  "PAID/READY": "#b91c1c",
  결제대기: "#f59e0b",
  완료: "#2563eb",
  취소: "#9ca3af",
  기타: "#d1d5db",
};

export function BookingStatusDonut({ data }: { data: StatusSlice[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-gray-400">
        예약 데이터가 없습니다.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="status"
          innerRadius={55}
          outerRadius={85}
          paddingAngle={2}
        >
          {data.map((d) => (
            <Cell key={d.status} fill={COLORS[d.status] ?? "#d1d5db"} />
          ))}
        </Pie>
        <Tooltip formatter={(v: number, n: string) => [`${v}건`, n]} />
        <Legend
          verticalAlign="middle"
          align="right"
          layout="vertical"
          iconType="circle"
          wrapperStyle={{ fontSize: 12 }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/widgets/admin-dashboard/ui/BookingStatusDonut.tsx
git commit -m "feat(dashboard): BookingStatusDonut client leaf (Recharts PieChart)"
```

---

## Task 7: 서버 컴포넌트 — KPI 카드 & 기간 필터

순수 server 컴포넌트 2종. 차트 leaf와 달리 `'use client'` 없음.

**Files:**
- Create: `src/widgets/admin-dashboard/ui/DashboardKpiCards.tsx`
- Create: `src/widgets/admin-dashboard/ui/DashboardRangeFilter.tsx`

- [ ] **Step 1: KPI 카드 (server)**

`src/widgets/admin-dashboard/ui/DashboardKpiCards.tsx`:
```tsx
import type {
  RevenueSummary,
  CancellationStats,
  SeatOccupancy,
} from "@/entities/analytics";
import { formatKRW, formatPercent } from "./format";

interface Props {
  revenue: RevenueSummary;
  penaltyRevenue: number;
  cancellation: CancellationStats;
  occupancy: SeatOccupancy;
}

function Card({
  label,
  dot,
  value,
  caption,
}: {
  label: string;
  dot: string;
  value: string;
  caption: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-[12.5px] font-semibold text-gray-500">
        <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
        {label}
      </div>
      <div className="mt-2.5 text-[25px] font-extrabold tracking-tight text-gray-900">
        {value}
      </div>
      <div className="mt-1.5 text-xs text-gray-400">{caption}</div>
    </div>
  );
}

export function DashboardKpiCards({
  revenue,
  penaltyRevenue,
  cancellation,
  occupancy,
}: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card
        label="순매출 (결제−환불)"
        dot="#b91c1c"
        value={formatKRW(revenue.net)}
        caption={`결제 ${formatKRW(revenue.paid)} · 환불 ${formatKRW(revenue.refunded)}`}
      />
      <Card
        label="위약금 수익"
        dot="#f59e0b"
        value={formatKRW(penaltyRevenue)}
        caption="성공 환불의 동결 위약금 누적"
      />
      <Card
        label="취소율"
        dot="#dc2626"
        value={formatPercent(cancellation.rate)}
        caption={`취소 ${cancellation.canceled} / 예약 ${cancellation.total}`}
      />
      <Card
        label="좌석 점유율 (현재)"
        dot="#2563eb"
        value={formatPercent(occupancy.rate)}
        caption={`예약 ${occupancy.booked} / 정원 ${occupancy.capacity}`}
      />
    </div>
  );
}
```

- [ ] **Step 2: 기간 필터 (server, Link 기반)**

`src/widgets/admin-dashboard/ui/DashboardRangeFilter.tsx`:
```tsx
import Link from "next/link";
import type { RangeKey } from "@/entities/analytics";

const TABS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "오늘" },
  { key: "7d", label: "7일" },
  { key: "30d", label: "30일" },
  { key: "90d", label: "90일" },
  { key: "all", label: "전체" },
];

// useState 미사용 — 각 탭은 ?range= 링크. 활성 탭은 현재 key 비교.
export function DashboardRangeFilter({ active }: { active: RangeKey }) {
  return (
    <div className="inline-flex gap-0.5 rounded-lg border border-gray-200 bg-white p-1 text-[12.5px]">
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={`/admin/dashboard?range=${t.key}`}
            className={
              on
                ? "rounded-md bg-red-700 px-3 py-1.5 font-semibold text-white"
                : "rounded-md px-3 py-1.5 text-gray-500 hover:bg-gray-100"
            }
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/widgets/admin-dashboard/ui/DashboardKpiCards.tsx src/widgets/admin-dashboard/ui/DashboardRangeFilter.tsx
git commit -m "feat(dashboard): KPI cards + range filter server components"
```

---

## Task 8: 위젯 조립 `AdminDashboard` + barrel

KPI 카드 + 차트 2종을 그리드로 조립하는 server 컴포넌트.

**Files:**
- Create: `src/widgets/admin-dashboard/ui/AdminDashboard.tsx`
- Create: `src/widgets/admin-dashboard/index.ts`

- [ ] **Step 1: 조립 컴포넌트**

`src/widgets/admin-dashboard/ui/AdminDashboard.tsx`:
```tsx
import type { DashboardData, RangeKey } from "@/entities/analytics";
import { DashboardKpiCards } from "./DashboardKpiCards";
import { DashboardRangeFilter } from "./DashboardRangeFilter";
import { RevenueTrendChart } from "./RevenueTrendChart";
import { BookingStatusDonut } from "./BookingStatusDonut";

export function AdminDashboard({
  data,
  range,
}: {
  data: DashboardData;
  range: RangeKey;
}) {
  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">운영 대시보드</h1>
        <DashboardRangeFilter active={range} />
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
            일별 결제액 vs 환불액
          </p>
          <RevenueTrendChart data={data.trend} />
        </section>
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900">예약 상태 분포</h3>
          <p className="mb-3 text-[11.5px] text-gray-400">현재 전체 예약 기준</p>
          <BookingStatusDonut data={data.statusDistribution} />
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: barrel**

`src/widgets/admin-dashboard/index.ts`:
```typescript
export { AdminDashboard } from "./ui/AdminDashboard";
```

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/widgets/admin-dashboard/ui/AdminDashboard.tsx src/widgets/admin-dashboard/index.ts
git commit -m "feat(dashboard): AdminDashboard widget assembly + barrel"
```

---

## Task 9: 페이지 엔트리 `/admin/dashboard` (RSC)

`searchParams` → `parseRange` → `Promise.all` 병렬 집계 → 위젯.

**Files:**
- Create: `src/app/(admin)/admin/dashboard/page.tsx`

- [ ] **Step 1: 페이지 구현**

`src/app/(admin)/admin/dashboard/page.tsx`:
```tsx
import {
  parseRange,
  getRevenueSummary,
  getPenaltyRevenue,
  getCancellationStats,
  getSeatOccupancy,
  getRevenueTrend,
  getBookingStatusDistribution,
} from "@/entities/analytics";
import { AdminDashboard } from "@/widgets/admin-dashboard";

// admin route 는 항상 신선(권한 검증 + 운영 즉시성). 집계 SQL 은 내부 60s 캐시로 흡수.
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rangeParam } = await searchParams;
  const range = parseRange(rangeParam);

  // 독립 집계 6종 병렬 (N+1 0).
  const [
    revenue,
    penaltyRevenue,
    cancellation,
    occupancy,
    trend,
    statusDistribution,
  ] = await Promise.all([
    getRevenueSummary(range),
    getPenaltyRevenue(range),
    getCancellationStats(range),
    getSeatOccupancy(),
    getRevenueTrend(range),
    getBookingStatusDistribution(),
  ]);

  return (
    <AdminDashboard
      range={range.key}
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

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: 런타임 증거 — 페이지 렌더**

Run: `npm run dev` (별도 터미널) 후
```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/admin/dashboard?range=7d"
```
Expected: admin 미인증 시 리다이렉트(307/302) 또는 인증 세션이면 200. 500 아님.
(인증 필요 — admin 매직링크 콘솔 로그인 후 브라우저로 `?range=today/7d/30d/90d/all` 각각 확인.)

- [ ] **Step 4: Commit**

```bash
git add "src/app/(admin)/admin/dashboard/page.tsx"
git commit -m "feat(dashboard): /admin/dashboard RSC entry (parallel aggregation)"
```

---

## Task 10: admin 셸 진입점 연결

nav 링크 추가 + `/admin` 랜딩 전환 + UserNavIsland href 동기화.

**Files:**
- Modify: `src/app/(admin)/admin/layout.tsx`
- Modify: `src/app/(admin)/admin/page.tsx`
- Modify: `src/features/auth/ui/UserNavIsland.tsx` (경로/내용 먼저 확인)

- [ ] **Step 1: nav 최상단에 "대시보드" 링크 추가**

`src/app/(admin)/admin/layout.tsx` — "예약 관리" Link **앞에** 삽입:
```tsx
              <Link
                href="/admin/dashboard"
                className="rounded-md px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-100"
              >
                대시보드
              </Link>
```

- [ ] **Step 2: `/admin` redirect 대상 변경**

`src/app/(admin)/admin/page.tsx`:
```tsx
import { redirect } from "next/navigation";

// /admin 인덱스 → 운영 대시보드(admin 자연 홈). ADMIN 가드는 middleware+layout 이 이미 통과.
export default function AdminIndexPage() {
  redirect("/admin/dashboard");
}
```

- [ ] **Step 3: UserNavIsland 관리자 링크 href 확인·갱신**

Run: `grep -rn "/admin/products" src/features/auth/ui/UserNavIsland.tsx`
- 해당 href(`/admin/products`)가 있으면 `/admin/dashboard`로 변경.
- 파일·해당 라인이 없으면(다른 위치) `grep -rn "admin" src/features/auth/ui/` 로 실제 링크 위치를 찾아 동일 갱신. **이 Step 은 grep 결과에 따라 정확한 파일을 수정한다.**

- [ ] **Step 4: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: 런타임 증거 — 리다이렉트 체인**

Run:
```bash
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" "http://localhost:3000/admin"
```
Expected: 인증 세션이면 `/admin/dashboard`로, 미인증이면 `/login...`로 리다이렉트.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(admin)/admin/layout.tsx" "src/app/(admin)/admin/page.tsx" src/features/auth/ui/UserNavIsland.tsx
git commit -m "feat(dashboard): wire dashboard into admin nav + landing"
```

---

## Task 11: 종합 검증 (QA Engineer)

**Files:** 없음(검증 전용).

- [ ] **Step 1: 전체 게이트**

Run: `npm run typecheck && npm run test && npm run lint`
Expected: 3개 모두 PASS. 신규 테스트(parseRange 6 + format 6) 포함 그린.

- [ ] **Step 2: 미체크 박스 잔존 점검 (§4.1)**

Run: `grep -n "\- \[ \]" docs/superpowers/plans/2026-06-04-phase-6-admin-dashboard-plan.md`
Expected: 완료된 Task 범위에 미체크 항목 0 (전 Task 완료 시 출력 없음).

- [ ] **Step 3: 차트 leaf 서버 누출 점검**

Run: `grep -rn "use client" src/widgets/admin-dashboard/ui/`
Expected: `RevenueTrendChart.tsx`·`BookingStatusDonut.tsx` 2개만. KPI/필터/조립/format 은 server.

- [ ] **Step 4: 각 range 육안 확인 (자동화 불가 — 수동)**

절차: admin 매직링크(`npm run dev` 콘솔 `📧 [DEV] Magic link`)로 로그인 →
`/admin/dashboard?range=today|7d|30d|90d|all` 순회.
기대: KPI 4 카드 + 막대/도넛 차트 렌더, 활성 탭 강조 전환, 데이터 0 구간은 빈 상태 메시지.
실패 시: 콘솔 에러·스크린샷 첨부.

- [ ] **Step 5: 최종 커밋 확인**

Run: `git log --oneline -12 && git status`
Expected: Task 1~10 커밋 존재, working tree clean.

---

## Self-Review 메모 (작성자 점검 완료)

- **Spec 커버리지:** MVP 지표 4종(Task 3·7) / 차트 2종(Task 5·6) / searchParams 필터(Task 2·7·9) /
  Recharts 리프 격리(Task 5·6) / `entities/analytics` 신설(Task 2·3) / `widgets/admin-dashboard`(Task 4~8) /
  admin 진입점(Task 10) — 전 항목 매핑됨.
- **타입 일관성:** `DateRange`/`RangeKey`/`DashboardData` 등은 Task 2에서 단일 정의, Task 3·5~9가 동일 시그니처 참조.
- **분리:** (A)집계 read-model = Task 2·3 / (B)차트·카드 컴포넌트 = Task 4~7 / (C)조립·진입점 = Task 8~10.
- **ADR 후보:** `entities/analytics` 신설, Recharts 채택 (구현 후 발행 제안 — spec §7).
