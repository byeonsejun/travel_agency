# Phase 5-A: RUM Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실사용자 Web Vitals(LCP/INP/CLS/TTFB/FCP)를 자체 Postgres 파이프라인으로 수집·집계해 어드민 대시보드 "성능" 패널에 p75로 시각화하고, Phase 5-C(Cache Components 이전)의 before/after baseline을 박제한다.

**Architecture:** 클라이언트 `useReportWebVitals` island가 메트릭을 정규화(`normalizeRoute`)해 `navigator.sendBeacon`으로 `POST /api/rum` 전송 → Zod + rate-limit(fail-open) 게이트 → `WebVitalEvent`(raw, 30일) 적재. 어드민은 `entities/analytics`의 `$queryRaw percentile_cont(0.75)` read-model로 p75를 집계해 패널 렌더. cron 디스패처가 30일 초과 이벤트를 멱등 정리. 모든 패턴은 기존 자산(analytics `$queryRaw` [ADR-0032], Recharts client-leaf 격리 [ADR-0033], cron 디스패처 [ADR-0005], rate-limit hybrid [ADR-0022]/[ADR-0023]) 재사용.

**Tech Stack:** Next 15 App Router, `next/web-vitals`(신규 런타임 의존 0 — Next 내장), Prisma 5 + PostgreSQL(`percentile_cont`), Zod 3, Vitest 2, Recharts(기존), shadcn `Badge`/`Table` 프리미티브.

**Spec:** `docs/superpowers/specs/2026-06-11-rum-and-cache-modernization.md`

---

## File Structure (생성/수정 매핑)

**features/rum (수집 + 순수 모델 SSOT)**
- Create: `src/features/rum/model/normalizeRoute.ts` — pathname→route 템플릿 접기 + `ROUTE_TEMPLATES` + `coerceRouteTemplate` (순수)
- Create: `src/features/rum/model/rating.ts` — `ratingFor(metric, value)` web-vitals 임계 판정 (순수)
- Create: `src/features/rum/model/schema.ts` — `webVitalSchema` Zod + `METRICS` + `WebVitalInput` 타입
- Create: `src/features/rum/ui/WebVitalsReporter.tsx` — `'use client'` island (`useReportWebVitals` + `usePathname` + sendBeacon)
- Create: `src/features/rum/index.ts` — barrel (`WebVitalsReporter`만 공개)
- Test: `src/features/rum/model/__tests__/normalizeRoute.test.ts`, `rating.test.ts`, `schema.test.ts`

**route handler (수신)**
- Create: `src/app/api/rum/route.ts` — `POST = withRateLimit({tier:"rum"}, …)`
- Test: `src/app/api/rum/__tests__/route.test.ts`

**rate-limit (신규 tier)**
- Modify: `src/shared/lib/rate-limit/tiers.ts` — `RateLimitTier` 유니온 + `RATE_LIMIT_TIERS`에 `rum` 추가

**entities/analytics (read-model)**
- Create: `src/entities/analytics/api/rum.ts` — `getWebVitalSummary`/`getWebVitalByRoute`/`getWebVitalTrend` + `TAG_RUM`
- Modify: `src/entities/analytics/model/types.ts` — RUM 결과 타입 3종
- Modify: `src/entities/analytics/index.ts` — RUM read-model + 타입 re-export
- Test: `src/entities/analytics/api/__tests__/rum.test.ts`

**widgets/admin-dashboard (시각화)**
- Create: `src/widgets/admin-dashboard/ui/PerformancePanel.tsx` — server 조립(p75 카드 + 테이블)
- Create: `src/widgets/admin-dashboard/ui/WebVitalTrendChart.tsx` — `'use client'` Recharts 리프
- Modify: `src/widgets/admin-dashboard/ui/AdminDashboard.tsx` — 패널 props 수용 + 렌더
- Modify: `src/widgets/admin-dashboard/index.ts` — (필요 시) export 확인
- Modify: `src/app/(admin)/admin/dashboard/page.tsx` — RUM 집계 fetch + props 주입

**site layout (마운트)**
- Modify: `src/app/(site)/layout.tsx` — `<WebVitalsReporter />` 마운트

**cron 정리**
- Create: `src/shared/lib/rum-cleanup/worker.ts` — 30일 초과 `deleteMany` (멱등)
- Modify: `src/app/api/cron/dispatcher/route.ts` — `rum-cleanup` 워커 등록
- Test: `src/shared/lib/rum-cleanup/__tests__/worker.test.ts`

**prisma**
- Modify: `prisma/schema.prisma` — `WebVitalEvent` 모델
- Create: `prisma/migrations/20260611000000_rum_web_vitals/migration.sql` (수동 — pgvector shadow DB 우회)

---

## Task 1: Prisma `WebVitalEvent` 모델 + 마이그레이션

**Files:**
- Modify: `prisma/schema.prisma` (모델 추가 — 파일 끝)
- Create: `prisma/migrations/20260611000000_rum_web_vitals/migration.sql`

> ⚠️ 이 repo는 Supabase pgvector 때문에 `prisma migrate dev`가 shadow DB에서 실패한다(memory: project-prisma-migration-workaround). **3-step 우회**를 따른다: `db push` → 수동 SQL → `migrate resolve`.

- [x] **Step 1: 스키마에 모델 추가**

`prisma/schema.prisma` 파일 끝에 추가:

```prisma
/// 실사용자 Web Vitals 원시 이벤트 (RUM). PII 0 — userId/IP 미저장.
/// value는 측정값(ms; CLS만 무차원 비율)이라 Float가 정확 — §5 float 금지는 돈에 한정.
/// 30일 보존(cron 정리). route는 정규화 템플릿만(cardinality 제어).
model WebVitalEvent {
  id        String   @id @default(cuid())
  metric    String // "LCP" | "INP" | "CLS" | "TTFB" | "FCP"
  value     Float
  rating    String // "good" | "needs-improvement" | "poor"
  route     String // 정규화 템플릿 (예: "/products/[id]")
  navType   String?
  createdAt DateTime @default(now())

  @@index([metric, createdAt]) // p75 시계열 집계
  @@index([route, metric, createdAt]) // route별 분해
}
```

- [x] **Step 2: DB에 직접 반영 (shadow DB 우회)**

Run: `npx prisma db push --accept-data-loss`
Expected: `Your database is now in sync with your Prisma schema` + `Generated Prisma Client`

- [x] **Step 3: 마이그레이션 SQL 수동 작성**

`prisma/migrations/20260611000000_rum_web_vitals/migration.sql` 생성:

```sql
-- CreateTable
CREATE TABLE "WebVitalEvent" (
    "id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "rating" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "navType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebVitalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebVitalEvent_metric_createdAt_idx" ON "WebVitalEvent"("metric", "createdAt");

-- CreateIndex
CREATE INDEX "WebVitalEvent_route_metric_createdAt_idx" ON "WebVitalEvent"("route", "metric", "createdAt");
```

- [x] **Step 4: 마이그레이션 히스토리에 등록**

Run: `npx prisma migrate resolve --applied 20260611000000_rum_web_vitals`
Expected: `Migration 20260611000000_rum_web_vitals marked as applied.`

- [x] **Step 5: 타입 생성 확인**

Run: `npx prisma generate && npm run typecheck`
Expected: 에러 없음 (`db.webVitalEvent` 타입 사용 가능)

- [x] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260611000000_rum_web_vitals/
git commit -m "feat(rum): WebVitalEvent model + migration (raw events, 30d retention)"
```

---

## Task 2: `normalizeRoute` 순수함수 (cardinality 제어 SSOT)

**Files:**
- Create: `src/features/rum/model/normalizeRoute.ts`
- Test: `src/features/rum/model/__tests__/normalizeRoute.test.ts`

- [x] **Step 1: 실패 테스트 작성**

`src/features/rum/model/__tests__/normalizeRoute.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { normalizeRoute, coerceRouteTemplate, ROUTE_TEMPLATES } from "../normalizeRoute";

describe("normalizeRoute", () => {
  it("PDP 동적 id를 템플릿으로 접는다", () => {
    expect(normalizeRoute("/products/abc123")).toBe("/products/[id]");
    expect(normalizeRoute("/products/xyz-789")).toBe("/products/[id]");
  });

  it("PDP 하위 checkout을 구분한다", () => {
    expect(normalizeRoute("/products/abc/checkout")).toBe("/products/[id]/checkout");
  });

  it("bookings 동적 id와 하위 경로를 구분한다", () => {
    expect(normalizeRoute("/bookings/bk1")).toBe("/bookings/[id]");
    expect(normalizeRoute("/bookings/bk1/success")).toBe("/bookings/[id]/success");
    expect(normalizeRoute("/bookings/bk1/failed")).toBe("/bookings/[id]/failed");
  });

  it("알려진 정적 경로는 그대로 둔다", () => {
    expect(normalizeRoute("/")).toBe("/");
    expect(normalizeRoute("/products")).toBe("/products");
    expect(normalizeRoute("/search")).toBe("/search");
  });

  it("trailing slash와 query string을 제거한다", () => {
    expect(normalizeRoute("/products/abc/")).toBe("/products/[id]");
    expect(normalizeRoute("/search?q=osaka")).toBe("/search");
  });

  it("미상 경로는 /(other) 버킷으로 수렴한다", () => {
    expect(normalizeRoute("/random/deep/path")).toBe("/(other)");
    expect(normalizeRoute("/admin/secret")).toBe("/(other)");
  });

  it("coerceRouteTemplate는 템플릿 화이트리스트만 통과, 임의 문자열은 /(other)", () => {
    expect(coerceRouteTemplate("/products/[id]")).toBe("/products/[id]");
    expect(coerceRouteTemplate("/evil-injected-string")).toBe("/(other)");
  });

  it("ROUTE_TEMPLATES는 /(other)를 포함한다", () => {
    expect(ROUTE_TEMPLATES).toContain("/(other)");
  });
});
```

- [x] **Step 2: 실패 확인**

Run: `npx vitest run src/features/rum/model/__tests__/normalizeRoute.test.ts`
Expected: FAIL — `Cannot find module '../normalizeRoute'`

- [x] **Step 3: 구현**

`src/features/rum/model/normalizeRoute.ts`:

```typescript
/**
 * 원시 pathname → route 템플릿 접기 (RUM cardinality 제어 SSOT).
 * 클라이언트(수집)와 서버(route handler 재검증) 양쪽이 동일 SSOT 사용.
 * 순수함수 — DB/env import 0, 클라이언트 번들 안전.
 */

/** 알려진 동적 경로 규칙 — 더 구체적인 패턴이 먼저 (순서 의존). */
const DYNAMIC_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/products\/[^/]+\/checkout$/, "/products/[id]/checkout"],
  [/^\/products\/[^/]+$/, "/products/[id]"],
  [/^\/bookings\/[^/]+\/success$/, "/bookings/[id]/success"],
  [/^\/bookings\/[^/]+\/failed$/, "/bookings/[id]/failed"],
  [/^\/bookings\/[^/]+$/, "/bookings/[id]"],
];

/** 알려진 정적 경로. */
const STATIC_ROUTES: ReadonlySet<string> = new Set([
  "/",
  "/products",
  "/search",
  "/compare",
  "/login",
  "/signup",
  "/mypage",
  "/reviews/new",
]);

export const OTHER_BUCKET = "/(other)";

/** 저장 가능한 모든 route 템플릿 (서버 재검증 화이트리스트). */
export const ROUTE_TEMPLATES = [
  ...STATIC_ROUTES,
  "/products/[id]",
  "/products/[id]/checkout",
  "/bookings/[id]",
  "/bookings/[id]/success",
  "/bookings/[id]/failed",
  OTHER_BUCKET,
] as const;

const TEMPLATE_SET: ReadonlySet<string> = new Set(ROUTE_TEMPLATES);

/** pathname을 정규화 템플릿으로 접는다. 미상은 /(other). */
export function normalizeRoute(pathname: string): string {
  const path = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  for (const [re, tpl] of DYNAMIC_RULES) {
    if (re.test(path)) return tpl;
  }
  if (STATIC_ROUTES.has(path)) return path;
  return OTHER_BUCKET;
}

/** 서버측 재검증 — 화이트리스트 밖 값은 /(other)로 강등(임의 문자열 저장 차단). */
export function coerceRouteTemplate(route: string): string {
  return TEMPLATE_SET.has(route) ? route : OTHER_BUCKET;
}
```

- [x] **Step 4: 통과 확인**

Run: `npx vitest run src/features/rum/model/__tests__/normalizeRoute.test.ts`
Expected: PASS (8 tests)

- [x] **Step 5: Commit**

```bash
git add src/features/rum/model/normalizeRoute.ts src/features/rum/model/__tests__/normalizeRoute.test.ts
git commit -m "feat(rum): normalizeRoute pure fn — route template folding SSOT"
```

---

## Task 3: `ratingFor` 순수함수 (web-vitals 임계 판정)

**Files:**
- Create: `src/features/rum/model/rating.ts`
- Test: `src/features/rum/model/__tests__/rating.test.ts`

- [x] **Step 1: 실패 테스트 작성**

`src/features/rum/model/__tests__/rating.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ratingFor } from "../rating";

describe("ratingFor (web-vitals 표준 임계)", () => {
  it("LCP: ≤2500 good, ≤4000 ni, >4000 poor", () => {
    expect(ratingFor("LCP", 2500)).toBe("good");
    expect(ratingFor("LCP", 2501)).toBe("needs-improvement");
    expect(ratingFor("LCP", 4000)).toBe("needs-improvement");
    expect(ratingFor("LCP", 4001)).toBe("poor");
  });

  it("INP: ≤200 good, ≤500 ni, >500 poor", () => {
    expect(ratingFor("INP", 200)).toBe("good");
    expect(ratingFor("INP", 350)).toBe("needs-improvement");
    expect(ratingFor("INP", 501)).toBe("poor");
  });

  it("CLS: ≤0.1 good, ≤0.25 ni, >0.25 poor", () => {
    expect(ratingFor("CLS", 0.1)).toBe("good");
    expect(ratingFor("CLS", 0.2)).toBe("needs-improvement");
    expect(ratingFor("CLS", 0.26)).toBe("poor");
  });

  it("FCP: ≤1800 good, ≤3000 ni, >3000 poor", () => {
    expect(ratingFor("FCP", 1800)).toBe("good");
    expect(ratingFor("FCP", 3001)).toBe("poor");
  });

  it("TTFB: ≤800 good, ≤1800 ni, >1800 poor", () => {
    expect(ratingFor("TTFB", 800)).toBe("good");
    expect(ratingFor("TTFB", 1801)).toBe("poor");
  });
});
```

- [x] **Step 2: 실패 확인**

Run: `npx vitest run src/features/rum/model/__tests__/rating.test.ts`
Expected: FAIL — `Cannot find module '../rating'`

- [x] **Step 3: 구현**

`src/features/rum/model/rating.ts`:

```typescript
/**
 * web-vitals 표준 임계로 good/needs-improvement/poor 판정 (순수함수).
 * 출처: web.dev Core Web Vitals 권장 임계값. 서버(route handler)가 적재 시 호출.
 */

export type WebVitalMetric = "LCP" | "INP" | "CLS" | "TTFB" | "FCP";
export type WebVitalRating = "good" | "needs-improvement" | "poor";

/** [good 상한, ni 상한] — 값 ≤ good → good, ≤ poor 상한 → ni, 초과 → poor. */
const THRESHOLDS: Record<WebVitalMetric, readonly [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

export function ratingFor(metric: WebVitalMetric, value: number): WebVitalRating {
  const [good, ni] = THRESHOLDS[metric];
  if (value <= good) return "good";
  if (value <= ni) return "needs-improvement";
  return "poor";
}
```

- [x] **Step 4: 통과 확인**

Run: `npx vitest run src/features/rum/model/__tests__/rating.test.ts`
Expected: PASS (5 tests)

- [x] **Step 5: Commit**

```bash
git add src/features/rum/model/rating.ts src/features/rum/model/__tests__/rating.test.ts
git commit -m "feat(rum): ratingFor pure fn — web-vitals threshold classification"
```

---

## Task 4: `webVitalSchema` Zod 입력 검증

**Files:**
- Create: `src/features/rum/model/schema.ts`
- Test: `src/features/rum/model/__tests__/schema.test.ts`

- [x] **Step 1: 실패 테스트 작성**

`src/features/rum/model/__tests__/schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { webVitalSchema } from "../schema";

describe("webVitalSchema", () => {
  it("정상 payload 통과", () => {
    const r = webVitalSchema.safeParse({
      metric: "LCP",
      value: 2300,
      route: "/products/[id]",
      navType: "navigate",
    });
    expect(r.success).toBe(true);
  });

  it("navType 생략 허용", () => {
    const r = webVitalSchema.safeParse({ metric: "CLS", value: 0.05, route: "/" });
    expect(r.success).toBe(true);
  });

  it("미상 metric 거부", () => {
    const r = webVitalSchema.safeParse({ metric: "FOO", value: 1, route: "/" });
    expect(r.success).toBe(false);
  });

  it("음수/NaN/Infinity value 거부", () => {
    expect(webVitalSchema.safeParse({ metric: "LCP", value: -1, route: "/" }).success).toBe(false);
    expect(webVitalSchema.safeParse({ metric: "LCP", value: NaN, route: "/" }).success).toBe(false);
    expect(webVitalSchema.safeParse({ metric: "LCP", value: Infinity, route: "/" }).success).toBe(false);
  });

  it("과도한 value(상한 초과) 거부", () => {
    expect(webVitalSchema.safeParse({ metric: "LCP", value: 9_999_999, route: "/" }).success).toBe(false);
  });

  it("route 길이 초과 거부", () => {
    const long = "/" + "x".repeat(200);
    expect(webVitalSchema.safeParse({ metric: "LCP", value: 1, route: long }).success).toBe(false);
  });
});
```

- [x] **Step 2: 실패 확인**

Run: `npx vitest run src/features/rum/model/__tests__/schema.test.ts`
Expected: FAIL — `Cannot find module '../schema'`

- [x] **Step 3: 구현**

`src/features/rum/model/schema.ts`:

```typescript
import { z } from "zod";
import type { WebVitalMetric } from "./rating";

export const METRICS = ["LCP", "INP", "CLS", "TTFB", "FCP"] as const satisfies readonly WebVitalMetric[];

/**
 * RUM 수신 페이로드 검증. fire-and-forget 비콘이라 엄격하게 — 미상 metric/음수/NaN/과대값 차단.
 * value 상한 1_000_000ms(=1000s) — 정상 측정 불가 범위 거부.
 */
export const webVitalSchema = z.object({
  metric: z.enum(METRICS),
  value: z.number().finite().nonnegative().max(1_000_000),
  route: z.string().min(1).max(120),
  navType: z.string().max(40).optional(),
});

export type WebVitalInput = z.infer<typeof webVitalSchema>;
```

- [x] **Step 4: 통과 확인**

Run: `npx vitest run src/features/rum/model/__tests__/schema.test.ts`
Expected: PASS (6 tests)

- [x] **Step 5: Commit**

```bash
git add src/features/rum/model/schema.ts src/features/rum/model/__tests__/schema.test.ts
git commit -m "feat(rum): webVitalSchema Zod input validation"
```

---

## Task 5: `rum` rate-limit tier 추가

**Files:**
- Modify: `src/shared/lib/rate-limit/tiers.ts`

- [x] **Step 1: `RateLimitTier` 유니온에 "rum" 추가**

`src/shared/lib/rate-limit/tiers.ts` 1번 줄 수정:

```typescript
export type RateLimitTier = "global" | "auth" | "payment" | "ai-search" | "mutation" | "rum";
```

- [x] **Step 2: `RATE_LIMIT_TIERS`에 rum tier 추가**

`mutation` 항목 바로 다음(`} as const satisfies` 직전)에 추가:

```typescript
  /** RUM 비콘 수집 — 공개·비인증 엔드포인트, IP당 관대한 한도. */
  rum: { limit: 60, window: "1 m", idStrategy: "ipOnly" },
```

- [x] **Step 3: typecheck (satisfies Record 완전성 확인)**

Run: `npm run typecheck`
Expected: 에러 없음 (`satisfies Record<RateLimitTier, TierConfig>`가 6개 tier 모두 충족)

- [x] **Step 4: 기존 rate-limit 테스트 회귀 확인**

Run: `npx vitest run src/shared/lib/rate-limit`
Expected: PASS (기존 테스트 그린)

- [x] **Step 5: Commit**

```bash
git add src/shared/lib/rate-limit/tiers.ts
git commit -m "feat(rum): add rum rate-limit tier (60/min, ipOnly)"
```

---

## Task 6: `POST /api/rum` route handler

**Files:**
- Create: `src/app/api/rum/route.ts`
- Test: `src/app/api/rum/__tests__/route.test.ts`

- [x] **Step 1: 실패 테스트 작성**

`src/app/api/rum/__tests__/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
vi.mock("@/shared/lib/db", () => ({ db: { webVitalEvent: { create: (...a: unknown[]) => createMock(...a) } } }));

// withRateLimit를 pass-through로 모킹 (rate-limit 로직은 Task 5/기존 테스트가 커버).
vi.mock("@/shared/lib/rate-limit", () => ({
  withRateLimit: (_opts: unknown, handler: (req: Request) => Promise<Response>) => handler,
}));

async function postRum(body: unknown) {
  const { POST } = await import("../route");
  const req = new Request("http://localhost:3000/api/rum", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(req as never);
}

describe("/api/rum", () => {
  beforeEach(() => createMock.mockReset());

  it("정상 payload → 204 + create 1회 (rating 자동 산출)", async () => {
    const res = await postRum({ metric: "LCP", value: 2300, route: "/products/[id]", navType: "navigate" });
    expect(res.status).toBe(204);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].data).toMatchObject({
      metric: "LCP",
      value: 2300,
      rating: "good",
      route: "/products/[id]",
      navType: "navigate",
    });
  });

  it("화이트리스트 밖 route → /(other)로 강등 저장", async () => {
    await postRum({ metric: "CLS", value: 0.05, route: "/evil-injected" });
    expect(createMock.mock.calls[0][0].data.route).toBe("/(other)");
  });

  it("악성/미상 payload → 400 + create 0회", async () => {
    const res = await postRum({ metric: "HACK", value: -5, route: "/" });
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("잘못된 JSON → 400 + create 0회", async () => {
    const res = await postRum("not-json{{{");
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: 실패 확인**

Run: `npx vitest run src/app/api/rum/__tests__/route.test.ts`
Expected: FAIL — `Cannot find module '../route'`

- [x] **Step 3: 구현**

`src/app/api/rum/route.ts`:

```typescript
/**
 * POST /api/rum — Web Vitals 비콘 수집 (RUM).
 * fire-and-forget: 정상 204, 검증 실패 400(클라는 sendBeacon이라 응답 무시).
 * rate-limit: rum tier(60/min IP, fail-open). route는 서버 화이트리스트로 재검증.
 * runtime=nodejs: Prisma 사용.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withRateLimit } from "@/shared/lib/rate-limit";
import { db } from "@/shared/lib/db";
import { webVitalSchema } from "@/features/rum/model/schema";
import { coerceRouteTemplate } from "@/features/rum/model/normalizeRoute";
import { ratingFor } from "@/features/rum/model/rating";

export const runtime = "nodejs";

export const POST = withRateLimit(
  { tier: "rum" },
  async (req: NextRequest): Promise<NextResponse> => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new NextResponse(null, { status: 400 });
    }

    const parsed = webVitalSchema.safeParse(body);
    if (!parsed.success) {
      return new NextResponse(null, { status: 400 });
    }

    const { metric, value, navType } = parsed.data;
    await db.webVitalEvent.create({
      data: {
        metric,
        value,
        rating: ratingFor(metric, value),
        route: coerceRouteTemplate(parsed.data.route),
        navType: navType ?? null,
      },
    });

    return new NextResponse(null, { status: 204 });
  },
);
```

- [x] **Step 4: 통과 확인**

Run: `npx vitest run src/app/api/rum/__tests__/route.test.ts`
Expected: PASS (4 tests)

- [x] **Step 5: Commit**

```bash
git add src/app/api/rum/route.ts src/app/api/rum/__tests__/route.test.ts
git commit -m "feat(rum): POST /api/rum collector — Zod + rate-limit + route coercion"
```

---

## Task 7: `WebVitalsReporter` 클라이언트 island + barrel + 마운트

**Files:**
- Create: `src/features/rum/ui/WebVitalsReporter.tsx`
- Create: `src/features/rum/index.ts`
- Modify: `src/app/(site)/layout.tsx`

> client island이므로 `@/shared/lib/env` import 금지(memory: feedback_client_safe_no_env_import). URL은 상대경로 `/api/rum`이라 env 불요.

- [x] **Step 1: 클라이언트 island 구현**

`src/features/rum/ui/WebVitalsReporter.tsx`:

```typescript
"use client";

import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { normalizeRoute } from "../model/normalizeRoute";
import { METRICS } from "../model/schema";

/**
 * Web Vitals 수집 island. RSC 레이아웃에 마운트.
 * useReportWebVitals 콜백이 메트릭별로 발화 → 정규화 → sendBeacon(/api/rum).
 * sendBeacon은 page unload 중에도 전송 보장(INP/LCP 종종 이탈 직전 확정).
 * UI 없음(null 렌더) — 부수효과 전용.
 */
export function WebVitalsReporter() {
  const pathname = usePathname();

  useReportWebVitals((metric) => {
    // Core Web Vitals 5종만 전송(커스텀 마크 무시).
    if (!(METRICS as readonly string[]).includes(metric.name)) return;

    const body = JSON.stringify({
      metric: metric.name,
      value: metric.value,
      route: normalizeRoute(pathname),
      navType: metric.navigationType,
    });

    // sendBeacon 우선(unload-safe), 미지원 시 keepalive fetch 폴백.
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/rum", body);
    } else {
      void fetch("/api/rum", {
        method: "POST",
        body,
        keepalive: true,
        headers: { "content-type": "application/json" },
      }).catch(() => {});
    }
  });

  return null;
}
```

- [x] **Step 2: barrel 작성**

`src/features/rum/index.ts`:

```typescript
export { WebVitalsReporter } from "./ui/WebVitalsReporter";
```

- [x] **Step 3: `(site)` 레이아웃에 마운트**

`src/app/(site)/layout.tsx` 수정 — import 추가:

```typescript
import { WebVitalsReporter } from "@/features/rum";
```

`<SiteFooter />` 바로 다음에 추가(`</>` 직전):

```typescript
      <SiteFooter />
      <WebVitalsReporter />
```

- [x] **Step 4: typecheck + build (client/server 경계 검증)**

> client 경계·배럴 변경은 typecheck/test로 부족 — build로 검증(memory: feedback_run_build_for_boundaries). dev 서버 가동 중이면 먼저 종료(memory: feedback_no_build_during_dev).

Run: `npm run typecheck && npm run build`
Expected: 빌드 성공. `next/web-vitals` import 정상, env 누수/UnhandledScheme 에러 없음.

- [x] **Step 5: Commit**

```bash
git add src/features/rum/ui/WebVitalsReporter.tsx src/features/rum/index.ts "src/app/(site)/layout.tsx"
git commit -m "feat(rum): WebVitalsReporter island + mount in site layout"
```

---

## Task 8: analytics RUM read-model (p75 집계)

**Files:**
- Create: `src/entities/analytics/api/rum.ts`
- Modify: `src/entities/analytics/model/types.ts`
- Modify: `src/entities/analytics/index.ts`
- Test: `src/entities/analytics/api/__tests__/rum.test.ts`

> `percentile_cont`는 Postgres 전용 SQL이라 단위테스트 불가 → **행→결과 매핑 변환**을 mock된 `$queryRaw`로 검증. SQL 정확도는 Task 11 런타임 QA로 증명.

- [x] **Step 1: 결과 타입 추가**

`src/entities/analytics/model/types.ts` 파일 끝에 추가:

```typescript
// ─── RUM (Web Vitals p75) ───────────────────────────────────────
export interface WebVitalP75 {
  metric: string;
  p75: number;
  sampleCount: number;
}
export interface RouteVitalP75 {
  route: string;
  metric: string;
  p75: number;
  sampleCount: number;
}
export interface VitalTrendPoint {
  date: string; // YYYY-MM-DD
  metric: string;
  p75: number;
}
```

- [x] **Step 2: 실패 테스트 작성**

`src/entities/analytics/api/__tests__/rum.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryRawMock = vi.fn();
vi.mock("@/shared/lib/db", () => ({ db: { $queryRaw: (...a: unknown[]) => queryRawMock(...a) } }));
// unstable_cache는 fn을 그대로 실행하는 pass-through로.
vi.mock("next/cache", () => ({ unstable_cache: (fn: (...a: unknown[]) => unknown) => fn }));

describe("RUM read-model 매핑", () => {
  beforeEach(() => queryRawMock.mockReset());

  it("getWebVitalSummary: bigint count → number, p75 변환", async () => {
    queryRawMock.mockResolvedValue([{ metric: "LCP", p75: 2300, count: 42n }]);
    const { getWebVitalSummary } = await import("../rum");
    const res = await getWebVitalSummary();
    expect(res).toEqual([{ metric: "LCP", p75: 2300, sampleCount: 42 }]);
  });

  it("getWebVitalByRoute: route별 매핑", async () => {
    queryRawMock.mockResolvedValue([{ route: "/products/[id]", metric: "INP", p75: 180, count: 10n }]);
    const { getWebVitalByRoute } = await import("../rum");
    const res = await getWebVitalByRoute();
    expect(res).toEqual([{ route: "/products/[id]", metric: "INP", p75: 180, sampleCount: 10 }]);
  });

  it("getWebVitalTrend: Date day → YYYY-MM-DD 문자열", async () => {
    queryRawMock.mockResolvedValue([{ day: new Date("2026-06-10T00:00:00Z"), metric: "LCP", p75: 2100 }]);
    const { getWebVitalTrend } = await import("../rum");
    const res = await getWebVitalTrend();
    expect(res).toEqual([{ date: "2026-06-10", metric: "LCP", p75: 2100 }]);
  });
});
```

- [x] **Step 3: 실패 확인**

Run: `npx vitest run src/entities/analytics/api/__tests__/rum.test.ts`
Expected: FAIL — `Cannot find module '../rum'`

- [x] **Step 4: read-model 구현**

`src/entities/analytics/api/rum.ts`:

```typescript
import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { db } from "@/shared/lib/db";
import type { WebVitalP75, RouteVitalP75, VitalTrendPoint } from "../model/types";

export const TAG_RUM = "analytics:rum";
const CACHE_OPTS: { revalidate: number; tags: string[] } = {
  revalidate: 60,
  tags: [TAG_RUM],
};

const num = (v: unknown): number => (v == null ? 0 : Number(v));

// 메트릭별 p75 (최근 7일).
async function _summary(): Promise<WebVitalP75[]> {
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
  return unstable_cache(_summary, ["rum-summary"], CACHE_OPTS)();
}
export function getWebVitalByRoute(): Promise<RouteVitalP75[]> {
  return unstable_cache(_byRoute, ["rum-by-route"], CACHE_OPTS)();
}
export function getWebVitalTrend(): Promise<VitalTrendPoint[]> {
  return unstable_cache(_trend, ["rum-trend"], CACHE_OPTS)();
}
```

- [x] **Step 5: barrel export 추가**

`src/entities/analytics/index.ts`의 타입 export 블록에 추가:

```typescript
export type { WebVitalP75, RouteVitalP75, VitalTrendPoint } from "./model/types";
export { getWebVitalSummary, getWebVitalByRoute, getWebVitalTrend, TAG_RUM } from "./api/rum";
```

- [x] **Step 6: 통과 확인**

Run: `npx vitest run src/entities/analytics/api/__tests__/rum.test.ts && npm run typecheck`
Expected: PASS (3 tests) + typecheck 그린

- [x] **Step 7: Commit**

```bash
git add src/entities/analytics/api/rum.ts src/entities/analytics/model/types.ts src/entities/analytics/index.ts src/entities/analytics/api/__tests__/rum.test.ts
git commit -m "feat(rum): analytics read-model — p75 summary/by-route/trend ($queryRaw percentile_cont)"
```

---

## Task 9: 어드민 "성능" 패널 (server 조립 + Recharts 리프)

**Files:**
- Create: `src/widgets/admin-dashboard/ui/WebVitalTrendChart.tsx`
- Create: `src/widgets/admin-dashboard/ui/PerformancePanel.tsx`
- Modify: `src/widgets/admin-dashboard/ui/AdminDashboard.tsx`
- Modify: `src/app/(admin)/admin/dashboard/page.tsx`

> 차트는 `'use client'` 리프에만 격리(ADR-0033), 서버 집계 plain 배열 props 주입. 패널 본체·카드·테이블은 server. `db` import 0.

- [x] **Step 1: Recharts client 리프 구현**

`src/widgets/admin-dashboard/ui/WebVitalTrendChart.tsx`:

```typescript
"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { VitalTrendPoint } from "@/entities/analytics";

// LCP/INP p75 추이 라인. window/ResizeObserver 의존 → 클라이언트 리프 격리.
// 서버가 메트릭별로 pivot한 배열을 받는다. DB·env import 없음.
export function WebVitalTrendChart({
  data,
}: {
  data: { date: string; LCP: number | null; INP: number | null }[];
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
        성능 데이터가 아직 없습니다.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "#9ca3af" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(d: string) => d.slice(5)}
        />
        <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={48} />
        <Tooltip />
        <Line type="monotone" dataKey="LCP" stroke="#2563eb" strokeWidth={2} dot={false} name="LCP(ms)" />
        <Line type="monotone" dataKey="INP" stroke="#16a34a" strokeWidth={2} dot={false} name="INP(ms)" />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** trend 평탄 배열(메트릭별 행) → 차트용 일자별 pivot. 순수 변환. */
export function pivotTrend(
  points: VitalTrendPoint[],
): { date: string; LCP: number | null; INP: number | null }[] {
  const byDate = new Map<string, { date: string; LCP: number | null; INP: number | null }>();
  for (const p of points) {
    const row = byDate.get(p.date) ?? { date: p.date, LCP: null, INP: null };
    if (p.metric === "LCP") row.LCP = p.p75;
    if (p.metric === "INP") row.INP = p.p75;
    byDate.set(p.date, row);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
```

- [x] **Step 2: server 패널 구현 (p75 카드 + 테이블)**

`src/widgets/admin-dashboard/ui/PerformancePanel.tsx`:

```typescript
import { Badge } from "@/shared/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import type { WebVitalP75, RouteVitalP75, VitalTrendPoint } from "@/entities/analytics";
import { WebVitalTrendChart, pivotTrend } from "./WebVitalTrendChart";

// p75 값을 web-vitals 임계로 tone 매핑(신호등). 단위: ms(CLS만 무차원).
const THRESHOLDS: Record<string, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

function toneFor(metric: string, value: number): "success" | "warning" | "destructive" {
  const t = THRESHOLDS[metric];
  if (!t) return "warning";
  if (value <= t[0]) return "success";
  if (value <= t[1]) return "warning";
  return "destructive";
}

function fmt(metric: string, value: number): string {
  return metric === "CLS" ? value.toFixed(3) : `${Math.round(value)}ms`;
}

// 카드로 노출할 핵심 3종 순서.
const CORE = ["LCP", "INP", "CLS"] as const;

export function PerformancePanel({
  summary,
  byRoute,
  trend,
}: {
  summary: WebVitalP75[];
  byRoute: RouteVitalP75[];
  trend: VitalTrendPoint[];
}) {
  const summaryMap = new Map(summary.map((s) => [s.metric, s]));

  return (
    <section className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h3 className="text-sm font-bold text-foreground">실사용자 성능 (Web Vitals p75 · 최근 7일)</h3>
      <p className="mb-3 text-[11.5px] text-muted-foreground">
        실제 방문자 측정값. 녹색=good, 노랑=needs-improvement, 빨강=poor (web-vitals 임계).
      </p>

      {/* p75 카드 3종 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {CORE.map((metric) => {
          const s = summaryMap.get(metric);
          return (
            <div key={metric} className="rounded-xl border border-border p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">{metric} p75</span>
                {s ? <Badge variant={toneFor(metric, s.p75)}>{fmt(metric, s.p75)}</Badge> : null}
              </div>
              <div className="mt-1 text-lg font-bold text-foreground">
                {s ? fmt(metric, s.p75) : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {s ? `${s.sampleCount} samples` : "데이터 없음"}
              </div>
            </div>
          );
        })}
      </div>

      {/* 추이 차트 */}
      <div className="mt-4">
        <WebVitalTrendChart data={pivotTrend(trend)} />
      </div>

      {/* route별 테이블 */}
      <div className="mt-4 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Route</TableHead>
              <TableHead>Metric</TableHead>
              <TableHead>p75</TableHead>
              <TableHead>Samples</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byRoute.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                  수집된 데이터가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              byRoute.map((r) => (
                <TableRow key={`${r.route}:${r.metric}`}>
                  <TableCell className="font-mono text-xs">{r.route}</TableCell>
                  <TableCell>{r.metric}</TableCell>
                  <TableCell>
                    <Badge variant={toneFor(r.metric, r.p75)}>{fmt(r.metric, r.p75)}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.sampleCount}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
```

- [x] **Step 3: `AdminDashboard`에 패널 props 수용 + 렌더**

`src/widgets/admin-dashboard/ui/AdminDashboard.tsx` 수정:

import 추가:

```typescript
import { PerformancePanel } from "./PerformancePanel";
import type { WebVitalP75, RouteVitalP75, VitalTrendPoint } from "@/entities/analytics";
```

props 타입에 `rum` 추가 (함수 시그니처의 구조분해 `}: {` 블록):

```typescript
  rum,
}: {
  data: DashboardData;
  start: string;
  end: string;
  productId: string | null;
  productOptions: ProductOption[];
  rum: { summary: WebVitalP75[]; byRoute: RouteVitalP75[]; trend: VitalTrendPoint[] };
}) {
```

함수 본문 최하단 `</div>` 닫기 직전(예약 상태 분포 `</div>` 다음)에 추가:

```typescript
      <PerformancePanel summary={rum.summary} byRoute={rum.byRoute} trend={rum.trend} />
```

- [x] **Step 4: 대시보드 페이지에서 RUM 집계 fetch + 주입**

`src/app/(admin)/admin/dashboard/page.tsx` 수정:

import 블록에 추가:

```typescript
import {
  parseFilter,
  getRevenueSummary,
  getPenaltyRevenue,
  getCancellationStats,
  getSeatOccupancy,
  getRevenueTrend,
  getBookingStatusDistribution,
  getProductOptions,
  getWebVitalSummary,
  getWebVitalByRoute,
  getWebVitalTrend,
} from "@/entities/analytics";
```

`Promise.all` 배열에 RUM 3종 추가 + 구조분해 수정:

```typescript
  const [
    revenue,
    penaltyRevenue,
    cancellation,
    occupancy,
    trend,
    statusDistribution,
    productOptions,
    rumSummary,
    rumByRoute,
    rumTrend,
  ] = await Promise.all([
    getRevenueSummary(filter),
    getPenaltyRevenue(filter),
    getCancellationStats(filter),
    getSeatOccupancy(filter),
    getRevenueTrend(filter),
    getBookingStatusDistribution(filter),
    getProductOptions(),
    getWebVitalSummary(),
    getWebVitalByRoute(),
    getWebVitalTrend(),
  ]);
```

`<AdminDashboard … />`에 prop 추가:

```typescript
      rum={{ summary: rumSummary, byRoute: rumByRoute, trend: rumTrend }}
```

- [x] **Step 5: typecheck + build (server/client 경계 + 배럴)**

Run: `npm run typecheck && npm run build`
Expected: 빌드 성공. `grep "use client" src/widgets/admin-dashboard/ui/`가 차트 3개(Revenue/Donut/WebVitalTrend) + 필터 2개 = **5개**(신규 차트 1 추가). `db` import가 `'use client'` 파일에 없음.

- [x] **Step 6: Commit**

```bash
git add src/widgets/admin-dashboard/ui/WebVitalTrendChart.tsx src/widgets/admin-dashboard/ui/PerformancePanel.tsx src/widgets/admin-dashboard/ui/AdminDashboard.tsx "src/app/(admin)/admin/dashboard/page.tsx"
git commit -m "feat(rum): admin performance panel — p75 cards + trend chart + per-route table"
```

---

## Task 10: `rum-cleanup` cron 워커 (30일 보존)

**Files:**
- Create: `src/shared/lib/rum-cleanup/worker.ts`
- Modify: `src/app/api/cron/dispatcher/route.ts`
- Test: `src/shared/lib/rum-cleanup/__tests__/worker.test.ts`

- [x] **Step 1: 실패 테스트 작성**

`src/shared/lib/rum-cleanup/__tests__/worker.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const deleteManyMock = vi.fn();
vi.mock("@/shared/lib/db", () => ({ db: { webVitalEvent: { deleteMany: (...a: unknown[]) => deleteManyMock(...a) } } }));

describe("rum-cleanup worker", () => {
  beforeEach(() => deleteManyMock.mockReset());

  it("30일 초과 이벤트를 삭제하고 삭제 건수를 반환", async () => {
    deleteManyMock.mockResolvedValue({ count: 7 });
    const { processRumCleanup } = await import("../worker");
    const res = await processRumCleanup();
    expect(res).toEqual({ deleted: 7 });
    const arg = deleteManyMock.mock.calls[0][0];
    expect(arg.where.createdAt.lt).toBeInstanceOf(Date);
    // 경계가 대략 30일 전인지(±1일) 확인
    const cutoff = arg.where.createdAt.lt.getTime();
    const expected = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff - expected)).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it("삭제 대상 0건이어도 정상(멱등)", async () => {
    deleteManyMock.mockResolvedValue({ count: 0 });
    const { processRumCleanup } = await import("../worker");
    const res = await processRumCleanup();
    expect(res).toEqual({ deleted: 0 });
  });
});
```

- [x] **Step 2: 실패 확인**

Run: `npx vitest run src/shared/lib/rum-cleanup/__tests__/worker.test.ts`
Expected: FAIL — `Cannot find module '../worker'`

- [x] **Step 3: 워커 구현**

`src/shared/lib/rum-cleanup/worker.ts`:

```typescript
/**
 * rum-cleanup worker — WebVitalEvent 30일 보존 정리.
 * 시간 기준 deleteMany라 멱등(이미 삭제된 행은 no-op, 부분 실패 시 다음 tick 수렴).
 * cron 디스패처에서 호출(ADR-0005). 외부 IO 없음 — DB만.
 */
import { db } from "@/shared/lib/db";

const RETENTION_DAYS = 30;

export interface RumCleanupResult {
  deleted: number;
}

export async function processRumCleanup(): Promise<RumCleanupResult> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await db.webVitalEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return { deleted: count };
}
```

- [x] **Step 4: 통과 확인**

Run: `npx vitest run src/shared/lib/rum-cleanup/__tests__/worker.test.ts`
Expected: PASS (2 tests)

- [x] **Step 5: 디스패처에 워커 등록**

`src/app/api/cron/dispatcher/route.ts` 수정 — import 추가:

```typescript
import { processRumCleanup } from "@/shared/lib/rum-cleanup/worker";
```

`WORKERS` 배열에 추가:

```typescript
const WORKERS = [
  { name: "refund", run: () => processRefundJobBatch({ limit: 10 }) },
  { name: "email", run: () => processEmailJobBatch({ limit: 10 }) },
  { name: "embedding", run: () => processEmbeddingJobBatch({ limit: 5 }) },
  { name: "rum-cleanup", run: () => processRumCleanup() },
] as const;
```

- [x] **Step 6: typecheck + 기존 cron 테스트 회귀 확인**

Run: `npm run typecheck && npx vitest run src/app/api/cron`
Expected: typecheck 그린 + 기존 cron 테스트 PASS

- [x] **Step 7: Commit**

```bash
git add src/shared/lib/rum-cleanup/ "src/app/api/cron/dispatcher/route.ts"
git commit -m "feat(rum): rum-cleanup cron worker (30d retention, idempotent)"
```

---

## Task 11: 종합 QA 검증 + 런타임 증거 수집

**Files:** (코드 변경 없음 — 검증 전용)

> 🔬 QA Engineer 발동. typecheck/test/lint/build 자동 증거 + curl/DB 런타임 증거. "이론적으로 동작" 금지 — 실행 출력 인용.

- [x] **Step 1: 전체 정적 검증**

Run: `npm run typecheck && npm run test && npm run lint`
Expected: 모두 그린. 신규 테스트(normalizeRoute 8 + rating 5 + schema 6 + route 4 + rum read-model 3 + cleanup 2 = 28건) 포함 PASS.

- [x] **Step 2: 프로덕션 빌드 (경계 최종 검증)**

Run: `npm run build`
Expected: 빌드 성공. `(site)` 레이아웃·대시보드 페이지 정상. client 번들에 `db`/`env` 누수 없음(UnhandledSchemeError 없음).

- [x] **Step 3: 런타임 수집 검증 (dev 서버 + curl)**

`.next` 충돌 방지: build 후 `rm -rf .next` 하고 dev 재기동(memory: feedback_no_build_during_dev).

Run:
```bash
rm -rf .next
npm run dev &
sleep 5
# 정상 비콘 → 204
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/rum \
  -H "content-type: application/json" \
  -d '{"metric":"LCP","value":2300,"route":"/products/[id]","navType":"navigate"}'
# 악성 payload → 400
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/rum \
  -H "content-type: application/json" \
  -d '{"metric":"HACK","value":-1,"route":"/"}'
```
Expected: 첫 번째 `204`, 두 번째 `400`.

- [x] **Step 4: DB 적재 + p75 집계 SQL 검증**

Run:
```bash
npx prisma studio   # 또는 아래 psql/queryRaw
# WebVitalEvent에 LCP/2300/good/"/products/[id]" 행 1건 존재 확인.
```
또는 `npx tsx -e`로 `db.webVitalEvent.findMany()` + `getWebVitalSummary()` 호출해 `[{metric:"LCP", p75:2300, sampleCount:1}]` 반환 확인(percentile_cont SQL 실DB 검증 — 단위테스트가 못 한 부분).
Expected: 행 적재 확인 + p75 집계 정상 반환.

- [ ] **Step 5: 어드민 패널 시각 확인 (수동 — 자동화 불가 항목만)**

`admin@nextour.test`로 로그인(dev 매직링크 콘솔 출력) → `/admin/dashboard` 진입 → "실사용자 성능" 패널에 LCP/INP/CLS 카드 + route 테이블 노출 확인.
실패 시: 스크린샷 + 콘솔 에러 첨부.

- [x] **Step 6: 플랜 체크박스 최종 점검**

Run: `grep -n "\- \[ \]" docs/superpowers/plans/2026-06-11-phase5a-rum-pipeline.md`
Expected: Task 11 외 미완료 항목 0(완료된 Task는 모두 `[x]`).

- [x] **Step 7: 최종 검증 결과 보고 (§7.1 3-포맷)**

QA 자동 증거(typecheck/test/build/curl 출력)를 인용하고, Core Architecture / Boilerplate / Concept Insight 3섹션으로 보고. ADR 후보(RUM 자체호스팅 vs SaaS) 발행 제안 한 줄 첨부.

---

## 완료 기준 (Definition of Done)

- [x] 신규 테스트 28건 전부 PASS + 기존 테스트 회귀 0 (전체 1170 passed)
- [x] `npm run typecheck && npm run lint && npm run build` 그린 (lint 경고 2건은 기존 checkout 파일, RUM 무관 / build exit 0)
- [x] `/api/rum` 정상 204 / 악성 400 런타임 확인
- [x] `WebVitalEvent` 적재 + p75 집계(percentile_cont 실DB) 런타임 확인 (LCP p75=2300, INP p75=150)
- [ ] 어드민 "성능" 패널 렌더 확인 (사용자 수동 — 자동화 불가)
- [x] FSD 경계 위반 0 (client island에 `db`/`env` 누수 없음, entities→테이블 직접조회 유지)
- [x] 모든 Task 체크박스 `[x]` + plan 파일 반영 커밋

---

## Self-Review 메모 (작성자 점검 완료)

- **Spec 커버리지**: §3.2 데이터모델→T1, §3.3 컴포넌트 8단위→T2~T10, §3.4 전송(sendBeacon)→T7, §3.5 보안(Zod/rate-limit/whitelist/204)→T4·T5·T6, §3.6 패널→T9, §3.7 cron 정리→T10, §3.8 테스트→각 Task TDD + T11. 전 항목 매핑 확인.
- **타입 일관성**: `WebVitalMetric`(rating.ts)↔`METRICS`(schema.ts) `satisfies`로 결속. `WebVitalP75`/`RouteVitalP75`/`VitalTrendPoint`(types.ts) → read-model(T8) → 패널(T9) 동일 사용. `coerceRouteTemplate`/`normalizeRoute`(T2)가 client(T7)·server(T6) 양쪽에서 동일 SSOT.
- **Placeholder**: 없음 — 모든 step에 실제 코드/명령/기대 출력 포함.
- **마이그레이션**: pgvector shadow DB 우회 3-step 명시(memory 반영).
