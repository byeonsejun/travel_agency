# Phase 3 — Cache Tuning & ISR (B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 잔존 `force-dynamic` 페이지의 정합성 검증을 마무리하고, 데이터 레이어에 누락된 `unstable_cache` wrap(`getProductList` / `getDistinctDestinations` / `getProductsByIds`)을 보완하여 `/products` 리스팅·`/compare` 등 동적 페이지의 DB hit을 압축한다. `revalidateTag` 무효화 컨트랙트를 entities 공개 API에 박제해 미래 admin product CMS 가 hooking 할 자리만 정한다.

**Architecture:**
- 페이지 레벨 정책은 이미 ADR-0012/0015/0017/0018에서 박제 완료. `/` 5min ISR, `/products/[id]` 1h ISR, 결제·예약·admin·webhook·cron·health 는 의도된 `force-dynamic` — **이번 plan 에서 force-dynamic 을 제거하는 페이지는 없다**(NO-REAL-MONEY + 운영 안정성 [ADR-0009]).
- 새 캐시 윈은 `entities/product/api/queries.ts` 안에 갇혀 있다 — 3개 함수가 `unstable_cache` wrap 없이 매 호출마다 DB hit. 이들을 표준 패턴(`unstable_cache(fn, keyArr, { revalidate, tags })`)으로 래핑.
- 무효화 컨트랙트(어떤 mutation이 어떤 tag을 bust해야 하는가)는 `entities/product/index.ts` JSDoc 으로 박제. 현재 mutation 발신처가 없는 tag (`TAG_PRODUCTS_LIST`, `TAG_DESTINATIONS_LIST`)도 정의는 미리 — 미래 admin CMS PR 에서 hooking.

**Tech Stack:** Next.js 15 (App Router) `unstable_cache` / `revalidateTag`, Prisma 5, Vitest 2.

---

## Audit Snapshot (2026-05-27)

### Pages — `force-dynamic` / `revalidate`

| Path | 현재 설정 | 사유 | 조치 |
|---|---|---|---|
| `/` | `revalidate = 300` | 추천 상품 5min ISR | **유지** ([ADR-0015]) |
| `/products` | (auto-dynamic via `searchParams`) | filter/sort/page + auth() wishlistIds | **유지** — 데이터 레이어에서 캐시 압축 (Task 2~3) |
| `/products/[id]` | `revalidate = 3600` | PDP 1h ISR | **유지** ([ADR-0017]/[ADR-0018]) |
| `/products/[id]/checkout` | `force-dynamic` | 인증 + 실시간 좌석 + 결제 인접 | **유지** (NO-REAL-MONEY [ADR-0009]) |
| `/compare` | (auto-dynamic via `searchParams`) | ids 동적, but `getProductsByIds` 캐싱 여지 | **유지** — 데이터 레이어 캐시 확장 (Task 4) |
| `/search` | (auto-dynamic via `searchParams`) | AI 쿼리, Upstash Redis 캐시 별도 보유 | **유지** |
| `/login*` | (auto-dynamic via signIn/NextAuth) | OAuth 플로우 | **유지** |
| `/mypage` | `force-dynamic` | per-user 대시보드 | **유지** — 명시적 의도 보존 (cookies 의존 0이 되면 stale 사고 가능) |
| `/bookings/[id]` | `force-dynamic` | 예약 상태 실시간 + 환불 진행 | **유지** ([ADR-0003]) |
| `/bookings/[id]/success` | `force-dynamic` | 결제 확인 트랜지션 | **유지** |
| `/bookings/[id]/failed` | `force-dynamic` | 결제 실패 트랜지션 | **유지** |
| `/reviews/new` | `force-dynamic` | per-user 4-way 게이트 | **유지** |
| `/admin/bookings` | `force-dynamic` | 운영 즉시성 | **유지** |
| `/admin/bookings/[id]` | `force-dynamic` | 운영 즉시성 | **유지** |
| `/admin/refund-jobs` | `force-dynamic` | 운영 즉시성 | **유지** |

### API Routes — `force-dynamic` / Cache-Control

| Path | 현재 설정 | 사유 | 조치 |
|---|---|---|---|
| `/api/products/[id]/departures` | `force-dynamic`, `no-store` | 좌석 폴링 | **유지** |
| `/api/wishlist/check` | `private, no-store` | per-user | **유지** ([ADR-0017]) |
| `/api/wishlist/count` | `private, no-store` | per-user | **유지** ([ADR-0018]) |
| `/api/wishlist/resume` | redirect 부수효과 | 토글 mutation | **유지** |
| `/api/compare/products` | `max-age=30, s-maxage=300, swr=60` | ids 동적, 브라우저+CDN 캐시 | **유지** — 단 주석의 "unstable_cache 메모이즈" 문구가 현재 거짓 → Task 4 로 사실화 |
| `/api/auth/[...nextauth]` | (NextAuth 기본) | OAuth | **유지** |
| `/api/payments/webhook/toss` | `force-dynamic` | 웹훅 무캐시 ([ADR-0013]/[ADR-0016]) | **유지** |
| `/api/payments/confirm` | `force-dynamic` | 결제 확정 무캐시 | **유지** |
| `/api/cron/process-refunds` | `force-dynamic` | cron worker | **유지** ([ADR-0005]) |
| `/api/health` | `force-dynamic` | 헬스체크 | **유지** |

**결론:** 페이지 / API 레벨에서 force-dynamic 을 제거할 후보 **0건**. 모든 잔존 declaration 은 의도된 안정성 결정. 본 plan 의 변경은 전부 데이터 레이어(`entities/product/api/queries.ts`)에 집중.

### Data Layer — `unstable_cache` wrap 상태

| Function | 현재 | 목표 | 비고 |
|---|---|---|---|
| `getFeaturedProducts(limit)` | ✅ `unstable_cache(5min, TAG_PRODUCTS_FEATURED)` | 유지 | |
| `getProductById(id)` | ✅ `unstable_cache(1h, tagProductDetail(id))` | 유지 | |
| `getDeparturesByProduct(id)` | ✅ `unstable_cache(1h, tagDeparturesByProduct(id))` | 유지 | `entities/departure` |
| `getProductList(params)` | ❌ 미캐시 — `/products` 매 요청 DB hit | **Task 3** — 5min, `TAG_PRODUCTS_LIST` |
| `getDistinctDestinations()` | ❌ 미캐시 — `/products` 매 요청 groupBy | **Task 2** — 1h, `TAG_DESTINATIONS_LIST` |
| `getProductsByIds(ids)` | ❌ 미캐시 — `/compare` + `/api/compare/products` 매 요청 DB hit | **Task 4** — 1h, `ids.map(tagProductDetail)` |
| `getAllPublishedProductIds()` | ❌ 미캐시, `generateStaticParams` 빌드 타임 1회 | 유지 — 빌드 타임 1회라 영향 없음 |

### 무효화 컨트랙트 현황

| Tag | 발신처(현재) | 목표 발신처(미래) | TTL | 비고 |
|---|---|---|---|---|
| `TAG_PRODUCTS_FEATURED` | (없음) | 미래 admin product CMS | 5min | TTL fallback OK |
| `TAG_PRODUCTS_LIST` (신규) | (없음) | 미래 admin product CRUD | 5min | TTL fallback OK |
| `TAG_DESTINATIONS_LIST` (신규) | (없음) | 미래 admin product CRUD (status PUBLISHED 변동 시) | 1h | TTL fallback OK |
| `tagProductDetail(id)` | (현재 발신 없음) | 미래 admin product CMS | 1h | `getProductsByIds` 도 같은 태그 공유 → 한 번 bust 으로 양쪽 무효화 |
| `tagDeparturesByProduct(id)` | checkout, booking-cancel, admin-booking-cancel | 유지 | 1h | ✅ wiring 완료 |
| `tagProductDepartures(id)` | (없음, 정의만) | — | — | **Task 1 에서 삭제** (`entities/departure` 의 `tagDeparturesByProduct` 와 중복 dead export) |

### 무효화 정합성 검증 — 사용자 명시 제약("Stale data 방지")

| 시나리오 | 영향 받는 캐시 | 무효화 발신 | 상태 |
|---|---|---|---|
| 위시리스트 토글 | 없음 (per-user, `no-store`) | (불필요) | ✅ ([ADR-0019]) |
| 체크아웃(예약 생성, 좌석 차감) | `getDeparturesByProduct` (1h) + `/products/[id]` (1h ISR) | `revalidateTag(tagDeparturesByProduct(productId))` + `revalidatePath('/products/${productId}')` | ✅ |
| 예약 취소(유저) | 동일 | 동일 + `revalidatePath('/bookings/${id}')` + `revalidatePath('/mypage')` + `revalidatePath('/products/${productId}')` | ✅ |
| 예약 취소(admin) | 동일 + admin 페이지 | 동일 + admin 경로 | ✅ |
| 결제 웹훅 → 상태 전이 | `/bookings/[id]` 는 force-dynamic 이므로 페이지 캐시 없음 | DB 업데이트만 | ✅ |
| 리뷰 작성 | PDP 1h ISR | `revalidatePath('/products/${productId}')` + `revalidatePath('/mypage')` | ✅ |

**결론:** 본 plan 으로 새로 추가되는 캐시(`getProductList`/`getDistinctDestinations`/`getProductsByIds`) 가 mutation 시 stale 가 되는 시나리오를 분석 → 모두 시간 의존성이 약하거나 TTL fallback 으로 수용 가능 (Task 6 에서 명시 검증).

---

## File Structure

### Modify
- `src/entities/product/api/queries.ts` — `tagProductDepartures` 삭제, `getDistinctDestinations` / `getProductList` / `getProductsByIds` 에 `unstable_cache` wrap, 신규 태그 export(`TAG_PRODUCTS_LIST`, `TAG_DESTINATIONS_LIST`)
- `src/entities/product/index.ts` — `tagProductDepartures` re-export 제거, 신규 태그 re-export, 무효화 컨트랙트 JSDoc 박제
- `src/app/api/compare/products/route.ts` — 주석 정합성 확인 (이미 `unstable_cache 메모이즈` 라고 적힌 부분이 Task 4 이후 사실이 됨, 별도 수정 없음 — verify only)

### Create
- `src/entities/product/api/__tests__/cache-tags.test.ts` — 태그 함수의 문자열 안정성 + 새로 export 된 태그 상수 검증

### Verify (코드 변경 없음, 검증만)
- `src/features/checkout/server/actions.ts` — 기존 `revalidateTag(tagDeparturesByProduct(...))` 호출 유지 확인
- `src/features/booking-cancel/server/actions.ts` — 동일
- `src/features/admin-booking-cancel/server/actions.ts` — 동일
- `src/features/review-upload/server/actions.ts` — `revalidatePath('/products/${id}')` 유지 확인

---

## Tasks

### Task 1: Dead export `tagProductDepartures` 정리

**의도:** `entities/product` 가 `tagProductDepartures` 를 정의·export 하지만 어디서도 사용되지 않는다. `entities/departure` 의 `tagDeparturesByProduct` 가 실제 사용처. 중복·혼란 제거.

**Files:**
- Modify: `src/entities/product/api/queries.ts:15` (delete)
- Modify: `src/entities/product/index.ts:35` (delete from re-export)

- [x] **Step 1: 사용처 0 재확인**

Run:
```bash
grep -rn "tagProductDepartures" src/ docs/ 2>/dev/null
```
Expected: `src/entities/product/api/queries.ts:15` (정의) + `src/entities/product/index.ts:35` (re-export) 두 라인만 출력. 다른 사용처 0건이면 안전 삭제 가능.

- [x] **Step 2: `queries.ts` 에서 정의 제거**

Edit `src/entities/product/api/queries.ts`:
```ts
// before (line 13-15)
const TAG_PRODUCTS_FEATURED = "products:featured";
export const tagProductDetail = (id: string) => `product:${id}`;
export const tagProductDepartures = (id: string) => `product:${id}:departures`;

// after
const TAG_PRODUCTS_FEATURED = "products:featured";
export const tagProductDetail = (id: string) => `product:${id}`;
// 좌석/일정 캐시 태그는 entities/departure 의 tagDeparturesByProduct 가 단일 출처(SSOT).
// product 모듈은 PDP 본문(getProductById) 만 관리.
```

- [x] **Step 3: `index.ts` re-export 제거**

Edit `src/entities/product/index.ts`:
```ts
// before (line 34-35)
  tagProductDetail,
  tagProductDepartures,

// after
  tagProductDetail,
```

- [x] **Step 4: typecheck + 사용처 재검증**

Run:
```bash
npm run typecheck
grep -rn "tagProductDepartures" src/ 2>/dev/null
```
Expected: typecheck PASS, grep 출력 0건.

- [x] **Step 5: Commit**

```bash
git add src/entities/product/api/queries.ts src/entities/product/index.ts
git commit -m "refactor(product): remove dead tagProductDepartures export (SSOT은 entities/departure)"
```

---

### Task 2: `getDistinctDestinations` unstable_cache + TAG_DESTINATIONS_LIST

**의도:** `/products` 진입마다 `db.product.groupBy(by: destinationCode)` 호출. 목적지는 거의 변하지 않는 데이터 — 1h TTL + 상태 변동 시 태그 무효화.

**Files:**
- Modify: `src/entities/product/api/queries.ts` (`getDistinctDestinations` wrap + `TAG_DESTINATIONS_LIST` export)
- Modify: `src/entities/product/index.ts` (re-export 추가)
- Test: `src/entities/product/api/__tests__/cache-tags.test.ts` (create)

- [x] **Step 1: Failing test — TAG_DESTINATIONS_LIST 상수 존재**

Create `src/entities/product/api/__tests__/cache-tags.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  tagProductDetail,
  TAG_DESTINATIONS_LIST,
  TAG_PRODUCTS_LIST,
} from "../queries";

describe("cache tags — 무효화 컨트랙트", () => {
  it("tagProductDetail(id) 는 id 별 단일 키를 생성한다", () => {
    expect(tagProductDetail("cuid_abc")).toBe("product:cuid_abc");
    expect(tagProductDetail("cuid_xyz")).toBe("product:cuid_xyz");
    expect(tagProductDetail("cuid_abc")).not.toBe(tagProductDetail("cuid_xyz"));
  });

  it("TAG_DESTINATIONS_LIST 는 안정된 단일 문자열이다", () => {
    expect(TAG_DESTINATIONS_LIST).toBe("products:destinations");
  });

  it("TAG_PRODUCTS_LIST 는 안정된 단일 문자열이다", () => {
    expect(TAG_PRODUCTS_LIST).toBe("products:list");
  });
});
```

- [x] **Step 2: Run test — FAIL 확인**

Run:
```bash
npx vitest run src/entities/product/api/__tests__/cache-tags.test.ts
```
Expected: FAIL — `TAG_DESTINATIONS_LIST is not exported`, `TAG_PRODUCTS_LIST is not exported`.

- [x] **Step 3: TAG_DESTINATIONS_LIST 추가 + getDistinctDestinations wrap**

Edit `src/entities/product/api/queries.ts`. 태그 export 블록을 다음으로 교체:
```ts
// 캐시 태그 컨벤션 — features 레이어가 revalidateTag로 무효화할 때 사용.
//   products:featured       → 홈 추천 상품(공통)        (5min TTL fallback)
//   products:list           → /products 리스팅 + filter (5min TTL fallback)
//   products:destinations   → /products 필터 옵션 목록  (1h  TTL fallback)
//   product:${id}           → PDP 단건 상세 + compare   (1h  TTL fallback)
const TAG_PRODUCTS_FEATURED = "products:featured";
export const TAG_PRODUCTS_LIST = "products:list";
export const TAG_DESTINATIONS_LIST = "products:destinations";
export const tagProductDetail = (id: string) => `product:${id}`;
```

(`TAG_PRODUCTS_LIST` 는 Task 3 에서 실제 사용되지만 export 는 이번 step 에서 함께 — test 가 두 상수 모두 요구하므로.)

이어서 `getDistinctDestinations` 를 unstable_cache 로 래핑:
```ts
// before
export async function getDistinctDestinations(): Promise<
  { code: string; label: string; count: number }[]
> {
  const rows = await db.product.groupBy({
    ...
  });
  return rows.filter(...).map(...);
}

// after
export const getDistinctDestinations = unstable_cache(
  async (): Promise<{ code: string; label: string; count: number }[]> => {
    const rows = await db.product.groupBy({
      by: ["destinationCode", "destination"],
      where: { status: "PUBLISHED" },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    });

    return rows
      .filter((item) => item.destinationCode !== null)
      .map((item) => ({
        code: item.destinationCode as string,
        label: item.destination,
        count: item._count.id,
      }));
  },
  ["product-distinct-destinations"],
  { revalidate: 3600, tags: [TAG_DESTINATIONS_LIST] }
);
```

- [x] **Step 4: index.ts 재export 추가**

Edit `src/entities/product/index.ts`:
```ts
// queries.ts re-export 블록에 추가
  tagProductDetail,
  TAG_PRODUCTS_LIST,
  TAG_DESTINATIONS_LIST,
  PAGE_SIZE,
```

- [x] **Step 5: test 재실행 — PASS 확인**

Run:
```bash
npx vitest run src/entities/product/api/__tests__/cache-tags.test.ts
```
Expected: 3 tests PASS.

- [x] **Step 6: typecheck**

Run:
```bash
npm run typecheck
```
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/entities/product/api/queries.ts src/entities/product/index.ts src/entities/product/api/__tests__/cache-tags.test.ts
git commit -m "feat(product): getDistinctDestinations unstable_cache(1h, TAG_DESTINATIONS_LIST) + TAG_PRODUCTS_LIST export"
```

---

### Task 3: `getProductList` unstable_cache + TAG_PRODUCTS_LIST

**의도:** `/products` 매 요청마다 정렬·필터·페이지에 따라 DB hit. 같은 필터 조합 반복 요청을 5min TTL 로 압축. PUBLISHED 상태 변동 + 신규 상품 등록 시 미래 admin CMS 가 `revalidateTag(TAG_PRODUCTS_LIST)` 로 일괄 무효화.

**Files:**
- Modify: `src/entities/product/api/queries.ts` (`getProductList` wrap)

**제약 분석:**
- `getProductList` 는 내부에서 `new Date()` 로 `today` 를 계산한다. unstable_cache 는 인자만 cache key 로 사용 → 동일 params 반복 호출 시 첫 today 가 재사용된다.
- 5min TTL 이라 자정 경계에서 최대 5min stale (예: 23:58 호출 결과가 00:03 까지 재사용) — 허용 범위.
- `pageSize` 가 `undefined` vs `12` 로 cache key 분기되지 않도록 호출부에서 항상 명시 (현재 `src/app/(site)/products/page.tsx:42` 가 `pageSize: PAGE_SIZE` 명시 — 안전).

- [x] **Step 1: 호출부 안정성 사전 확인**

Run:
```bash
grep -rn "getProductList(" src/ 2>/dev/null
```
Expected: `src/app/(site)/products/page.tsx` 가 유일 호출처. `pageSize: PAGE_SIZE` 명시 확인.

- [x] **Step 2: `getProductList` wrap (구현 + 검증 같은 step 으로 진행)**

`getProductList` 는 unit test 가 별도로 존재하지 않고, unstable_cache wrap 은 mock 으로 우회되는 패턴 → 단위 테스트는 추가하지 않고 빌드/런타임 검증으로 대체(checkout/booking-cancel 의 기존 테스트 패턴 ([ADR-0017])과 동일 정책).

Edit `src/entities/product/api/queries.ts`. `getProductList` 시그니처 유지하되 내부 구현을 unstable_cache 래핑된 inner 함수로 위임:

```ts
// before
export async function getProductList(
  params: ListParams
): Promise<{ items: ProductCard[]; total: number }> {
  const { filter, sort = "latest", page = 1, pageSize = PAGE_SIZE } = params;
  const destinationCode = filter?.destinationCode;
  // ... (전체 본문)
}

// after — getProductByIdProductsByIds 패턴 (closure로 args 분리)
export async function getProductList(
  params: ListParams
): Promise<{ items: ProductCard[]; total: number }> {
  // unstable_cache key 안정화: 정규화된 primitive args 만 전달.
  const sort = params.sort ?? "latest";
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? PAGE_SIZE;
  const destinationCode = params.filter?.destinationCode ?? null;

  return unstable_cache(
    async (
      sortKey: NonNullable<ListParams["sort"]>,
      pageKey: number,
      pageSizeKey: number,
      destinationKey: string | null
    ): Promise<{ items: ProductCard[]; total: number }> => {
      return getProductListInner({
        sort: sortKey,
        page: pageKey,
        pageSize: pageSizeKey,
        filter: destinationKey ? { destinationCode: destinationKey } : undefined,
      });
    },
    ["product-list"],
    { revalidate: 300, tags: [TAG_PRODUCTS_LIST] }
  )(sort, page, pageSize, destinationCode);
}

// 기존 본문은 그대로 inner 함수로 이동 (signature 동일)
async function getProductListInner(
  params: ListParams
): Promise<{ items: ProductCard[]; total: number }> {
  const { filter, sort = "latest", page = 1, pageSize = PAGE_SIZE } = params;
  const destinationCode = filter?.destinationCode;
  // ... (기존 본문 전체 — `today` 계산부터 raw SQL · ordered map · return 까지)
  // ...

  const skip = (page - 1) * pageSize;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const departuresInclude = {
    where: {
      departureDate: { gte: today },
      status: { not: "CANCELED" as const },
    },
    orderBy: { priceAdult: "asc" as const },
    take: 1,
    select: { priceAdult: true },
  };

  function toProductCard(
    product: Awaited<
      ReturnType<typeof db.product.findMany<{ include: { tags: { select: { tag: true } }; departures: { select: { priceAdult: true } } } }>>
    >[number]
  ): ProductCard {
    return {
      id: product.id,
      title: product.title,
      destination: product.destination,
      durationNights: product.durationNights,
      durationDays: product.durationDays,
      heroImageUrl: product.heroImageUrl,
      basePriceAdult: product.basePriceAdult,
      aiSummary: product.aiSummary,
      tags: product.tags,
      lowestPrice: pickLowestPrice(product.departures) ?? undefined,
    };
  }

  if (sort === "latest") {
    const where = {
      status: "PUBLISHED" as const,
      ...(destinationCode && { destinationCode }),
    };

    const [rawProducts, total] = await Promise.all([
      db.product.findMany({
        where,
        include: {
          tags: { select: { tag: true } },
          departures: departuresInclude,
        },
        orderBy: { createdAt: "desc" },
        take: pageSize,
        skip,
      }),
      db.product.count({ where }),
    ]);

    return { items: rawProducts.map(toProductCard), total };
  }

  // "price_asc" | "departure_soon" — raw SQL for proper ordering
  const sortColumn =
    sort === "price_asc"
      ? Prisma.sql`MIN(d."priceAdult")`
      : Prisma.sql`MIN(d."departureDate")`;

  const sortedIds = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT p.id
    FROM "Product" p
    LEFT JOIN "Departure" d ON d."productId" = p.id
      AND d."departureDate" >= ${today}
      AND d.status <> 'CANCELED'
    WHERE p.status = 'PUBLISHED'
      ${destinationCode ? Prisma.sql`AND p."destinationCode" = ${destinationCode}` : Prisma.sql``}
    GROUP BY p.id
    ORDER BY ${sortColumn} NULLS LAST
    LIMIT ${pageSize} OFFSET ${skip}
  `);

  const ids = sortedIds.map((r) => r.id);

  const [products, total] = await Promise.all([
    db.product.findMany({
      where: { id: { in: ids } },
      include: {
        tags: { select: { tag: true } },
        departures: departuresInclude,
      },
    }),
    db.product.count({
      where: {
        status: "PUBLISHED",
        ...(destinationCode && { destinationCode }),
      },
    }),
  ]);

  const ordered = ids
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => p != null);

  return { items: ordered.map(toProductCard), total };
}
```

(주의: `getProductListInner` 의 본문은 기존 함수 본문을 **그대로** 옮긴다 — `today` 변수, raw SQL, ordered map, 반환 형식 100% 보존. 위 패치에서 생략 없이 모두 명시.)

- [x] **Step 3: typecheck + 기존 e2e/integration 영향 확인**

Run:
```bash
npm run typecheck
```
Expected: PASS.

Run (기존 product 관련 테스트):
```bash
npx vitest run src/entities/product/api/__tests__/
```
Expected: 기존 `mapping.test.ts`, `parseListParams.test.ts`, `searchByVector.test.ts`, 신규 `cache-tags.test.ts` 모두 PASS. `queries.ts` 의 변경은 시그니처 보존이므로 호출부 회귀 없음.

- [x] **Step 4: 호출부 런타임 sanity 검증**

```bash
npm run dev &  # background
sleep 5
curl -s "http://localhost:3000/products?sort=latest&page=1" -o /dev/null -w "%{http_code}\n"
curl -s "http://localhost:3000/products?sort=price_asc&page=1" -o /dev/null -w "%{http_code}\n"
curl -s "http://localhost:3000/products?sort=departure_soon&page=2" -o /dev/null -w "%{http_code}\n"
```
Expected: 모두 200. 3번 호출 후 dev server 로그에서 동일 params 재요청 시 Prisma 쿼리가 줄어드는지 (또는 unstable_cache HIT 로그가 보이는지) 확인.

- [x] **Step 5: Commit**

```bash
git add src/entities/product/api/queries.ts
git commit -m "feat(product): getProductList unstable_cache(5min, TAG_PRODUCTS_LIST) — /products DB hit 압축"
```

---

### Task 4: `getProductsByIds` unstable_cache + per-id tag

**의도:** `/compare` 페이지와 `/api/compare/products` 양쪽이 `getProductsByIds` 를 호출. ids 가 동적이지만, 동일 ids 조합 재방문(브라우저 뒤로가기·재진입)과 SWR 캐시 미스 시 underlying DB hit 을 압축. per-id 태그(`tagProductDetail(id)`) 를 모두 부여 → admin product CMS 가 `revalidateTag(tagProductDetail("X"))` 호출 시 X 가 포함된 모든 비교 캐시 엔트리가 자동 무효화 (per-id 태그 fan-out).

**Files:**
- Modify: `src/entities/product/api/queries.ts` (`getProductsByIds` wrap)

**제약 분석:**
- ids 배열은 cache key 의 일부 → 동일 array(같은 순서·길이) 만 cache hit.
- `parseCompareIds` 가 호출부에서 cuid 검증·중복 제거·MAX_COMPARE clamp 적용 → cache key 폭발 위험 낮음 (실용 키 공간: 등록 상품 수의 3-permutation, MAX_COMPARE=3 가정).
- per-id 태그를 모두 부여하므로, 어떤 단일 product 가 admin 에 의해 update 되면 그 id 를 포함하는 **모든** 비교 캐시 엔트리가 무효화 — fan-out 정합성.

- [x] **Step 1: `getProductsByIds` wrap**

Edit `src/entities/product/api/queries.ts`:
```ts
// before
export async function getProductsByIds(
  ids: string[]
): Promise<ProductDetail[]> {
  if (ids.length === 0) return [];

  const products = await db.product.findMany({
    where: { id: { in: ids }, status: "PUBLISHED" },
    include: {
      tags: true,
      inclusions: true,
      itineraryDays: { include: { stops: true } },
    },
  });

  return ids
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => p != null);
}

// after
export async function getProductsByIds(
  ids: string[]
): Promise<ProductDetail[]> {
  if (ids.length === 0) return [];

  // unstable_cache: 1h TTL + per-id 태그 fan-out.
  // 비교 페이지 ids 가 [A,B,C] 이면 tags=[product:A, product:B, product:C].
  // 어떤 id 가 admin 에서 update 되어 revalidateTag(tagProductDetail(id)) 가
  // 호출되면, 그 id 를 포함하는 모든 비교 캐시 엔트리가 한 번에 무효화된다.
  // cache key 폭발 방지: parseCompareIds 가 MAX_COMPARE=3 으로 clamp 함.
  return unstable_cache(
    async (idsKey: string[]): Promise<ProductDetail[]> => {
      const products = await db.product.findMany({
        where: { id: { in: idsKey }, status: "PUBLISHED" },
        include: {
          tags: true,
          inclusions: true,
          itineraryDays: { include: { stops: true } },
        },
      });

      return idsKey
        .map((id) => products.find((p) => p.id === id))
        .filter((p): p is NonNullable<typeof p> => p != null);
    },
    ["products-by-ids"],
    { revalidate: 3600, tags: ids.map(tagProductDetail) }
  )(ids);
}
```

- [x] **Step 2: typecheck**

Run:
```bash
npm run typecheck
```
Expected: PASS.

- [x] **Step 3: 호출부 런타임 sanity 검증 — /api/compare/products + /compare**

```bash
# dev server 가 Task 3 step 4 에서 띄워져 있다고 가정. 아니면 새로 띄울 것.
# 임의의 두 product id 가 필요 — 시드된 10개 중 첫 둘로:
PRODUCT_IDS=$(npx tsx -e "
import { db } from './src/shared/lib/db';
const ids = await db.product.findMany({ where: { status: 'PUBLISHED' }, take: 2, select: { id: true } });
console.log(ids.map(r => r.id).join(','));
await db.\$disconnect();
" 2>/dev/null)
echo "Test ids: $PRODUCT_IDS"

curl -s "http://localhost:3000/api/compare/products?ids=$PRODUCT_IDS" | head -c 300
echo
curl -s "http://localhost:3000/compare?compareIds=$PRODUCT_IDS" -o /dev/null -w "%{http_code}\n"
```
Expected: 첫 응답에 `products: [...]` 2건. 두 번째 호출은 cache hit (dev 로그에서 Prisma 쿼리 부재 확인).

- [x] **Step 4: api/compare/products 주석 정합성 확인**

`src/app/api/compare/products/route.ts:16` 의 주석:
> `getProductsByIds` 가 unstable_cache(1h TTL + per-id 태그) 로 메모이즈되어 있어 underlying DB hit 은 압축됨.

Read 후 이 주석이 **이제 사실** 인지 확인. 사실이면 수정 불필요. 거짓 부분이 있으면 한 줄 보강.

```bash
sed -n '14,22p' src/app/api/compare/products/route.ts
```

- [x] **Step 5: Commit**

```bash
git add src/entities/product/api/queries.ts
git commit -m "feat(product): getProductsByIds unstable_cache(1h, per-id tags) — /compare DB hit 압축 + fan-out 무효화"
```

---

### Task 5: 무효화 컨트랙트 박제 — `entities/product/index.ts` JSDoc

**의도:** 미래 admin product CMS 작업자가 "어떤 mutation 에서 어떤 태그를 bust 해야 하는가" 를 즉시 알 수 있도록 entities 공개 API 옆에 컨트랙트를 명시. 코드는 변경 안 되고 JSDoc 만 추가 — 검색 가능한 단일 출처(SSOT).

**Files:**
- Modify: `src/entities/product/index.ts` (re-export 블록 상단에 JSDoc 주석 추가)

- [x] **Step 1: JSDoc 박제**

Edit `src/entities/product/index.ts`. queries.ts re-export 블록을 다음으로 교체:

```ts
/**
 * Cache 무효화 컨트랙트 — 미래 admin product CMS / CRUD 작업 시 반드시 호출.
 *
 * | Tag                       | 무효화 발신 시점                                  | TTL  |
 * | ------------------------- | ------------------------------------------------ | ---- |
 * | `TAG_PRODUCTS_FEATURED`   | 추천 상품 변경(admin pick)                        | 5min |
 * | `TAG_PRODUCTS_LIST`       | 신규 상품 등록 / status 변경 / 정렬 영향 필드 변경 | 5min |
 * | `TAG_DESTINATIONS_LIST`   | 신규 destinationCode 도입 / 상품 status 변경       | 1h   |
 * | `tagProductDetail(id)`    | 단건 상품 update (title/desc/hero/price 등)        | 1h   |
 * | `tagDeparturesByProduct(id)` | 좌석/일정 변경 (booking 확정/취소가 자동 wiring)  | 1h   |
 *
 * `tagProductDetail` 은 `getProductById` + `getProductsByIds` 양쪽에 부여되므로
 * 한 번 bust 으로 PDP + 비교 페이지 캐시가 동시에 무효화된다.
 *
 * 좌석 태그는 entities/departure 의 `tagDeparturesByProduct` 가 SSOT 이며,
 * 이미 checkout / booking-cancel / admin-booking-cancel 이 wiring 완료.
 */
export {
  getProductList,
  getProductById,
  getProductsByIds,
  getFeaturedProducts,
  getDistinctDestinations,
  getAllPublishedProductIds,
  tagProductDetail,
  TAG_PRODUCTS_LIST,
  TAG_DESTINATIONS_LIST,
  PAGE_SIZE,
} from "./api/queries";
```

- [x] **Step 2: typecheck + lint**

Run:
```bash
npm run typecheck
npm run lint
```
Expected: PASS / no warnings.

- [x] **Step 3: Commit**

```bash
git add src/entities/product/index.ts
git commit -m "docs(product): cache 무효화 컨트랙트 JSDoc 박제 (SSOT)"
```

---

### Task 6: 최종 검증 — 빌드 출력 + revalidation flow

**의도:** 본 plan 이 정합성 제약(체크아웃·예약·리뷰·위시리스트 시 즉시 갱신)을 깨지 않았음을 증거로 확인.

- [ ] **Step 1: 전체 testsuite + typecheck + lint**

Run:
```bash
npm run typecheck && npm run lint && npm run test
```
Expected: 모두 PASS. 특히 `src/features/checkout/server/__tests__/actions.test.ts`, `src/features/booking-cancel/server/__tests__/actions.test.ts`, `src/features/admin-booking-cancel/server/__tests__/actions.test.ts` 의 `revalidateTag`/`revalidatePath` 호출 검증 테스트가 그대로 PASS 여야 한다 (변경 없음).

- [ ] **Step 2: `next build` 출력 ●○ 라벨 확인**

Run:
```bash
npm run build 2>&1 | tail -80
```
Expected (변하면 안 되는 라벨):
- `● /products/[id]` (SSG with ISR)
- `○ /` (Static, 5min revalidate) — 또는 ƒ. ADR-0015 의 정책 일치 여부 재확인.
- `ƒ /products` (Dynamic — searchParams 의존, 변경 없음)
- `ƒ /checkout/...` `ƒ /bookings/...` `ƒ /admin/...` (모두 Dynamic 유지)

변경된 페이지/엔드포인트 라벨이 의도하지 않게 흔들리지 않았는지 확인.

- [ ] **Step 3: 무효화 flow end-to-end 수동 검증 (mock 결제 + cancel)**

자동화 가능한 부분(테스트)은 step 1 에서 완료. 다음은 실제 mutation → 캐시 무효화 chain 확인 — dev server + mock toss server 띄운 상태에서:

```bash
# (1) dev + mock toss
npm run mock:toss &
npm run dev &
sleep 5

# (2) /products 첫 진입 (캐시 채움)
curl -s "http://localhost:3000/products" -o /dev/null -w "first  HTTP %{http_code}, time=%{time_total}s\n"

# (3) 동일 URL 재진입 (캐시 HIT — time 단축 기대)
curl -s "http://localhost:3000/products" -o /dev/null -w "second HTTP %{http_code}, time=%{time_total}s\n"

# (4) PDP 첫 진입 (1h ISR — `●` build label 일치)
PRODUCT_ID=$(npx tsx -e "
import { db } from './src/shared/lib/db';
const p = await db.product.findFirst({ where: { status: 'PUBLISHED' }, select: { id: true } });
console.log(p?.id);
await db.\$disconnect();
" 2>/dev/null)
curl -s "http://localhost:3000/products/$PRODUCT_ID" -o /dev/null -w "PDP    HTTP %{http_code}\n"
```

Expected:
- `first` 와 `second` 의 `time_total` 차이로 cache HIT 효과 가시화 (지표상 fail 아님 — 빌드 정합성만 확인).
- PDP 200.

- [ ] **Step 4: 보고서 (CLAUDE.md §7.1 양식)**

작업 완료 보고시 다음 3섹션으로:
- 🏗️ **Core Architecture:** entities/product 의 3개 데이터 함수(`getProductList`/`getDistinctDestinations`/`getProductsByIds`)에 `unstable_cache` 적용 — `/products` 와 `/compare` 의 underlying DB hit 압축. 페이지 레벨 force-dynamic 은 모두 의도된 안정성 결정으로 유지.
- ♻️ **Boilerplate:** dead `tagProductDepartures` export 제거, JSDoc 무효화 컨트랙트 박제, 태그 상수 단위 테스트 추가.
- 🧠 **Concept Insight:** unstable_cache 는 "함수 호출 결과를 함수 인자 + key array 를 키로 한 in-memory + on-disk 캐시" — 마치 도서관 사서가 "이 책 어디 있어요?" 질문을 받을 때 첫 번째 손님 답을 메모해두고, 그 후 5분 동안 같은 질문을 받으면 책장까지 가지 않고 메모에서 즉답하는 것. `revalidateTag` 는 "이 책장 정보 바뀌었으니 모든 메모 폐기" 명령. 메모 폐기와 별개로 5분이 지나면 메모는 자동 소각(TTL) — 어느 쪽이든 stale 보장 시간 상한이 존재.

- [ ] **Step 5: ADR 발행 제안**

본 작업은 캐시 정책에 대한 의식적 선택을 박제한 결정(force-dynamic 잔존 사유 + per-id tag fan-out 채택) — `docs/superpowers/adr/0020-cache-tag-contracts.md` 로 박제할 가치 있음. **사용자에게 ADR 발행 여부를 묻고**, 동의 시 별도 commit (`docs(adr): 0020 ...`) 으로 추가.

---

## Self-Review (작성자 점검 완료)

작성자가 plan 저장 직전 다음 6개 기준에 대해 점검을 수행했고 모두 통과 확인. (체크박스 형태로 두지 않는 이유: CLAUDE.md §4.2 — plan 파일 내 `- [x]` 는 실제 Task 완료 시에만 허용. 작성자 메타-점검은 산문으로 박제.)

1. 모든 페이지/route 의 force-dynamic 이 audit 표에 포함되었는가? → ✅ 16개 페이지 + 10개 API route 표 명시.
2. `unstable_cache` wrap 이 누락된 entities 함수가 모두 식별되었는가? → ✅ 3개 (getProductList, getDistinctDestinations, getProductsByIds).
3. 각 Task 가 정확한 파일 경로 + 완전한 코드 블록을 가지는가? → ✅ 모든 step 에 절대 경로 + 완전한 before/after 코드.
4. 모든 Task 가 TDD cycle 또는 명시적 검증 step 으로 마무리되는가? → ✅ Task 2 는 TDD, Task 1/3/4 는 typecheck + 런타임 sanity, Task 5 는 typecheck + lint, Task 6 은 전 시스템 검증.
5. 무효화 컨트랙트가 미래 admin CMS 작업자가 이해 가능한가? → ✅ Task 5 의 JSDoc 표 + Audit Snapshot 의 "무효화 컨트랙트 현황" 표.
6. "정합성 제약(Stale data 방지)" 검증이 plan 끝에 포함되었는가? → ✅ Task 6 step 1 (mutation action 테스트 회귀) + step 3 (E2E 수동 검증).

---

## Out of Scope

- **Admin product CMS** — Task 5 의 JSDoc 박제로 hooking point 만 정의. 실제 mutation 발신처 wiring 은 별도 plan.
- **PPR (Partial Prerendering) opt-in** — Next 15 `experimental` 상태로 ADR-0017/0018 에서 보류 결정 유지. PPR stable 승격 시 시리즈 일괄 재논의 ([ADR-0018]).
- **Edge Runtime 전환** — Prisma 호환성 미해결, 본 plan 영향권 밖.
- **CDN 레이어 캐시 정책 튜닝** (Vercel Cache-Control 헤더 / cache key normalization) — 데이터 레이어 안정화 이후 별도 plan.
