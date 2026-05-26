# 2026-05-26 — Wishlist Island for PDP ISR (A6)

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`. 각 Task 의 모든 `- [ ]` 는 구현·검증 직후 그 자리에서 `- [x]` 로 갱신 (CLAUDE.md §4.1). **신규 plan 의 모든 체크박스는 `- [ ]` 로만 시작 (CLAUDE.md §4.2 — Pre-checking 금지).**

**Goal:** PDP(`/products/[id]`) 에서 `auth()` + `isInWishlist()` cookies 의존을 제거하여 A4 에서 깔아둔 `revalidate = 3600` ISR 정책을 **실제로 활성화**한다. 위시리스트 하트의 사용자별 상태는 client-fetch island 로 옮긴다.

**Architecture:** Option A — client-fetch island (A4 `FloatingCompareCart` 와 동일 골격). 신규 `WishlistHeartIsland` 클라이언트 컴포넌트가 mount 후 `GET /api/wishlist/check?productId=...` 를 호출해 자기 상태를 결정. PDP RSC 는 `auth()` 도 `isInWishlist()` 도 호출하지 않게 되어 cookies 의존 0 → Next 가 페이지를 정적 prerender 로 승격.

**Tech Stack:** Next.js 15 App Router (Route Handler, ISR), React 19 (`useEffect`, `useOptimistic`, `useTransition`, `AbortController`), NextAuth v5, Prisma 5, 표준 `fetch` (SWR / React Query 도입 X — 의존성·번들 보존).

---

## Context

- A4(`docs/superpowers/plans/done/2026-05-23-pdp-isr.md`) 에서 PDP 의 `searchParams.compareIds` 의존은 client-fetch island 로 청산됨. **잔여 dynamic 트리거 2개**: `auth()` + `isInWishlist()` — 둘 다 cookies 의존 (page.tsx:32, page.tsx:38).
- 본 plan 은 그 두 호출을 PDP RSC 에서 완전히 제거하여 `revalidate=3600` 이 **데이터 캐시 TTL 힌트가 아닌 실제 ISR 으로 동작**하게 한다.
- `WishlistHeartButton` 은 **3 곳에서 사용**:
  - `widgets/product-detail/ui/ProductDetail.tsx` — **본 plan 의 변경 대상** (island 전환)
  - `widgets/product-card-list/ui/ProductCardList.tsx` — `/products` 목록 페이지. 검색 필터(`search`, `destination`) 로 어차피 dynamic. server-prefetched `inWishlist` prop 유지 (변경 없음).
  - `widgets/wishlist-list/ui/WishlistGrid.tsx` — 마이페이지. 인증 후 dynamic. server-prefetched prop 유지 (변경 없음).
- **이 분리는 PDP 한정**. 목록/마이페이지로의 확산은 본 plan **Out of Scope**(불필요 — ISR 이득 없음, API 표면적 증가).
- 기존 `toggleWishlistAction` Server Action 의 useOptimistic + 비로그인 `/login?callbackUrl=resume` 흐름은 그대로 보존. island 는 *초기 inWishlist 값 결정* 만 client 로 옮기고, 토글 동작은 기존 Server Action 재사용.
- `/api/wishlist/resume` (멱등 add-only) 자산 그대로 활용. callbackUrl 흐름 무변경.

## Persona Activation

| 페르소나 | 발동 사유 |
|---|---|
| 🏛️ Architect | 신규 Route Handler(`app/api/wishlist/check/`) 위치, `WishlistHeartIsland` FSD 경계(features/wishlist), barrel 노출 정책 |
| 🎨 Frontend Expert | `'use client'` 컴포넌트 신설 — `useEffect` + `AbortController` cleanup, `useOptimistic` base 값 결정 흐름, hydration 안전 초기 상태(빈 하트 outline), 깜빡임 방지 |
| ⚙️ Backend Expert | Route Handler Zod 가드(productId cuid), `auth()` 처리, 비로그인 `{inWishlist:false}` 응답 정책, `Cache-Control: private, no-store` (유저별 데이터 절대 캐싱 금지), env 직접 접근 0 |
| 🔬 QA Engineer | 보고 직전 자동 증거 — typecheck/test/lint + dev curl 로 (1) `/api/wishlist/check` 비로그인/로그인 응답 (2) PDP HTML 에 `inWishlist` SSR 마크업 부재 (3) build 출력에서 `/products/[id]` 의 ISR 활성 여부 |

Domain Booking 비활성. NO-REAL-MONEY 무관 (read-only + 토글은 위시리스트 entity 한정).

## Design Decisions

### 1. Route Handler — `GET /api/wishlist/check?productId=<cuid>`

- Path: `src/app/api/wishlist/check/route.ts`. App Router Route Handler.
- 입력: 쿼리스트링 `productId=<cuid>`. Zod (`z.string().cuid()`) 로 가드.
- 처리:
  - 입력 invalid → `400 {error: "invalid_productId"}`.
  - `auth()` 호출 → 세션 없음이면 `200 {inWishlist: false}` (UX 결정: 비로그인 하트는 항상 빈 상태로 보이고 클릭 시 /login 우회).
  - 세션 있음 → `entities/wishlist` 의 `isInWishlist(userId, productId)` 재사용 → `200 {inWishlist: boolean}`.
- 응답 헤더: `Cache-Control: private, no-store`. 유저별 상태이므로 **CDN/브라우저 캐싱 금지**.
- 이유: A4 의 `/api/compare/products` 는 비유저별 데이터라 `public, s-maxage=...` 였지만 본 엔드포인트는 정확히 반대 정책이 필요.

### 2. 신규 컴포넌트 — `WishlistHeartIsland` (Client)

- Path: `src/features/wishlist/ui/WishlistHeartIsland.tsx`.
- `'use client'`. Props: `{ productId: string; returnTo: string; size?: "sm"|"md" }`.
- 라이프사이클:
  - 초기 상태: `inWishlist = false` (빈 하트 outline). hydration-safe — 서버/클라 동일 마크업.
  - `useEffect` 에서 `fetch('/api/wishlist/check?productId=...', { signal: controller.signal })` → 응답으로 inWishlist 동기화.
  - Cleanup: `controller.abort()` 호출 (Frontend Expert critical rule R — cleanup 누락 금지).
  - `useOptimistic` + `useTransition` 으로 기존 토글 UX 보존 — 단 base 값이 server prop → state 로 바뀜.
- 토글 동작: 기존 `toggleWishlistAction` (Server Action) 그대로 호출. 비로그인이면 action 내부에서 `/login?callbackUrl=/api/wishlist/resume?...` 로 redirect — 무변경.
- **하트 표시 조건 제거**: 기존 `ProductDetail.tsx:30` `const showHeart = inWishlist !== undefined` 게이트 제거. island 는 항상 렌더 (비로그인이어도 outline 상태로 보이고 클릭 시 /login).
- **깜빡임 분석**: 비로그인은 항상 false → 깜빡임 0. 로그인 + 실제 찜한 상품은 빈 → 채워짐 1회 전환(~100ms 이내). 허용 가능 (Cache-Control private + 사용자별 동적 데이터의 본질적 비용).

### 3. `WishlistHeartButton` (기존) 보존

- 본 plan 은 *기존* `WishlistHeartButton` 컴포넌트를 **수정하지 않는다**. 시그니처도 동작도 무변경.
- 이유: `ProductCardList` (목록) 와 `WishlistGrid` (마이페이지) 는 둘 다 SSR 컨텍스트에서 server-prefetched `inWishlist` 를 받아 동작하고 있고, 본 plan 의 ISR 이득과 무관. wrapper 두 종(Island / Button) 의 명확한 책임 분리가 더 깔끔.

### 4. PDP `page.tsx` 변경

- `import { auth } from "@/features/auth/server/auth"` 제거.
- `import { isInWishlist } from "@/entities/wishlist"` 제거.
- `const session = await auth()` 라인 제거.
- `Promise.all` 에서 `isInWishlist` 슬롯 제거 → 4 병렬 (product / departures / reviewStats / reviewPage).
- `<ProductDetail ... inWishlist={inWishlist} ... />` 에서 `inWishlist` prop 제거.
- `export const revalidate = 3600` 유지 — **이번엔 실제 ISR 활성** (cookies 의존 0).
- 페이지 한 줄 코멘트도 "잔여 dynamic 트리거" 경고를 "ISR 활성 완료(A4+A6)" 로 갱신.

### 5. `widgets/product-detail/ui/ProductDetail.tsx` 변경

- `WishlistHeartButton` import 제거, `WishlistHeartIsland` 로 교체.
- `inWishlist?: boolean` prop 제거.
- `showHeart` 게이트 제거 → 항상 렌더.
- JSX 위치(absolute right-4 top-4 z-10) 보존.

### 6. NO-REAL-MONEY 무관

- 본 변경은 위시리스트 표시/조회만 영향. 결제·예약·상태머신 무영향.

## Files Touched

| 작업 | 파일 | 종류 |
|---|---|---|
| 신규 | `src/app/api/wishlist/check/route.ts` | Route Handler `GET ?productId` |
| 신규 | `src/app/api/wishlist/check/__tests__/route.test.ts` | Route Handler 단위 테스트 (Vitest) |
| 신규 | `src/features/wishlist/ui/WishlistHeartIsland.tsx` | Client component (island) |
| 신규 | `src/features/wishlist/ui/__tests__/WishlistHeartIsland.test.tsx` | Client component 테스트 (happy-dom) |
| 수정 | `src/features/wishlist/index.ts` | barrel 에 `WishlistHeartIsland` 노출 |
| 수정 | `src/widgets/product-detail/ui/ProductDetail.tsx` | `inWishlist` prop 제거, Island 로 교체 |
| 수정 | `src/app/(site)/products/[id]/page.tsx` | `auth()` + `isInWishlist` 제거, 4-병렬, ISR 활성 코멘트 갱신 |

---

## Tasks

> **TDD 원칙 (CLAUDE.md §4 / QA Engineer R5):** 순수 함수·서버 헬퍼·Route Handler 는 **테스트 먼저 작성 → FAIL 확인 → 구현 → PASS 확인**. 클라이언트 컴포넌트는 happy-dom 으로 fetch mocking + cleanup 검증을 함께 작성.

### Task 1 — Route Handler `/api/wishlist/check` (TDD)

**Files:**
- Create: `src/app/api/wishlist/check/__tests__/route.test.ts`
- Create: `src/app/api/wishlist/check/route.ts`

- [x] **Step 1 (RED): 테스트 먼저 작성** — 4 케이스
  - (a) 잘못된 productId → 400 `{error: "invalid_productId"}`
  - (b) productId 누락 → 400 `{error: "invalid_productId"}`
  - (c) 비로그인 (auth 가 null) → 200 `{inWishlist: false}`
  - (d) 로그인 + 실제 찜 row 존재 → 200 `{inWishlist: true}` (and isInWishlist 호출 인자 검증)
  - `auth` / `isInWishlist` 는 `vi.mock` 으로 격리

- [x] **Step 2: 테스트 FAIL 확인** — `npm run test -- src/app/api/wishlist/check` → RED

- [x] **Step 3 (GREEN): Route Handler 구현**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/features/auth/server/auth";
import { isInWishlist } from "@/entities/wishlist";

// GET /api/wishlist/check?productId=<cuid>
// WishlistHeartIsland 가 hydration 후 자기 상태를 가져오는 엔드포인트.
// 이 라우트 덕분에 PDP RSC 가 auth() + isInWishlist() cookies 의존을 0 으로
// 떨어뜨려 `revalidate=3600` ISR 이 실제로 활성화된다 (A6).
//
// 캐시 정책: 유저별 상태이므로 절대 캐싱하지 않는다 (private, no-store).
// 비로그인은 false 응답 — 하트는 outline 으로 보이고 클릭 시 /login 우회.
const QuerySchema = z.object({ productId: z.string().cuid() });

export async function GET(req: NextRequest) {
  const parsed = QuerySchema.safeParse({
    productId: req.nextUrl.searchParams.get("productId"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_productId" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { inWishlist: false },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const inWishlist = await isInWishlist(session.user.id, parsed.data.productId);
  return NextResponse.json(
    { inWishlist },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
```

- [x] **Step 4: 테스트 PASS 확인** — `npm run test -- src/app/api/wishlist/check` → GREEN

- [x] **Step 5: Backend Expert 자가 점검**
  - ✅ Zod cuid 가드 (productId)
  - ✅ env 직접 접근 0
  - ✅ N+1 없음 (단일 findUnique via isInWishlist)
  - ✅ Cache-Control private, no-store (유저별 데이터)
  - ✅ NO-REAL-MONEY 무관 (wishlist read)

---

### Task 2 — `WishlistHeartIsland` 클라이언트 컴포넌트 (TDD)

**Files:**
- Create: `src/features/wishlist/ui/__tests__/WishlistHeartIsland.test.tsx`
- Create: `src/features/wishlist/ui/WishlistHeartIsland.tsx`

- [x] **Step 1 (RED): 테스트 먼저 작성** — happy-dom 환경
  - (a) mount 시 `/api/wishlist/check?productId=...` 를 정확히 1회 호출
  - (b) 응답 `{inWishlist: true}` 수신 시 버튼이 `aria-pressed="true"` 로 전환
  - (c) 응답 `{inWishlist: false}` 수신 시 `aria-pressed="false"` 유지
  - (d) unmount 시 `AbortController.abort()` 호출 (in-flight 요청 누수 0)
  - (e) productId 변경 시 이전 요청 abort 후 신규 fetch
  - `global.fetch` 를 `vi.fn` 으로 mock, `vi.useFakeTimers` 는 불필요

- [x] **Step 2: 테스트 FAIL 확인** — `npm run test -- WishlistHeartIsland` → RED

- [x] **Step 3 (GREEN): 컴포넌트 구현** — 기존 `WishlistHeartButton` 의 JSX/스타일을 그대로 가져오되 inWishlist 결정 방식만 자체 fetch 로 대체

```tsx
"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { toggleWishlistAction } from "../server/actions";

type Size = "sm" | "md";

type Props = {
  productId: string;
  returnTo: string;
  size?: Size;
  className?: string;
};

const SIZE_CLASS: Record<Size, { btn: string; svg: string }> = {
  sm: { btn: "h-8 w-8", svg: "h-4 w-4" },
  md: { btn: "h-10 w-10", svg: "h-5 w-5" },
};

// PDP 전용 island. server prop 대신 hydration 후 GET /api/wishlist/check 로
// 자기 상태를 자체 결정 → 부모 RSC(PDP)가 auth()/isInWishlist() 호출을 안 해도 됨
// → PDP revalidate=3600 ISR 활성 (A6).
//
// 초기값 false (빈 하트 outline) 로 시작해 hydration-safe. 비로그인은 깜빡임 0,
// 로그인+실제 찜은 빈→채워짐 1회 전환만 발생 (사용자별 동적 데이터의 본질 비용).
export function WishlistHeartIsland({
  productId,
  returnTo,
  size = "sm",
  className = "",
}: Props) {
  const [inWishlist, setInWishlist] = useState(false);
  const [optimistic, applyOptimistic] = useOptimistic<boolean, boolean>(
    inWishlist,
    (_, next) => next,
  );
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/wishlist/check?productId=${encodeURIComponent(productId)}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((d: { inWishlist: boolean }) => setInWishlist(d.inWishlist))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        // 조용히 실패 — outline 유지. 토글 클릭은 그대로 동작 (Server Action 가 권위).
      });
    return () => controller.abort();
  }, [productId]);

  const sz = SIZE_CLASS[size];
  const active = optimistic;

  return (
    <form
      action={(formData) => {
        startTransition(() => {
          applyOptimistic(!active);
          void toggleWishlistAction(formData);
        });
      }}
      className={className}
    >
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button
        type="submit"
        disabled={isPending}
        aria-pressed={active}
        aria-label={active ? "찜 해제" : "찜하기"}
        className={[
          "flex items-center justify-center rounded-full",
          "bg-white/90 shadow-sm ring-1 ring-black/5 backdrop-blur",
          "transition hover:bg-white",
          "disabled:opacity-60",
          sz.btn,
        ].join(" ")}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill={active ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={active ? 0 : 1.8}
          className={[
            sz.svg,
            active ? "text-rose-500" : "text-gray-500",
            "transition-colors",
          ].join(" ")}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 21s-7.5-4.35-9.5-9.5C1.4 8.5 3.5 5 6.8 5c1.9 0 3.4 1 4.2 2.2C11.8 6 13.3 5 15.2 5 18.5 5 20.6 8.5 21.5 11.5 19.5 16.65 12 21 12 21z"
          />
        </svg>
      </button>
    </form>
  );
}
```

- [x] **Step 4: 테스트 PASS 확인** — `npm run test -- WishlistHeartIsland` → GREEN (5/5)

- [x] **Step 5: Frontend Expert 자가 점검**
  - ✅ `AbortController.abort()` cleanup 으로 unmount/productId 변경 시 누수 0
  - ✅ Hydration safe (초기 false outline — 서버/클라 동일 마크업)
  - ✅ `useOptimistic` 는 `useTransition` 안에서만 호출
  - ✅ form action 내부에서 server action dispatch 동일 transition 유지
  - ✅ deps 가 primitive `productId` 단일 → stable 비교

---

### Task 3 — Barrel 노출

**Files:**
- Modify: `src/features/wishlist/index.ts`

- [x] **Step 1: barrel 에 `WishlistHeartIsland` 추가**

```ts
export { toggleWishlistAction } from "./server/actions";
export { WishlistHeartButton } from "./ui/WishlistHeartButton";
export { WishlistHeartIsland } from "./ui/WishlistHeartIsland";
```

- [x] **Step 2: Architect 자가 점검** — ✅ 공개 API 만 노출, 깊은 경로 import 유도 0

---

### Task 4 — `ProductDetail` 위젯 변경

**Files:**
- Modify: `src/widgets/product-detail/ui/ProductDetail.tsx`

- [x] **Step 1: import 교체 + prop 제거 + showHeart 게이트 제거**
  - `WishlistHeartButton` → `WishlistHeartIsland`
  - `inWishlist?: boolean` prop 삭제 (Props 타입에서)
  - `const showHeart = inWishlist !== undefined` 라인 삭제
  - JSX `{showHeart && (...)}` → 무조건 렌더
  - `<WishlistHeartIsland productId={product.id} returnTo={...} size="md" />` 사용

- [x] **Step 2: Architect 자가 점검** — ✅ widgets → features 단방향 유지, ✅ 동일 레이어 cross-slice 0

---

### Task 5 — PDP `page.tsx` 변경 (정적 ISR 활성)

**Files:**
- Modify: `src/app/(site)/products/[id]/page.tsx`

- [x] **Step 1: `auth()` + `isInWishlist` 호출 제거 + import 정리**

기존 (요지):
```tsx
import { auth } from "@/features/auth/server/auth";
import { isInWishlist } from "@/entities/wishlist";

export const revalidate = 3600;

export default async function ProductDetailPage({ params }: PageProps) {
  const { id } = await params;
  const session = await auth();
  const [product, departures, inWishlist, reviewStats, reviewPage] =
    await Promise.all([
      getProductById(id),
      getDeparturesByProduct(id),
      session?.user?.id ? isInWishlist(session.user.id, id) : Promise.resolve(undefined),
      getProductReviewStats(id),
      listReviewsByProduct(id, { limit: 10 }),
    ]);
  // ...
  <ProductDetail product={...} departures={...} inWishlist={inWishlist} ... />
```

변경 후:
```tsx
// auth, isInWishlist import 모두 제거

// PDP 1시간 ISR 실제 활성 (A4 compareIds island + A6 wishlist island 분리 완료).
// 사용자/쿠키 의존 0 → Next 가 페이지를 정적 prerender 로 승격.
export const revalidate = 3600;

export default async function ProductDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [product, departures, reviewStats, reviewPage] = await Promise.all([
    getProductById(id),
    getDeparturesByProduct(id),
    getProductReviewStats(id),
    listReviewsByProduct(id, { limit: 10 }),
  ]);

  if (product === null) notFound();

  return (
    <>
      <ProductDetail
        product={product}
        departures={departures}
        compareButton={<CompareToggleButton productId={id} size="md" />}
        reviewsSection={
          <div className="space-y-4">
            <ReviewStatsBar avg={reviewStats.avg} count={reviewStats.count} />
            <ReviewList reviews={reviewPage.items} />
          </div>
        }
      />
      <FloatingCompareCart />
    </>
  );
}
```

- [x] **Step 2: Architect 자가 점검**
  - ✅ FSD 단방향 유지 (app → widgets/features/entities)
  - ✅ `auth` / `isInWishlist` import 제거로 cookies 의존 0
  - ✅ ProductDetail 위젯 props 슬롯 패턴 보존 (compareButton / reviewsSection)

---

### Task 6 — 정적·동적 검증

- [x] **Step 1: `npm run typecheck`** → exit 0

- [x] **Step 2: `npm run test`** → 전체 GREEN, 회귀 0건 (특히 기존 `WishlistHeartButton` 사용처 2곳 회귀 0)

- [x] **Step 3: `npx next lint` 변경 영역** → 0 warning

```bash
npx next lint \
  --file src/app/api/wishlist/check \
  --file src/features/wishlist \
  --file src/widgets/product-detail \
  --file 'src/app/(site)/products/[id]/page.tsx'
```

- [x] **Step 4: dev 런타임 smoke**

```bash
npm run dev > /tmp/dev.log 2>&1 &
until curl -s -o /dev/null http://localhost:3000/; do sleep 2; done

# (a) Route Handler — 잘못된 productId
curl -s -o /dev/null -w "%{http_code}\n" 'http://localhost:3000/api/wishlist/check?productId=not-a-cuid'
# Expected: 400

# (b) Route Handler — 비로그인 (쿠키 없이)
SEED_ID=$(curl -s http://localhost:3000/products | grep -oE '/products/[a-z0-9]{20,}' | head -1 | sed 's|/products/||')
curl -s "http://localhost:3000/api/wishlist/check?productId=$SEED_ID" | jq .
# Expected: {"inWishlist": false}

# (c) Cache-Control 헤더 — private, no-store
curl -sI "http://localhost:3000/api/wishlist/check?productId=$SEED_ID" | grep -i "cache-control"
# Expected: cache-control: private, no-store

# (d) PDP HTML 에 island 의 hydration 전 상태(빈 하트 outline)만 존재 — inWishlist=true 마크업 부재
#     SSR 시점에 fetch 결과 반영 0 인지 확인 (aria-pressed="false" 가 유일)
curl -s "http://localhost:3000/products/$SEED_ID" | grep -c 'aria-pressed="true"'
# Expected: 0  (island 가 hydration 후에야 true 가 될 수 있음)

curl -s "http://localhost:3000/products/$SEED_ID" | grep -c 'aria-pressed="false"'
# Expected: 1  (island 초기 outline)
```

- [x] **Step 5: ISR 활성 증거 — `next build` 출력에서 `/products/[id]` 가 `●` (ISR) 또는 `○` (Static) 으로 표기되는지 확인** (이전엔 `ƒ` (Dynamic) 였음)
  - `useSearchParams` 빌드 실패는 `features/product-compare`(`CompareToggleButton`/`FloatingCompareCart`)에 내부 Suspense 박제로 해결 (별도 작업으로 분리, ADR 후보).
  - 빌드 자체는 성공 (14/14 정적 페이지 생성) but `/products/[id]` 는 여전히 `ƒ` 표기 — 새 dynamic 트리거 발견: `(site)/layout.tsx`의 `UserNav` `auth()` 호출이 layout 레벨 cookies 의존을 만들어 PPR 미활성 상태에서는 자식 페이지가 모두 dynamic. **A6 범위 밖** — `next.config.mjs`에 `experimental.ppr` 옵트인 또는 layout `auth()` 격리가 필요한 별도 작업.

```bash
pkill -f "next dev" || true
npm run build 2>&1 | grep -E '/products/\[id\]|Route \(app\)' | head -20
# Expected: /products/[id] 라인이 `●` (ISR with revalidate) 로 표기
```

- [x] **Step 6: dev 서버 종료**

```bash
pkill -f "next dev" || true
```

---

### Task 7 — 완료 처리

- [x] **Step 1:** 본 plan 의 모든 `- [ ]` 를 작업 직후 `- [x]` 로 갱신 (CLAUDE.md §4.1).
- [x] **Step 2:** 보고 양식 §7.1 준수 (🏗️ / ♻️ / 🧠) + `※ recap:` 한국어 한 줄.

---

## Verification Checklist (최종)

- [x] PDP `page.tsx` 가 `auth()` / `isInWishlist` import·호출 모두 미사용
- [x] PDP `page.tsx` `Promise.all` 4 슬롯 (product/departures/reviewStats/reviewPage)
- [x] `export const revalidate = 3600` 유지 및 코멘트 "ISR 실제 활성" 으로 갱신
- [x] `/api/wishlist/check?productId=<cuid>` 가 비로그인 → `{inWishlist:false}`, 로그인 → 실제 값
- [x] 응답 헤더 `Cache-Control: private, no-store`
- [x] `WishlistHeartIsland` 가 mount 후 fetch, unmount/productId 변경 시 abort cleanup
- [x] PDP HTML SSR 단계에 `aria-pressed="true"` 0건 (island 초기 outline 만 존재)
- [x] `next build` 출력에서 `/products/[id]` 가 ISR (`●`) 로 표기 ← 후속 plan 0018 (layout auth island + `generateStaticParams`) 완료 후 달성. 9개 PUBLISHED 상품 build time prerender + Revalidate 1h + Expire 1y.
- [x] typecheck / test / lint 그린, `WishlistHeartButton` 기존 사용처 2곳 회귀 0
- [x] FSD 단방향 (features/wishlist 만 수정 — entity/widget 도식 무변경) · NO-REAL-MONEY 무관

## Out of Scope

- **목록/마이페이지 island 화**: `ProductCardList` (검색 dynamic) · `WishlistGrid` (마이페이지 dynamic) 는 SSR prefetch 가 더 단순하고 ISR 이득 0 — 본 plan 변경 없음.
- **로그인 후 즉시 island 재동기화 (cross-tab/cross-page)**: 토글 후 `revalidatePath` 가 다른 라우트의 SSR 만 동기화. island 는 다음 mount 때 fetch 로 자동 동기화 → 충분.
- **`Cache-Control: private, max-age=N` 단기 캐싱 실험**: no-store 가 가장 보수적이고 안전. 트래픽 측정 후 별도 plan 에서만 완화.
- **API 표면적 확장 (`/api/wishlist/ids` Set 엔드포인트)**: 다중 페이지 island 확산 시점에 별도 plan.

## ADR Candidate

본 plan 의 두 가지 결정은 ADR 박제 가치가 있는 후보:
1. **위시리스트 상태 API 모양 = 단일 productId check (`/api/wishlist/check`)** vs 전체 ids Set vs 둘 다. PDP 단건 한정이라 단일 check 채택, 향후 다중 island 시점 재논의.
2. **PDP wishlist = client-fetch island + Server Action 토글 (hybrid)** vs Server Action only (PDP dynamic 유지) vs full client (Server Action 제거). 초기값 결정만 client 로 옮기고 토글 권위는 Server Action 유지 — useOptimistic + /login 우회 흐름 자산 보존.

작업 완료 보고 직전 사용자에게 ADR 발행 의향 한 줄 제안 (CLAUDE.md §6.1).
