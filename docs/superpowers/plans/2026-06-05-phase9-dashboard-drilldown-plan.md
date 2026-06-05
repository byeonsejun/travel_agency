# Phase 9 — Dashboard Drill-down & CSV Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영 대시보드 KPI 카드 4종을 클릭하면 페이지 이동 없이 Sheet 패널로 원천 로우를 보여주고, 패널에 내장된 버튼으로 그 로우를 client-side Blob CSV로 다운로드한다.

**Architecture:** 메트릭당 단일 read-model 쿼리(`entities/analytics`)가 미리보기 테이블과 CSV를 모두 먹인다. 패널이 받아온 in-memory 로우를 순수 함수(`shared/lib/csv/toCsv`)로 직렬화 → 서버 추가 부하 0. UI 인터랙션은 `features/admin-dashboard-drilldown` 의 `'use client'` 리프 2개에 격리(FSD widget→feature 정방향). 외부 CSV 라이브러리 금지, 브라우저 네이티브 API만.

**Tech Stack:** Next.js 15 App Router(RSC + Server Actions), Prisma `$queryRaw`, Zod, Vitest, Tailwind. 신규 의존성 0.

> 스펙: `docs/superpowers/specs/2026-06-05-phase9-dashboard-drilldown.md`

---

## File Structure (decomposition lock-in)

| 파일 | 책임 |
|---|---|
| `src/shared/lib/csv/toCsv.ts` | 순수 CSV 직렬화(RFC4180). 도메인 무지, client-safe(env import 0). |
| `src/shared/lib/csv/__tests__/toCsv.test.ts` | toCsv 엣지 테스트. |
| `src/entities/analytics/model/types.ts` | (수정) Drilldown 메트릭/Row DTO/결과 타입 추가. |
| `src/entities/analytics/model/columns.ts` | 메트릭별 컬럼 정의(header + value 접근자). 테이블·CSV 공유 SSOT. |
| `src/entities/analytics/model/__tests__/columns.test.ts` | 컬럼 헤더/접근자 테스트. |
| `src/entities/analytics/api/drilldown.ts` | 4개 raw-SQL 상세 쿼리 + 5000 cap + 60s cache. |
| `src/entities/analytics/index.ts` | (수정) barrel 공개. |
| `src/features/admin-dashboard-drilldown/server/actions.ts` | `loadDrilldownAction` — Zod + admin 가드. |
| `src/features/admin-dashboard-drilldown/server/__tests__/actions.test.ts` | 스키마/가드 테스트. |
| `src/features/admin-dashboard-drilldown/lib/downloadCsv.ts` | Blob+objectURL+revoke 다운로드 래퍼(client). |
| `src/features/admin-dashboard-drilldown/lib/__tests__/downloadCsv.test.ts` | revoke 호출(누수 차단) 테스트. |
| `src/features/admin-dashboard-drilldown/ui/DrilldownSheet.tsx` | `'use client'` 슬라이드 패널 + 테이블 + CSV 버튼. |
| `src/features/admin-dashboard-drilldown/ui/KpiDrilldownGrid.tsx` | `'use client'` 클릭 가능 KPI 카드 4종 + 상태 + Sheet. |
| `src/features/admin-dashboard-drilldown/index.ts` | barrel: `KpiDrilldownGrid` 공개. |
| `src/widgets/admin-dashboard/ui/AdminDashboard.tsx` | (수정) KPI 그리드를 feature 컴포넌트로 교체 + range 전달. |

---

## Task 1: CSV 순수 직렬화 함수 (`shared/lib/csv/toCsv`)

**Files:**
- Create: `src/shared/lib/csv/toCsv.ts`
- Test: `src/shared/lib/csv/__tests__/toCsv.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// src/shared/lib/csv/__tests__/toCsv.test.ts
import { describe, it, expect } from "vitest";
import { toCsv, type CsvColumn } from "../toCsv";

interface Row { name: string; price: number; note: string | null }
const cols: CsvColumn<Row>[] = [
  { header: "이름", value: (r) => r.name },
  { header: "가격", value: (r) => r.price },
  { header: "비고", value: (r) => r.note },
];

describe("toCsv", () => {
  it("헤더 + 데이터 행을 CRLF 로 직렬화", () => {
    const csv = toCsv([{ name: "A", price: 100, note: "x" }], cols);
    expect(csv).toBe("이름,가격,비고\r\nA,100,x");
  });
  it("쉼표/따옴표/개행 포함 셀을 RFC4180 으로 인용", () => {
    const csv = toCsv([{ name: 'a,b', price: 1, note: 'he said "hi"\nbye' }], cols);
    expect(csv).toBe('이름,가격,비고\r\n"a,b",1,"he said ""hi""\nbye"');
  });
  it("null/undefined 는 빈 문자열", () => {
    const csv = toCsv([{ name: "A", price: 0, note: null }], cols);
    expect(csv).toBe("이름,가격,비고\r\nA,0,");
  });
  it("빈 배열이면 헤더만 반환", () => {
    expect(toCsv([], cols)).toBe("이름,가격,비고");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/lib/csv/__tests__/toCsv.test.ts`
Expected: FAIL — `Cannot find module '../toCsv'`.

- [x] **Step 3: Write minimal implementation**

```ts
// src/shared/lib/csv/toCsv.ts
// 외부 라이브러리 금지(papaparse 등). 의존성 0 순수 함수. client-safe(env import 금지).
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

/** 단일 셀을 RFC 4180 규칙으로 이스케이프. */
function escapeCell(raw: string | number | null | undefined): string {
  if (raw == null) return "";
  const s = String(raw);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** rows + columns → CSV 문자열(BOM 미포함). 행 구분 CRLF, 헤더 1행 선행. */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCell(c.header)).join(",");
  const body = rows.map((row) => columns.map((c) => escapeCell(c.value(row))).join(","));
  return [header, ...body].join("\r\n");
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/lib/csv/__tests__/toCsv.test.ts`
Expected: PASS (4 tests).

- [x] **Step 5: Commit**

```bash
git add src/shared/lib/csv/
git commit -m "feat(csv): RFC4180 pure toCsv serializer (no external deps)"
```

---

## Task 2: Drill-down 타입 정의 (`entities/analytics/model/types.ts`)

**Files:**
- Modify: `src/entities/analytics/model/types.ts` (파일 끝에 추가)

- [x] **Step 1: Append drill-down types**

기존 `types.ts` 끝에 아래를 추가한다(기존 export 는 유지).

```ts
// ─── Phase 9: 드릴다운 ───────────────────────────────────────────
export type DrilldownMetric = "revenue" | "penalty" | "cancellation" | "occupancy";

export interface RevenueRow {
  paidAt: string;        // YYYY-MM-DD
  orderId: string;
  productTitle: string;
  customer: string;
  amount: number;        // 결제액(원)
  refundedAmount: number;
  status: string;
}
export interface PenaltyRow {
  processedAt: string;   // RefundJob.updatedAt
  productTitle: string;
  customer: string;
  kind: string;          // FULL_CANCEL | TRAVELER_CANCEL | DISCRETIONARY
  baseAmount: number;
  penaltyAmount: number;
  refundedAmount: number; // RefundJob.amount(실환불액)
}
export interface CancellationRow {
  createdAt: string;
  canceledAt: string;    // 없으면 ""
  productTitle: string;
  customer: string;
  status: string;        // CANCELED_BY_USER | CANCELED_BY_AGENCY
  cancelReason: string;  // 없으면 ""
  totalPrice: number;
}
export interface OccupancyRow {
  departureDate: string;
  productTitle: string;
  capacity: number;
  bookedSeats: number;
  occupancyPct: number;  // 0~100 정수
  status: string;        // DepartureStatus
}

/** 메트릭별 row 타입 매핑. */
export interface DrilldownRowMap {
  revenue: RevenueRow;
  penalty: PenaltyRow;
  cancellation: CancellationRow;
  occupancy: OccupancyRow;
}

export interface DrilldownResult<T> {
  rows: T[];
  total: number;     // WHERE 매칭 전체 건수(cap 무시)
  capped: boolean;   // total > 5000
}

/** Server Action 반환 — metric 으로 태깅된 판별 유니온(any 회피). */
export type DrilldownData = {
  [M in DrilldownMetric]: { metric: M; result: DrilldownResult<DrilldownRowMap[M]> };
}[DrilldownMetric];
```

- [x] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS (타입만 추가, 미사용이라 에러 없음).

- [x] **Step 3: Commit**

```bash
git add src/entities/analytics/model/types.ts
git commit -m "feat(analytics): drill-down row DTOs + DrilldownData union"
```

---

## Task 3: 메트릭별 컬럼 정의 (`entities/analytics/model/columns.ts`)

**Files:**
- Create: `src/entities/analytics/model/columns.ts`
- Test: `src/entities/analytics/model/__tests__/columns.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// src/entities/analytics/model/__tests__/columns.test.ts
import { describe, it, expect } from "vitest";
import { DRILLDOWN_COLUMNS, DRILLDOWN_LABEL } from "../columns";

describe("DRILLDOWN_COLUMNS", () => {
  it("메트릭 4종 모두 컬럼을 가진다", () => {
    expect(DRILLDOWN_COLUMNS.revenue.length).toBeGreaterThan(0);
    expect(DRILLDOWN_COLUMNS.penalty.length).toBeGreaterThan(0);
    expect(DRILLDOWN_COLUMNS.cancellation.length).toBeGreaterThan(0);
    expect(DRILLDOWN_COLUMNS.occupancy.length).toBeGreaterThan(0);
  });
  it("revenue 컬럼 value 접근자가 row 값을 추출", () => {
    const col = DRILLDOWN_COLUMNS.revenue.find((c) => c.header === "결제액")!;
    expect(col.value({ paidAt: "2026-06-01", orderId: "o1", productTitle: "t", customer: "c", amount: 1000, refundedAmount: 0, status: "PAID" })).toBe(1000);
  });
  it("각 메트릭에 한글 라벨이 있다", () => {
    expect(DRILLDOWN_LABEL.revenue).toBeTruthy();
    expect(DRILLDOWN_LABEL.occupancy).toBeTruthy();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/entities/analytics/model/__tests__/columns.test.ts`
Expected: FAIL — `Cannot find module '../columns'`.

- [x] **Step 3: Write implementation**

```ts
// src/entities/analytics/model/columns.ts
import type { CsvColumn } from "@/shared/lib/csv/toCsv";
import type {
  DrilldownMetric,
  DrilldownRowMap,
  RevenueRow,
  PenaltyRow,
  CancellationRow,
  OccupancyRow,
} from "./types";

const revenue: CsvColumn<RevenueRow>[] = [
  { header: "결제일", value: (r) => r.paidAt },
  { header: "주문ID", value: (r) => r.orderId },
  { header: "상품", value: (r) => r.productTitle },
  { header: "고객", value: (r) => r.customer },
  { header: "결제액", value: (r) => r.amount },
  { header: "환불액", value: (r) => r.refundedAmount },
  { header: "상태", value: (r) => r.status },
];
const penalty: CsvColumn<PenaltyRow>[] = [
  { header: "처리일", value: (r) => r.processedAt },
  { header: "상품", value: (r) => r.productTitle },
  { header: "고객", value: (r) => r.customer },
  { header: "유형", value: (r) => r.kind },
  { header: "기준액", value: (r) => r.baseAmount },
  { header: "위약금", value: (r) => r.penaltyAmount },
  { header: "실환불액", value: (r) => r.refundedAmount },
];
const cancellation: CsvColumn<CancellationRow>[] = [
  { header: "예약일", value: (r) => r.createdAt },
  { header: "취소일", value: (r) => r.canceledAt },
  { header: "상품", value: (r) => r.productTitle },
  { header: "고객", value: (r) => r.customer },
  { header: "상태", value: (r) => r.status },
  { header: "사유", value: (r) => r.cancelReason },
  { header: "예약금액", value: (r) => r.totalPrice },
];
const occupancy: CsvColumn<OccupancyRow>[] = [
  { header: "출발일", value: (r) => r.departureDate },
  { header: "상품", value: (r) => r.productTitle },
  { header: "정원", value: (r) => r.capacity },
  { header: "예약좌석", value: (r) => r.bookedSeats },
  { header: "점유율(%)", value: (r) => r.occupancyPct },
  { header: "상태", value: (r) => r.status },
];

/** 메트릭 → 컬럼 정의(테이블/CSV 공유 SSOT). */
export const DRILLDOWN_COLUMNS: {
  [M in DrilldownMetric]: CsvColumn<DrilldownRowMap[M]>[];
} = { revenue, penalty, cancellation, occupancy };

/** 메트릭 → 패널 제목 라벨. */
export const DRILLDOWN_LABEL: Record<DrilldownMetric, string> = {
  revenue: "결제 내역",
  penalty: "위약금/환불 내역",
  cancellation: "취소 예약",
  occupancy: "출발 좌석 현황",
};
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/entities/analytics/model/__tests__/columns.test.ts`
Expected: PASS (3 tests).

- [x] **Step 5: Commit**

```bash
git add src/entities/analytics/model/columns.ts src/entities/analytics/model/__tests__/columns.test.ts
git commit -m "feat(analytics): per-metric drill-down column defs (table/CSV SSOT)"
```

---

## Task 4: 드릴다운 상세 쿼리 (`entities/analytics/api/drilldown.ts`)

**Files:**
- Create: `src/entities/analytics/api/drilldown.ts`
- Modify: `src/entities/analytics/index.ts`

> 테스트: raw-SQL 은 DB 의존이라 단위 테스트 대신 Task 10 런타임 QA(프리즈마/curl) 로 검증. cap/매핑 순수 로직은 자명.

- [ ] **Step 1: Implement queries**

```ts
// src/entities/analytics/api/drilldown.ts
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
const iso = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : "");

// COUNT(*) OVER() 는 LIMIT 이전(전체 매칭)에 계산됨 → cap 무시 total 확보.
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

// range 무관 현재 스냅샷(카드와 동일 기준).
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
```

- [ ] **Step 2: Update analytics barrel**

`src/entities/analytics/index.ts` 의 타입 export 블록에 추가:

```ts
export type {
  DrilldownMetric,
  DrilldownData,
  DrilldownResult,
  RevenueRow,
  PenaltyRow,
  CancellationRow,
  OccupancyRow,
  DrilldownRowMap,
} from "./model/types";
export { DRILLDOWN_COLUMNS, DRILLDOWN_LABEL } from "./model/columns";
export {
  getRevenueRows,
  getPenaltyRows,
  getCancellationRows,
  getOccupancyRows,
} from "./api/drilldown";
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/entities/analytics/api/drilldown.ts src/entities/analytics/index.ts
git commit -m "feat(analytics): drill-down raw-SQL queries (5000 cap, window total)"
```

---

## Task 5: Server Action (`features/admin-dashboard-drilldown/server/actions.ts`)

**Files:**
- Create: `src/features/admin-dashboard-drilldown/server/actions.ts`
- Test: `src/features/admin-dashboard-drilldown/server/__tests__/actions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/admin-dashboard-drilldown/server/__tests__/actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/features/auth/server/auth", () => ({ auth: vi.fn() }));
vi.mock("@/entities/analytics", () => ({
  parseRange: (k: string) => ({ from: new Date(0), to: new Date(), key: k, bucket: "day" }),
  getRevenueRows: vi.fn(async () => ({ rows: [], total: 0, capped: false })),
  getPenaltyRows: vi.fn(async () => ({ rows: [], total: 0, capped: false })),
  getCancellationRows: vi.fn(async () => ({ rows: [], total: 0, capped: false })),
  getOccupancyRows: vi.fn(async () => ({ rows: [], total: 0, capped: false })),
}));

import { auth } from "@/features/auth/server/auth";
import { DrilldownInputSchema, loadDrilldownAction } from "../actions";

const asAdmin = () => (auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });

beforeEach(() => vi.clearAllMocks());

describe("DrilldownInputSchema", () => {
  it("알 수 없는 metric 거부", () => {
    expect(DrilldownInputSchema.safeParse({ metric: "xxx", range: "30d" }).success).toBe(false);
  });
  it("알 수 없는 range 거부", () => {
    expect(DrilldownInputSchema.safeParse({ metric: "revenue", range: "1y" }).success).toBe(false);
  });
  it("정상 입력 허용", () => {
    expect(DrilldownInputSchema.safeParse({ metric: "revenue", range: "30d" }).success).toBe(true);
  });
});

describe("loadDrilldownAction", () => {
  it("비-admin 은 거부", async () => {
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "USER" } });
    const res = await loadDrilldownAction({ metric: "revenue", range: "30d" });
    expect(res.type).toBe("error");
  });
  it("admin 정상 호출 시 metric 태깅 결과 반환", async () => {
    asAdmin();
    const res = await loadDrilldownAction({ metric: "revenue", range: "30d" });
    expect(res.type).toBe("success");
    if (res.type === "success") expect(res.data.metric).toBe("revenue");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/admin-dashboard-drilldown/server/__tests__/actions.test.ts`
Expected: FAIL — `Cannot find module '../actions'`.

- [ ] **Step 3: Write implementation**

```ts
// src/features/admin-dashboard-drilldown/server/actions.ts
"use server";
import { z } from "zod";
import { auth } from "@/features/auth/server/auth";
import {
  parseRange,
  getRevenueRows,
  getPenaltyRows,
  getCancellationRows,
  getOccupancyRows,
  type DrilldownData,
} from "@/entities/analytics";

export const DrilldownInputSchema = z.object({
  metric: z.enum(["revenue", "penalty", "cancellation", "occupancy"]),
  range: z.enum(["today", "7d", "30d", "90d", "all"]),
});
export type DrilldownInput = z.infer<typeof DrilldownInputSchema>;

export type DrilldownState =
  | { type: "success"; data: DrilldownData }
  | { type: "error"; message: string };

export async function loadDrilldownAction(input: DrilldownInput): Promise<DrilldownState> {
  const session = await auth();
  if (!session?.user?.id) return { type: "error", message: "관리자 로그인이 필요합니다" };
  if (session.user.role !== "ADMIN") return { type: "error", message: "권한 없음" };

  const parsed = DrilldownInputSchema.safeParse(input);
  if (!parsed.success) return { type: "error", message: "입력값 오류" };

  // 클라이언트가 보낸 날짜 불신 — range 키로 서버가 window 재도출.
  const range = parseRange(parsed.data.range);

  try {
    switch (parsed.data.metric) {
      case "revenue":
        return { type: "success", data: { metric: "revenue", result: await getRevenueRows(range) } };
      case "penalty":
        return { type: "success", data: { metric: "penalty", result: await getPenaltyRows(range) } };
      case "cancellation":
        return { type: "success", data: { metric: "cancellation", result: await getCancellationRows(range) } };
      case "occupancy":
        return { type: "success", data: { metric: "occupancy", result: await getOccupancyRows() } };
    }
  } catch {
    return { type: "error", message: "데이터 조회 실패" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/admin-dashboard-drilldown/server/__tests__/actions.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/admin-dashboard-drilldown/server/
git commit -m "feat(drilldown): loadDrilldownAction with Zod + admin guard"
```

---

## Task 6: CSV 다운로드 래퍼 (`features/.../lib/downloadCsv.ts`)

**Files:**
- Create: `src/features/admin-dashboard-drilldown/lib/downloadCsv.ts`
- Test: `src/features/admin-dashboard-drilldown/lib/__tests__/downloadCsv.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/admin-dashboard-drilldown/lib/__tests__/downloadCsv.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { downloadCsv } from "../downloadCsv";
import type { CsvColumn } from "@/shared/lib/csv/toCsv";

interface Row { a: string }
const cols: CsvColumn<Row>[] = [{ header: "A", value: (r) => r.a }];

beforeEach(() => {
  vi.restoreAllMocks();
  // jsdom 은 objectURL 미구현 → 스텁.
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe("downloadCsv", () => {
  it("objectURL 을 생성하고 누수 방지를 위해 revoke 한다", () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadCsv([{ a: "x" }], cols, "test.csv");
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/admin-dashboard-drilldown/lib/__tests__/downloadCsv.test.ts`
Expected: FAIL — `Cannot find module '../downloadCsv'`.

- [ ] **Step 3: Write implementation**

```ts
// src/features/admin-dashboard-drilldown/lib/downloadCsv.ts
import { toCsv, type CsvColumn } from "@/shared/lib/csv/toCsv";

/**
 * rows → CSV Blob 다운로드(브라우저 네이티브 API만).
 * UTF-8 BOM prepend(엑셀 한글 깨짐 방지) + objectURL revoke(메모리 누수 차단).
 */
export function downloadCsv<T>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
  filename: string
): void {
  const csv = toCsv(rows, columns);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/admin-dashboard-drilldown/lib/__tests__/downloadCsv.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/features/admin-dashboard-drilldown/lib/
git commit -m "feat(drilldown): client Blob CSV download (BOM + revokeObjectURL)"
```

---

## Task 7: 드릴다운 Sheet 패널 (`features/.../ui/DrilldownSheet.tsx`)

**Files:**
- Create: `src/features/admin-dashboard-drilldown/ui/DrilldownSheet.tsx`

> client island. db/env import 0. 메모리 누수 방어: stale 토큰 가드 + ESC 리스너 cleanup + revoke(Task6).

- [ ] **Step 1: Implement the Sheet**

```tsx
// src/features/admin-dashboard-drilldown/ui/DrilldownSheet.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import type { CsvColumn } from "@/shared/lib/csv/toCsv";
import {
  DRILLDOWN_COLUMNS,
  DRILLDOWN_LABEL,
  type DrilldownData,
  type DrilldownMetric,
  type RangeKey,
} from "@/entities/analytics";
import { loadDrilldownAction } from "../server/actions";
import { downloadCsv } from "../lib/downloadCsv";

function fmtCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  return typeof v === "number" ? v.toLocaleString("ko-KR") : v;
}

export function DrilldownSheet({
  metric,
  range,
  onClose,
}: {
  metric: DrilldownMetric;
  range: RangeKey;
  onClose: () => void;
}) {
  const [data, setData] = useState<DrilldownData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const tokenRef = useRef(0);

  // 데이터 로드 (메트릭 전환 시 stale 응답 무시).
  useEffect(() => {
    const token = ++tokenRef.current;
    setLoading(true);
    setError(null);
    setData(null);
    loadDrilldownAction({ metric, range })
      .then((res) => {
        if (token !== tokenRef.current) return; // stale
        if (res.type === "error") setError(res.message);
        else setData(res.data);
      })
      .catch(() => {
        if (token === tokenRef.current) setError("데이터 조회 실패");
      })
      .finally(() => {
        if (token === tokenRef.current) setLoading(false);
      });
  }, [metric, range]);

  // ESC 닫기 (리스너 cleanup 필수).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleCsv = () => {
    if (!data) return;
    const cols = DRILLDOWN_COLUMNS[data.metric] as CsvColumn<unknown>[];
    const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    downloadCsv(data.result.rows as unknown[], cols, `nextour_${data.metric}_${range}_${yyyymmdd}.csv`);
  };

  const columns = (DRILLDOWN_COLUMNS[metric] as CsvColumn<unknown>[]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-3xl flex-col bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-bold text-gray-900">{DRILLDOWN_LABEL[metric]}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCsv}
              disabled={!data || data.result.rows.length === 0}
              className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              CSV 다운로드{data ? ` (${data.result.rows.length}건)` : ""}
            </button>
            <button onClick={onClose} aria-label="닫기" className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
              닫기
            </button>
          </div>
        </header>

        {data?.result.capped && (
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-800">
            전체 {data.result.total.toLocaleString("ko-KR")}건 중 상위 5,000건만 표시·추출됩니다.
          </div>
        )}

        <div className="flex-1 overflow-auto px-5 py-3">
          {loading && <p className="py-10 text-center text-sm text-gray-400">불러오는 중…</p>}
          {error && <p className="py-10 text-center text-sm text-red-600">{error}</p>}
          {data && data.result.rows.length === 0 && !loading && (
            <p className="py-10 text-center text-sm text-gray-400">해당 기간 데이터가 없습니다.</p>
          )}
          {data && data.result.rows.length > 0 && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 border-b border-gray-200 bg-gray-50 text-left">
                <tr>
                  {columns.map((c) => (
                    <th key={c.header} className="whitespace-nowrap px-2 py-2 font-medium text-gray-700">{c.header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.result.rows.map((row, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    {columns.map((c) => (
                      <td key={c.header} className="whitespace-nowrap px-2 py-1.5 text-gray-800">{fmtCell(c.value(row))}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

> 참고: `RangeKey` 가 barrel 에 type export 되어 있는지 확인(Task 4 에서 포함). 누락 시 `@/entities/analytics` 에 추가.

- [ ] **Step 3: Commit**

```bash
git add src/features/admin-dashboard-drilldown/ui/DrilldownSheet.tsx
git commit -m "feat(drilldown): Sheet panel with preview table + CSV (stale-token guard, ESC cleanup)"
```

---

## Task 8: 클릭 가능 KPI 그리드 (`features/.../ui/KpiDrilldownGrid.tsx` + barrel)

**Files:**
- Create: `src/features/admin-dashboard-drilldown/ui/KpiDrilldownGrid.tsx`
- Create: `src/features/admin-dashboard-drilldown/index.ts`

- [ ] **Step 1: Implement the grid**

```tsx
// src/features/admin-dashboard-drilldown/ui/KpiDrilldownGrid.tsx
"use client";
import { useState } from "react";
import type {
  RevenueSummary,
  CancellationStats,
  SeatOccupancy,
  DrilldownMetric,
  RangeKey,
} from "@/entities/analytics";
import { formatKRW, formatPercent } from "@/widgets/admin-dashboard/ui/format";
import { DrilldownSheet } from "./DrilldownSheet";

interface Props {
  revenue: RevenueSummary;
  penaltyRevenue: number;
  cancellation: CancellationStats;
  occupancy: SeatOccupancy;
  range: RangeKey;
}

function Card({ label, dot, value, caption, onClick }: {
  label: string; dot: string; value: string; caption: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-colors hover:border-red-300 hover:bg-red-50/30"
    >
      <div className="flex items-center gap-2 text-[12.5px] font-semibold text-gray-500">
        <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
        {label}
        <span className="ml-auto text-[11px] font-normal text-gray-300">클릭 →</span>
      </div>
      <div className="mt-2.5 text-[25px] font-extrabold tracking-tight text-gray-900">{value}</div>
      <div className="mt-1.5 text-xs text-gray-400">{caption}</div>
    </button>
  );
}

export function KpiDrilldownGrid({ revenue, penaltyRevenue, cancellation, occupancy, range }: Props) {
  const [open, setOpen] = useState<DrilldownMetric | null>(null);
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="순매출 (결제−환불)" dot="#b91c1c" value={formatKRW(revenue.net)}
          caption={`결제 ${formatKRW(revenue.paid)} · 환불 ${formatKRW(revenue.refunded)}`}
          onClick={() => setOpen("revenue")} />
        <Card label="위약금 수익" dot="#f59e0b" value={formatKRW(penaltyRevenue)}
          caption="성공 환불의 동결 위약금 누적" onClick={() => setOpen("penalty")} />
        <Card label="취소율" dot="#dc2626" value={formatPercent(cancellation.rate)}
          caption={`취소 ${cancellation.canceled} / 예약 ${cancellation.total}`}
          onClick={() => setOpen("cancellation")} />
        <Card label="좌석 점유율 (현재)" dot="#2563eb" value={formatPercent(occupancy.rate)}
          caption={`예약 ${occupancy.booked} / 정원 ${occupancy.capacity}`}
          onClick={() => setOpen("occupancy")} />
      </div>
      {open && <DrilldownSheet metric={open} range={range} onClose={() => setOpen(null)} />}
    </>
  );
}
```

- [ ] **Step 2: Create barrel**

```ts
// src/features/admin-dashboard-drilldown/index.ts
export { KpiDrilldownGrid } from "./ui/KpiDrilldownGrid";
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

> 참고: `formatKRW`/`formatPercent` 가 `widgets/admin-dashboard/ui/format` 에서 export 되는지 확인(현재 둘 다 export 됨). client island 이 widget util 을 import 하는 것은 순수 포맷 함수라 무방(db/env 0).

- [ ] **Step 4: Commit**

```bash
git add src/features/admin-dashboard-drilldown/ui/KpiDrilldownGrid.tsx src/features/admin-dashboard-drilldown/index.ts
git commit -m "feat(drilldown): clickable KPI grid island + barrel"
```

---

## Task 9: 위젯 연결 (`widgets/admin-dashboard/ui/AdminDashboard.tsx`)

**Files:**
- Modify: `src/widgets/admin-dashboard/ui/AdminDashboard.tsx`

- [ ] **Step 1: Swap KPI cards for drill-down grid**

`AdminDashboard.tsx` 를 아래로 교체(`DashboardKpiCards` import 제거, `KpiDrilldownGrid` 사용, range 전달):

```tsx
import type { DashboardData, RangeKey } from "@/entities/analytics";
import { KpiDrilldownGrid } from "@/features/admin-dashboard-drilldown";
import { DashboardRangeFilter } from "./DashboardRangeFilter";
import { RevenueTrendChart } from "./RevenueTrendChart";
import { BookingStatusDonut } from "./BookingStatusDonut";

export function AdminDashboard({ data, range }: { data: DashboardData; range: RangeKey }) {
  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">운영 대시보드</h1>
        <DashboardRangeFilter active={range} />
      </div>

      <KpiDrilldownGrid
        revenue={data.revenue}
        penaltyRevenue={data.penaltyRevenue}
        cancellation={data.cancellation}
        occupancy={data.occupancy}
        range={range}
      />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.7fr_1fr]">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900">매출 추이</h3>
          <p className="mb-3 text-[11.5px] text-gray-400">일별 결제액 vs 환불액</p>
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

- [ ] **Step 2: Remove the now-unused DashboardKpiCards**

`DashboardKpiCards.tsx` 는 더 이상 참조되지 않으므로 삭제(presentational 로직은 `KpiDrilldownGrid` 의 `Card` 로 흡수됨).

Run: `git rm src/widgets/admin-dashboard/ui/DashboardKpiCards.tsx`

- [ ] **Step 3: Verify typecheck + tests + lint**

Run: `npm run typecheck && npm run test && npm run lint`
Expected: 전부 PASS, 901+신규 테스트 GREEN.

- [ ] **Step 4: Verify client-leaf isolation (Architect 회귀 가드)**

Run: `grep -rl "use client" src/widgets/admin-dashboard/ui/ src/features/admin-dashboard-drilldown/ui/`
Expected: 정확히 4개 — `RevenueTrendChart.tsx`, `BookingStatusDonut.tsx`, `DrilldownSheet.tsx`, `KpiDrilldownGrid.tsx`.

- [ ] **Step 5: Commit**

```bash
git add -A src/widgets/admin-dashboard/
git commit -m "feat(admin-dashboard): wire KPI drill-down grid into dashboard"
```

---

## Task 10: 런타임 검증 + ADR + 종합 마감

**Files:**
- Create: `docs/superpowers/adr/0037-csv-export-client-blob.md`
- Modify: `docs/superpowers/adr/README.md`

- [ ] **Step 1: Runtime evidence (QA — 자가 증거 수집)**

dev 서버 기동 후 admin 로그인하여 `/admin/dashboard`:
- KPI 카드 4종 각각 클릭 → Sheet 오픈 + 로우 렌더 확인(Playwright/수동).
- CSV 버튼 → 파일 다운로드 + 한글 깨짐 없음(BOM) 확인.
- 빠른 카드 전환 시 stale 렌더 없음, ESC 닫힘 동작.

직접 쿼리 증거(예시):
```bash
# 취소 예약 건수 ↔ 카드 취소건수 일치 확인
psql "$DATABASE_URL" -c "SELECT count(*) FROM \"Booking\" WHERE status IN ('CANCELED_BY_USER','CANCELED_BY_AGENCY') AND \"createdAt\" >= now() - interval '30 days';"
```

- [ ] **Step 2: Write ADR-0037**

`docs/superpowers/adr/template.md` 복사 → `0037-csv-export-client-blob.md`. 4섹션:
- **Context**: 대시보드 CSV 추출 필요, 소규모 데이터.
- **Decision**: client-side Blob(`toCsv` 순수함수 + objectURL + revoke), 5000 cap.
- **Consequences**: 서버 부하 0, 번들 증가 0(외부 라이브러리 없음); 대용량 미지원(cap).
- **Alternatives Considered**: (a) server streaming Route Handler — 인프라 과설계, 현 규모 불필요 / (b) papaparse 등 외부 라이브러리 — 번들·의존성 비용, 네이티브로 충분. *승격 조건*: 상시 수만 행 초과 시 streaming.

`README.md` 인덱스에 한 줄 추가.

- [ ] **Step 3: Plan 체크박스 동기화 확인**

Run: `grep -n "\- \[ \]" docs/superpowers/plans/2026-06-05-phase9-dashboard-drilldown-plan.md`
Expected: 모든 Task 완료 시 출력 없음(전부 `[x]`).

- [ ] **Step 4: Final commit**

```bash
git add docs/superpowers/
git commit -m "docs(adr): 0037 client-blob CSV export + phase9 plan close-out"
```

---

## Self-Review 결과 (작성자 점검)

- **Spec coverage**: 메트릭 매핑(§2)→Task4, FSD 배치(§3)→Task1~9, client CSV 라이브러리 금지(§4)→Task1·6, 보안/Zod/가드(§5)→Task5, 누수 방어(§6)→Task6·7, 테스트(§7)→Task1·3·5·6+Task10, ADR(§8)→Task10. 누락 없음.
- **Placeholder scan**: TBD/TODO 없음. 모든 코드 스텝에 완전한 코드 포함.
- **Type consistency**: `DrilldownMetric`/`DrilldownData`/`DrilldownResult<T>`/`CsvColumn<T>`/`DRILLDOWN_COLUMNS`/`DRILLDOWN_LABEL`/`loadDrilldownAction`/`downloadCsv`/`toCsv` 명칭이 Task 간 일치. `RangeKey` barrel type export 의존성을 Task4·7 에 명시.
