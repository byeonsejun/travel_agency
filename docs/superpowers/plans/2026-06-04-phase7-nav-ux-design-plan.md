# Phase 7 — 네비게이션 UX & 렌더링 성능 최적화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 네비게이션 클릭 후 무피드백 지연을 제거 — 라우트 스켈레톤(`loading.tsx`)·인터랙션 펜딩(`useTransition`)·전역 프로그레스 바(`useLinkStatus`)·PDP Suspense 스트리밍을 도입한다.

**Architecture:** `shared/ui` 에 도메인 무지 primitive(`Skeleton`/`RouteProgress`/`ProgressLink`), 위젯 레이어에 도메인 셰입 스켈레톤. 라우트별 `loading.tsx` 는 조합만. `router.push` 는 `useTransition` 으로, `<Link>` 펜딩은 네이티브 `useLinkStatus` 로 처리. PDP 리뷰는 비동기 자식 + `<Suspense>` 분리.

**Tech Stack:** Next.js 15.5.18 (App Router, `useLinkStatus`), React 19 (`useTransition`/Suspense), Tailwind, Vitest 2 + happy-dom.

> 설계 근거: `docs/superpowers/specs/2026-06-04-phase7-nav-ux-design.md`
> FSD 경계: `shared/ui/*` 는 deep import 관례(`@/shared/ui/EmptyState` 선례). `product-card-list`/`product-detail` 은 배럴 없음 → deep import. `booking-list` 는 배럴 존재 → 배럴 export 추가.

---

## File Structure

| 파일 | 동작 | 책임 |
|---|---|---|
| `src/shared/ui/Skeleton.tsx` | 생성 | 베이스 펄스 박스 primitive |
| `src/widgets/product-card-list/ui/ProductCardSkeleton.tsx` | 생성 | ProductCard 셰입 스켈레톤 |
| `src/widgets/booking-list/ui/BookingRowSkeleton.tsx` | 생성 | 예약 행 스켈레톤 |
| `src/widgets/booking-list/index.ts` | 수정 | `BookingRowSkeleton` export 추가 |
| `src/app/(site)/products/loading.tsx` | 생성 | 상품 목록 스켈레톤 |
| `src/app/(site)/search/loading.tsx` | 수정 | `ProductCardSkeleton` 재사용(dedupe) |
| `src/app/(site)/mypage/loading.tsx` | 생성 | 마이페이지 스켈레톤 |
| `src/app/(site)/products/[id]/loading.tsx` | 생성 | PDP 스켈레톤 |
| `src/widgets/product-detail/ui/ProductReviewsSection.tsx` | 생성 | 리뷰 3쿼리 async RSC |
| `src/widgets/product-detail/ui/ReviewsSkeleton.tsx` | 생성 | 리뷰 Suspense fallback |
| `src/app/(site)/products/[id]/page.tsx` | 수정 | 리뷰를 Suspense 로 분리, page 는 본문만 await |
| `src/widgets/product-card-list/ui/SortSelect.tsx` | 수정 | `useTransition` 펜딩 처리 |
| `src/features/search/ui/SearchBox.tsx` | 수정 | `useTransition` 펜딩 처리 |
| `src/shared/ui/RouteProgress.tsx` | 생성 | `useLinkStatus` 상단 바 |
| `src/shared/ui/ProgressLink.tsx` | 생성 | `<Link>` + `RouteProgress` 래퍼 |
| `src/widgets/product-card-list/ui/ProductFilterBar.tsx` | 수정 | 탭 `<Link>` → `ProgressLink` |
| `src/widgets/product-card-list/ui/Pagination.tsx` | 수정 | `<Link>` → `ProgressLink` |

---

## Task 1: shared/ui Skeleton primitive

**Files:**
- Create: `src/shared/ui/Skeleton.tsx`
- Test: `src/shared/ui/__tests__/Skeleton.test.tsx`

- [x] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { Skeleton } from "../Skeleton";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("<Skeleton />", () => {
  it("애니메이션 펄스 클래스 + 전달된 className 을 함께 렌더한다", () => {
    const container = document.createElement("div");
    root = createRoot(container);
    act(() => {
      root!.render(<Skeleton className="h-4 w-1/2" />);
    });
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("animate-pulse");
    expect(el.className).toContain("h-4");
    expect(el.getAttribute("aria-hidden")).toBe("true");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/ui/__tests__/Skeleton.test.tsx`
Expected: FAIL — `Cannot find module '../Skeleton'`

- [x] **Step 3: Write minimal implementation**

```tsx
import type { ComponentPropsWithoutRef } from "react";

type SkeletonProps = ComponentPropsWithoutRef<"div">;

/** 도메인 무지 펄스 박스. className 으로 크기/모양 지정. CSS 애니메이션이라 RSC 안전(no 'use client'). */
export function Skeleton({ className = "", ...rest }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded bg-gray-200 ${className}`}
      {...rest}
    />
  );
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/ui/__tests__/Skeleton.test.tsx`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/shared/ui/Skeleton.tsx src/shared/ui/__tests__/Skeleton.test.tsx
git commit -m "feat(shared-ui): domain-agnostic Skeleton pulse primitive"
```

---

## Task 2: 도메인 셰입 스켈레톤 (ProductCard / BookingRow)

**Files:**
- Create: `src/widgets/product-card-list/ui/ProductCardSkeleton.tsx`
- Create: `src/widgets/booking-list/ui/BookingRowSkeleton.tsx`
- Modify: `src/widgets/booking-list/index.ts`

- [x] **Step 1: Create ProductCardSkeleton**

`src/widgets/product-card-list/ui/ProductCardSkeleton.tsx`:

```tsx
import { Skeleton } from "@/shared/ui/Skeleton";

/** ProductCard 레이아웃(이미지+제목+가격+태그) 모방 스켈레톤. */
export function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200">
      <Skeleton className="h-48 w-full rounded-none" />
      <div className="space-y-3 p-4">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-12 rounded-full" />
        </div>
      </div>
    </div>
  );
}
```

- [x] **Step 2: Create BookingRowSkeleton**

`src/widgets/booking-list/ui/BookingRowSkeleton.tsx`:

```tsx
import { Skeleton } from "@/shared/ui/Skeleton";

/** 예약 내역 리스트의 한 행 모방 스켈레톤. */
export function BookingRowSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-gray-200 p-4">
      <Skeleton className="h-16 w-16 shrink-0 rounded-md" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      <Skeleton className="h-8 w-20 rounded" />
    </div>
  );
}
```

- [x] **Step 3: Add barrel export**

`src/widgets/booking-list/index.ts` — 기존 export 아래에 한 줄 추가:

```ts
export { BookingRowSkeleton } from "./ui/BookingRowSkeleton";
```

- [x] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors)

- [x] **Step 5: Commit**

```bash
git add src/widgets/product-card-list/ui/ProductCardSkeleton.tsx src/widgets/booking-list/ui/BookingRowSkeleton.tsx src/widgets/booking-list/index.ts
git commit -m "feat(widgets): ProductCard/BookingRow skeleton shapes"
```

---

## Task 3: /products + /search loading.tsx

**Files:**
- Create: `src/app/(site)/products/loading.tsx`
- Modify: `src/app/(site)/search/loading.tsx`

- [x] **Step 1: Create products/loading.tsx**

`src/app/(site)/products/loading.tsx`:

```tsx
import { Skeleton } from "@/shared/ui/Skeleton";
import { ProductCardSkeleton } from "@/widgets/product-card-list/ui/ProductCardSkeleton";

export default function ProductsLoading() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      {/* 필터바 영역 */}
      <div className="mb-6 space-y-4 border-b border-gray-200 pb-6">
        <div className="flex gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-20" />
          ))}
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-10 w-48" />
        </div>
      </div>
      {/* 카드 그리드 */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
```

- [x] **Step 2: Refactor search/loading.tsx to reuse ProductCardSkeleton**

`src/app/(site)/search/loading.tsx` 전체 교체:

```tsx
import { Skeleton } from "@/shared/ui/Skeleton";
import { ProductCardSkeleton } from "@/widgets/product-card-list/ui/ProductCardSkeleton";

export default function SearchLoading() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <section className="mb-8">
        <Skeleton className="mb-6 h-9 w-32" />
        <div className="flex gap-2">
          <Skeleton className="h-12 flex-1 rounded-lg" />
          <Skeleton className="h-12 w-20 rounded-lg" />
        </div>
      </section>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
```

- [x] **Step 3: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [x] **Step 4: Commit**

```bash
git add "src/app/(site)/products/loading.tsx" "src/app/(site)/search/loading.tsx"
git commit -m "feat(products,search): route loading skeletons (dedupe via ProductCardSkeleton)"
```

---

## Task 4: /mypage loading.tsx

**Files:**
- Create: `src/app/(site)/mypage/loading.tsx`

- [x] **Step 1: Create mypage/loading.tsx**

`src/app/(site)/mypage/loading.tsx`:

```tsx
import { Skeleton } from "@/shared/ui/Skeleton";
import { BookingRowSkeleton } from "@/widgets/booking-list";

export default function MyPageLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-10 px-6 py-12">
      {/* 프로필 카드 */}
      <section className="space-y-4 rounded-lg border border-gray-200 p-6">
        <Skeleton className="h-6 w-40" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </section>
      {/* 예약 내역 */}
      <section className="space-y-4">
        <Skeleton className="h-6 w-32" />
        {Array.from({ length: 3 }).map((_, i) => (
          <BookingRowSkeleton key={i} />
        ))}
      </section>
      {/* 위시리스트 */}
      <section className="space-y-4">
        <Skeleton className="h-6 w-32" />
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-lg" />
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [x] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [x] **Step 3: Commit**

```bash
git add "src/app/(site)/mypage/loading.tsx"
git commit -m "feat(mypage): route loading skeleton"
```

---

## Task 5: /products/[id] loading.tsx

**Files:**
- Create: `src/app/(site)/products/[id]/loading.tsx`

- [x] **Step 1: Create PDP loading.tsx**

`src/app/(site)/products/[id]/loading.tsx`:

```tsx
import { Skeleton } from "@/shared/ui/Skeleton";

export default function ProductDetailLoading() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      {/* 히어로 이미지 */}
      <Skeleton className="mb-6 h-80 w-full rounded-xl" />
      {/* 제목 + 가격 */}
      <div className="mb-8 space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-5 w-1/4" />
        <Skeleton className="h-10 w-40" />
      </div>
      {/* 본문 단락 */}
      <div className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}
```

- [x] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [x] **Step 3: Commit**

```bash
git add "src/app/(site)/products/[id]/loading.tsx"
git commit -m "feat(pdp): route loading skeleton (ISR on-demand miss safety net)"
```

---

## Task 6: PDP Suspense 스트리밍 — 리뷰 분리

**Files:**
- Create: `src/widgets/product-detail/ui/ReviewsSkeleton.tsx`
- Create: `src/widgets/product-detail/ui/ProductReviewsSection.tsx`
- Modify: `src/app/(site)/products/[id]/page.tsx`

- [x] **Step 1: Create ReviewsSkeleton**

`src/widgets/product-detail/ui/ReviewsSkeleton.tsx`:

```tsx
import { Skeleton } from "@/shared/ui/Skeleton";

/** PDP 리뷰 영역 Suspense fallback. */
export function ReviewsSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="h-24 w-full rounded-lg" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-lg" />
      ))}
    </div>
  );
}
```

- [x] **Step 2: Create ProductReviewsSection (async RSC, 리뷰 3쿼리 이동)**

`src/widgets/product-detail/ui/ProductReviewsSection.tsx`:

```tsx
import {
  getProductReviewStats,
  listReviewsByProduct,
  getReviewRatingDistribution,
} from "@/entities/review";
import { ReviewStatsBar, RatingDistribution } from "@/widgets/review-list";
import { ReviewFeed } from "@/features/review-feed";

type ProductReviewsSectionProps = {
  productId: string;
};

/**
 * 리뷰 통계/분포/피드를 자체적으로 fetch 하는 async 서버 컴포넌트.
 * page.tsx 의 본문(product/departures)과 분리되어 <Suspense> 로 스트리밍된다.
 */
export async function ProductReviewsSection({
  productId,
}: ProductReviewsSectionProps) {
  const [reviewStats, reviewPage, ratingDist] = await Promise.all([
    getProductReviewStats(productId),
    listReviewsByProduct(productId, { limit: 10 }),
    getReviewRatingDistribution(productId),
  ]);

  return (
    <div className="space-y-4">
      <ReviewStatsBar avg={reviewStats.avg} count={reviewStats.count} />
      <RatingDistribution distribution={ratingDist} total={reviewStats.count} />
      <ReviewFeed
        productId={productId}
        initialItems={reviewPage.items}
        initialCursor={reviewPage.nextCursor}
      />
    </div>
  );
}
```

- [x] **Step 3: Rewrite page.tsx — 본문만 await, 리뷰는 Suspense**

`src/app/(site)/products/[id]/page.tsx` 의 import 블록에서 리뷰 엔티티 import 3개와 `ReviewStatsBar`/`RatingDistribution`/`ReviewFeed` import 를 제거하고, 대신 추가:

```tsx
import { Suspense } from "react";
import { ProductReviewsSection } from "@/widgets/product-detail/ui/ProductReviewsSection";
import { ReviewsSkeleton } from "@/widgets/product-detail/ui/ReviewsSkeleton";
```

유지되는 import: `notFound`, `getProductById`, `getAllPublishedProductIds`, `getDeparturesByProduct`, `ProductDetail`, `CompareToggleButton`, `FloatingCompareCart`.

`ProductDetailPage` 본문을 아래로 교체:

```tsx
export default async function ProductDetailPage({ params }: PageProps) {
  const { id } = await params;

  // 본문(상품·출발일)만 우선 await → 즉시 페인트. 리뷰는 아래 Suspense 로 스트리밍.
  const [product, departures] = await Promise.all([
    getProductById(id),
    getDeparturesByProduct(id),
  ]);

  if (product === null) {
    notFound();
  }

  return (
    <>
      <ProductDetail
        product={product}
        departures={departures}
        compareButton={<CompareToggleButton productId={id} size="md" />}
        reviewsSection={
          <Suspense fallback={<ReviewsSkeleton />}>
            <ProductReviewsSection productId={id} />
          </Suspense>
        }
      />
      <FloatingCompareCart />
    </>
  );
}
```

- [x] **Step 4: Verify typecheck + lint (unused import 0 확인)**

Run: `npm run typecheck && npm run lint`
Expected: PASS — 제거한 리뷰 import 가 page.tsx 에서 더 이상 참조되지 않아 unused 경고 없음.

- [x] **Step 5: Verify existing PDP tests still pass**

Run: `npx vitest run src/widgets/product-detail src/features/review-feed`
Expected: PASS (리뷰 렌더 트리만 이동, 동작 동일)

- [x] **Step 6: Commit**

```bash
git add "src/app/(site)/products/[id]/page.tsx" src/widgets/product-detail/ui/ProductReviewsSection.tsx src/widgets/product-detail/ui/ReviewsSkeleton.tsx
git commit -m "perf(pdp): stream reviews via Suspense, unblock product body paint"
```

---

## Task 7: SortSelect — useTransition 펜딩 처리

**Files:**
- Modify: `src/widgets/product-card-list/ui/SortSelect.tsx`
- Test: `src/widgets/product-card-list/ui/__tests__/SortSelect.test.tsx`

- [x] **Step 1: Write the failing test**

`src/widgets/product-card-list/ui/__tests__/SortSelect.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

const mocks = vi.hoisted(() => ({ routerPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.routerPush }),
  useSearchParams: () => new URLSearchParams("destination=JP&page=3"),
}));

import { SortSelect } from "../SortSelect";

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  mocks.routerPush.mockReset();
});

describe("<SortSelect />", () => {
  it("정렬 변경 시 page 를 버리고 destination 을 보존한 채 router.push 한다", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<SortSelect current="latest" />);
    });

    const select = container.querySelector("select")!;
    act(() => {
      select.value = "price_asc";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(mocks.routerPush).toHaveBeenCalledTimes(1);
    const url = mocks.routerPush.mock.calls[0][0] as string;
    expect(url).toContain("sort=price_asc");
    expect(url).toContain("destination=JP");
    expect(url).not.toContain("page=");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/widgets/product-card-list/ui/__tests__/SortSelect.test.tsx`
Expected: FAIL — 현재 컴포넌트는 React 이벤트 핸들러라 native `dispatchEvent` 로는 호출이 안 잡힐 수 있음. (만약 통과하면 Step 3 의 펜딩 처리만 추가하고 Step 4 로 진행.)

> NOTE: happy-dom 에서 React onChange 가 native change 이벤트에 바인딩되므로 통상 PASS 한다. 핵심은 펜딩 처리 추가 후에도 이 동작이 보존되는지다.

- [x] **Step 3: Add useTransition pending feedback**

`src/widgets/product-card-list/ui/SortSelect.tsx` 전체 교체:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type SortSelectProps = {
  current: string;
};

export function SortSelect({ current }: SortSelectProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = new URLSearchParams(params.toString());
    next.set("sort", e.target.value);
    next.delete("page");
    // 네비게이션을 transition 으로 감싸 isPending 으로 펜딩 시각 처리.
    // useTransition 은 타이머/리스너 없음 → cleanup 불필요.
    startTransition(() => {
      router.push(`/products?${next.toString()}`);
    });
  };

  return (
    <div className="relative inline-flex items-center">
      <select
        value={current}
        onChange={handleSortChange}
        disabled={isPending}
        aria-busy={isPending}
        className={`rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:border-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
          isPending ? "opacity-50" : ""
        }`}
      >
        <option value="latest">최신순</option>
        <option value="price_asc">최저가</option>
        <option value="departure_soon">출발임박</option>
      </select>
      {isPending && (
        <span
          aria-hidden="true"
          className="absolute right-2 h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"
        />
      )}
    </div>
  );
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/widgets/product-card-list/ui/__tests__/SortSelect.test.tsx`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/widgets/product-card-list/ui/SortSelect.tsx src/widgets/product-card-list/ui/__tests__/SortSelect.test.tsx
git commit -m "feat(sort-select): useTransition pending spinner on navigation"
```

---

## Task 8: SearchBox — useTransition 펜딩 처리

**Files:**
- Modify: `src/features/search/ui/SearchBox.tsx`
- Test: `src/features/search/ui/__tests__/SearchBox.test.tsx`

- [x] **Step 1: Write the failing test**

`src/features/search/ui/__tests__/SearchBox.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

const mocks = vi.hoisted(() => ({ routerPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.routerPush }),
}));

import { SearchBox } from "../SearchBox";

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  mocks.routerPush.mockReset();
});

function submit(container: HTMLElement, value: string) {
  const input = container.querySelector(
    "input[name='q']",
  ) as HTMLInputElement;
  input.value = value;
  const form = container.querySelector("form")!;
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("<SearchBox />", () => {
  it("질의를 URL 인코딩해 /search 로 push 한다", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<SearchBox />));

    submit(container, "온천 3박");

    expect(mocks.routerPush).toHaveBeenCalledTimes(1);
    expect(mocks.routerPush.mock.calls[0][0]).toBe(
      `/search?q=${encodeURIComponent("온천 3박")}`,
    );
  });

  it("빈 질의는 push 하지 않는다", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<SearchBox />));

    submit(container, "   ");

    expect(mocks.routerPush).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run test to verify it fails/passes baseline**

Run: `npx vitest run src/features/search/ui/__tests__/SearchBox.test.tsx`
Expected: PASS (현재 컴포넌트도 이 동작은 만족). 이 테스트는 Step 3 의 useTransition 추가 후에도 동작이 보존됨을 보증하는 회귀 가드.

- [x] **Step 3: Add useTransition pending feedback**

`src/features/search/ui/SearchBox.tsx` 전체 교체:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useTransition, type FormEvent } from "react";

type SearchBoxProps = {
  defaultValue?: string;
  placeholder?: string;
};

/**
 * 무상태 검색 폼. 제출 시 /search?q= 로 라우팅.
 * router.push 를 useTransition 으로 감싸 isPending 으로 버튼 스피너 표시.
 * useEffect/이벤트 리스너 없으므로 cleanup 불필요.
 */
export function SearchBox({
  defaultValue = "",
  placeholder = "어떤 여행을 원하세요? (예: 부모님 모시고 온천 3박)",
}: SearchBoxProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const q = (form.elements.namedItem("q") as HTMLInputElement).value.trim();
    if (!q) return;
    startTransition(() => {
      router.push(`/search?q=${encodeURIComponent(q)}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full gap-2">
      <input
        name="q"
        type="search"
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="flex-1 rounded-lg border border-gray-300 px-4 py-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
        maxLength={200}
        autoComplete="off"
      />
      <button
        type="submit"
        disabled={isPending}
        aria-busy={isPending}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-60"
      >
        {isPending && (
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
          />
        )}
        검색
      </button>
    </form>
  );
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/search/ui/__tests__/SearchBox.test.tsx`
Expected: PASS (both cases)

- [x] **Step 5: Commit**

```bash
git add src/features/search/ui/SearchBox.tsx src/features/search/ui/__tests__/SearchBox.test.tsx
git commit -m "feat(search-box): useTransition pending spinner on submit"
```

---

## Task 9: shared/ui RouteProgress + ProgressLink (useLinkStatus)

**Files:**
- Create: `src/shared/ui/RouteProgress.tsx`
- Create: `src/shared/ui/ProgressLink.tsx`
- Test: `src/shared/ui/__tests__/RouteProgress.test.tsx`

- [x] **Step 1: Write the failing test (mock useLinkStatus)**

`src/shared/ui/__tests__/RouteProgress.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

const mocks = vi.hoisted(() => ({ pending: false }));

vi.mock("next/link", () => ({
  useLinkStatus: () => ({ pending: mocks.pending }),
}));

import { RouteProgress } from "../RouteProgress";

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  mocks.pending = false;
});

function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<RouteProgress />));
  return container;
}

describe("<RouteProgress />", () => {
  it("pending=false 면 진행 바를 렌더하지 않는다", () => {
    mocks.pending = false;
    const c = render();
    expect(c.querySelector("[role='progressbar']")).toBeNull();
  });

  it("pending=true 면 fixed 상단 진행 바를 렌더한다", () => {
    mocks.pending = true;
    const c = render();
    const bar = c.querySelector("[role='progressbar']") as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.className).toContain("fixed");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/ui/__tests__/RouteProgress.test.tsx`
Expected: FAIL — `Cannot find module '../RouteProgress'`

- [x] **Step 3: Implement RouteProgress**

`src/shared/ui/RouteProgress.tsx`:

```tsx
"use client";

import { useLinkStatus } from "next/link";

/**
 * 부모 <Link> 의 네비게이션 펜딩(useLinkStatus)을 읽어 상단 진행 바를 표시.
 * <Link> 의 자식으로 렌더되어야 동작한다(useLinkStatus 제약).
 * 타이머/리스너 없음 → cleanup 불필요. env import 없음(client-safe).
 */
export function RouteProgress() {
  const { pending } = useLinkStatus();

  if (!pending) return null;

  return (
    <span
      role="progressbar"
      aria-label="페이지 이동 중"
      className="fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-blue-600"
    />
  );
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/ui/__tests__/RouteProgress.test.tsx`
Expected: PASS (both cases)

- [x] **Step 5: Implement ProgressLink wrapper**

`src/shared/ui/ProgressLink.tsx`:

```tsx
"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { RouteProgress } from "./RouteProgress";

type ProgressLinkProps = ComponentProps<typeof Link>;

/**
 * next/link <Link> 래퍼. children 과 함께 RouteProgress 를 렌더하여
 * 이 링크 클릭으로 시작된 네비게이션 펜딩을 상단 바로 표시한다.
 * 클릭된 링크만 pending → 단일 상단 바처럼 보인다.
 */
export function ProgressLink({ children, ...props }: ProgressLinkProps) {
  return (
    <Link {...props}>
      {children}
      <RouteProgress />
    </Link>
  );
}
```

- [x] **Step 6: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [x] **Step 7: Commit**

```bash
git add src/shared/ui/RouteProgress.tsx src/shared/ui/ProgressLink.tsx src/shared/ui/__tests__/RouteProgress.test.tsx
git commit -m "feat(shared-ui): RouteProgress + ProgressLink via native useLinkStatus"
```

---

## Task 10: ProgressLink 적용 — 필터 탭 + 페이지네이션

**Files:**
- Modify: `src/widgets/product-card-list/ui/ProductFilterBar.tsx`
- Modify: `src/widgets/product-card-list/ui/Pagination.tsx`

- [ ] **Step 1: ProductFilterBar 의 탭 Link → ProgressLink**

`src/widgets/product-card-list/ui/ProductFilterBar.tsx`:
- import 변경: `import Link from "next/link";` → `import { ProgressLink } from "@/shared/ui/ProgressLink";`
- destination 탭의 두 `<Link ...>` ... `</Link>` 를 각각 `<ProgressLink ...>` ... `</ProgressLink>` 로 교체(props 동일, href·className 그대로).
- `Suspense` / `SortSelect` import 와 사용은 그대로 유지.

- [ ] **Step 2: Pagination 의 모든 Link → ProgressLink**

`src/widgets/product-card-list/ui/Pagination.tsx`:
- import 변경: `import Link from "next/link";` → `import { ProgressLink } from "@/shared/ui/ProgressLink";`
- 파일 내 모든 `<Link ... >` ... `</Link>`(이전/다음 버튼 + 페이지 번호 링크)를 `<ProgressLink>` 로 교체. href·className·기타 props 동일.

- [ ] **Step 3: Verify typecheck + lint + full test**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: PASS — 기존 product-card-list 관련 테스트 그린 유지.

- [ ] **Step 4: Commit**

```bash
git add src/widgets/product-card-list/ui/ProductFilterBar.tsx src/widgets/product-card-list/ui/Pagination.tsx
git commit -m "feat(product-list): ProgressLink top bar on filter tabs + pagination"
```

---

## Task 11: 종합 검증 + 런타임 증거 수집

**Files:** (없음 — 검증 전용)

- [ ] **Step 1: 정적 검증 3종**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: 전부 PASS

- [ ] **Step 2: 경계 회귀 grep (FSD / client island)**

```bash
# shared client island 은 정확히 2개만 'use client'
grep -l "use client" src/shared/ui/RouteProgress.tsx src/shared/ui/ProgressLink.tsx
# loading.tsx 4개 확인
find src/app -name loading.tsx
# page/layout 에 'use client' 누수 0
grep -rn "use client" "src/app/(site)/products" "src/app/(site)/mypage" || echo "OK: no use client in pages"
# shared client island 에 env import 0
grep -rn "@/shared/lib/env" src/shared/ui/RouteProgress.tsx src/shared/ui/ProgressLink.tsx src/shared/ui/Skeleton.tsx || echo "OK: no env import"
```
Expected: RouteProgress/ProgressLink 2개 매치 / loading.tsx 4개(products·search·mypage·products/[id]) / pages 에 use client 없음 / env import 없음

- [ ] **Step 3: 런타임 증거 — dev 서버 (자동화 불가, 수동 확인)**

Run: `npm run dev` 후 브라우저 DevTools → Network throttle "Slow 4G" 로 다음 4가지 캡처:
1. `/products` 진입 → 카드 스켈레톤 노출 후 실제 카드로 교체
2. 정렬 드롭다운 변경 → 우측 스피너 + 드롭다운 dimming, 이동 후 해제
3. 필터 탭/페이지네이션 클릭 → 상단 파란 진행 바 표시
4. PDP 진입 → 상품 본문 먼저, 리뷰 영역은 `ReviewsSkeleton` 후 스트리밍

> 이 4항목은 시각/타이밍 검증이라 자동화 불가 → 사용자 수동 확인 요청(절차·기대 명시 완료). 1~2번은 typecheck/test 로 코드 경로는 보증됨.

- [ ] **Step 4: 플랜 체크박스 누락 점검**

Run: `grep -n "\- \[ \]" docs/superpowers/plans/2026-06-04-phase7-nav-ux-design-plan.md`
Expected: 완료된 Task 의 미체크 항목 0 (남아있으면 즉시 처리 후 진행)

- [ ] **Step 5: 최종 커밋 (잔여 변경 시)**

```bash
git add -A && git commit -m "chore(phase7): verification evidence + checkbox close-out"
```

---

## Self-Review 결과 (작성자 점검)

- **Spec 커버리지**: §3.1 Skeleton→T1·T2 / §3.2 loading.tsx→T3·T4·T5 / §3.3 PDP Suspense→T6 / §3.4 useTransition→T7·T8 / §3.5 useLinkStatus→T9·T10 / §6 검증→T11. 갭 없음.
- **Placeholder 스캔**: TBD/TODO 0. 모든 코드 스텝에 실제 코드 포함.
- **타입 일관성**: `Skeleton`(props `className`), `ProductCardSkeleton`/`BookingRowSkeleton`(무인자), `RouteProgress`(무인자), `ProgressLink`(`ComponentProps<typeof Link>`), `ProductReviewsSection`(`{ productId: string }`) — Task 간 시그니처 일치.
