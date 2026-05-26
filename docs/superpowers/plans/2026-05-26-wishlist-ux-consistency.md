# Wishlist UX Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `WishlistHeartButton`이 쓰이는 모든 화면(`/products`, `/mypage`)에서 비로그인 클릭 시 PDP Island와 동일한 `window.confirm` 인터셉트(취소 시 머묾, 확인 시 `/login?callbackUrl=<resume>`)를 적용한다. SSR 이점(서버 주입 `inWishlist`) 100% 보존.

**Architecture:** Button에 `loggedIn: boolean` prop 추가 → 자체 onSubmit 인터셉트. 공용 헬퍼 `loginPrompt.ts`로 메시지·URL 형식을 Island와 일원화. Server Action(`toggleWishlistAction`)은 변경 없음(우회 시 안전망 유지).

**Tech Stack:** Next.js 15 App Router, React 19(`useOptimistic`/`useTransition`), Vitest 2 + `react-dom/client`/`act`, TypeScript strict, Tailwind.

**Spec:** `docs/superpowers/specs/2026-05-26-wishlist-ux-consistency-design.md`

---

## File Structure

| Path | 역할 | 작업 |
|---|---|---|
| `src/features/wishlist/lib/loginPrompt.ts` | 메시지 상수 + `buildResumeCallbackUrl()` | Create |
| `src/features/wishlist/lib/__tests__/loginPrompt.test.ts` | 헬퍼 단위 테스트 | Create |
| `src/features/wishlist/ui/__tests__/WishlistHeartButton.test.tsx` | Button 동작 명세 | Create |
| `src/features/wishlist/ui/WishlistHeartButton.tsx` | `loggedIn` prop + confirm 인터셉트 | Modify |
| `src/features/wishlist/ui/WishlistHeartIsland.tsx` | 헬퍼 import로 메시지·URL 일원화 | Modify |
| `src/widgets/product-card-list/ui/ProductCardList.tsx` | `loggedIn` prop pass-through | Modify |
| `src/widgets/wishlist-list/ui/WishlistGrid.tsx` | Button에 `loggedIn={true}` 하드코딩 | Modify |
| `src/app/(site)/products/page.tsx` | `loggedIn = !!session?.user?.id` 계산 → `<ProductCardList>` 전달 | Modify |

호출처 4곳(`ProductCardList`, `WishlistGrid`, `/products/page.tsx`, Island 헬퍼화) 모두 본 plan에서 처리.

---

### Task 1: 공용 헬퍼 `loginPrompt.ts` — RED

**Files:**
- Create: `src/features/wishlist/lib/loginPrompt.ts`
- Test: `src/features/wishlist/lib/__tests__/loginPrompt.test.ts`

- [x] **Step 1: 헬퍼 테스트 작성 (RED)**

Create `src/features/wishlist/lib/__tests__/loginPrompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  LOGIN_PROMPT_MESSAGE,
  buildResumeCallbackUrl,
} from "../loginPrompt";

describe("LOGIN_PROMPT_MESSAGE", () => {
  it("'로그인' 문자열 포함 (스모크)", () => {
    expect(LOGIN_PROMPT_MESSAGE).toContain("로그인");
  });
});

describe("buildResumeCallbackUrl()", () => {
  it("기본 형태: /api/wishlist/resume?productId=...&returnTo=...", () => {
    const url = buildResumeCallbackUrl("p1", "/products");
    expect(url).toBe(
      "/api/wishlist/resume?productId=p1&returnTo=%2Fproducts",
    );
  });

  it("쿼리스트링이 있는 returnTo 도 정확히 인코딩", () => {
    const url = buildResumeCallbackUrl("p1", "/products?page=2&sort=new");
    // & 와 ? 가 모두 인코딩되어 callbackUrl 파싱이 깨지지 않아야 함
    expect(url).toBe(
      "/api/wishlist/resume?productId=p1&returnTo=%2Fproducts%3Fpage%3D2%26sort%3Dnew",
    );
  });

  it("productId 에 특수문자가 와도 인코딩", () => {
    const url = buildResumeCallbackUrl("a/b c", "/x");
    expect(url).toContain("productId=a%2Fb%20c");
  });
});
```

- [x] **Step 2: 테스트 실행 → FAIL 확인**

Run: `npx vitest run src/features/wishlist/lib/__tests__/loginPrompt.test.ts`
Expected: FAIL — `Cannot find module '../loginPrompt'`.

- [x] **Step 3: 헬퍼 구현 (GREEN)**

Create `src/features/wishlist/lib/loginPrompt.ts`:

```ts
// 비로그인 유저가 찜 클릭 시 노출되는 confirm 문구.
// PDP `WishlistHeartIsland` 와 목록 `WishlistHeartButton` 이 같은 문구를 쓰도록 중앙화.
export const LOGIN_PROMPT_MESSAGE =
  "로그인 후 이용하실 수 있습니다.\n로그인하시겠습니까?";

// /login?callbackUrl=<여기서 만든 URL> 형태로 합성될 resume 엔드포인트 URL.
// 로그인 성공 후 /api/wishlist/resume 가 idempotent upsert(add-only) 처리 후
// returnTo 로 redirect 한다.
export function buildResumeCallbackUrl(
  productId: string,
  returnTo: string,
): string {
  return (
    "/api/wishlist/resume" +
    `?productId=${encodeURIComponent(productId)}` +
    `&returnTo=${encodeURIComponent(returnTo)}`
  );
}
```

- [x] **Step 4: 테스트 실행 → PASS 확인**

Run: `npx vitest run src/features/wishlist/lib/__tests__/loginPrompt.test.ts`
Expected: PASS 3건.

- [x] **Step 5: 타입체크**

Run: `npm run typecheck`
Expected: 통과(에러 0).

- [x] **Step 6: Commit**

```bash
git add src/features/wishlist/lib/loginPrompt.ts src/features/wishlist/lib/__tests__/loginPrompt.test.ts
git commit -m "feat(wishlist): add shared loginPrompt helper for confirm message + resume URL"
```

---

### Task 2: `WishlistHeartIsland` — 헬퍼로 메시지·URL 일원화 (리팩토링, 동작 동일)

**Files:**
- Modify: `src/features/wishlist/ui/WishlistHeartIsland.tsx`

목적: PDP Island 가 새 헬퍼를 사용하도록 바꿔 메시지/URL 형식이 Button과 단일 소스가 되게 한다. 외부 동작 변경 없음 → 기존 테스트 그대로 통과.

- [x] **Step 1: 기존 Island 테스트가 그대로 통과하는지 baseline 확인**

Run: `npx vitest run src/features/wishlist/ui/__tests__/WishlistHeartIsland.test.tsx`
Expected: 9 PASS (현 상태 baseline).

- [x] **Step 2: Island에서 헬퍼 import 후 inline 상수·URL 제거**

`src/features/wishlist/ui/WishlistHeartIsland.tsx` 변경:

(a) 상단 import에 헬퍼 추가:

```ts
import { LOGIN_PROMPT_MESSAGE, buildResumeCallbackUrl } from "../lib/loginPrompt";
```

(b) inline 상수 제거:

```ts
const LOGIN_PROMPT_MESSAGE =
  "로그인 후 이용하실 수 있습니다.\n로그인하시겠습니까?";
```
→ 삭제(헬퍼에서 import).

(c) onSubmit 분기 내 resume URL 합성을 헬퍼 호출로 교체. 기존:

```ts
const resumeUrl = `/api/wishlist/resume?productId=${encodeURIComponent(productId)}&returnTo=${encodeURIComponent(returnTo)}`;
router.push(`/login?callbackUrl=${encodeURIComponent(resumeUrl)}`);
```

→ 변경:

```ts
const resumeUrl = buildResumeCallbackUrl(productId, returnTo);
router.push(`/login?callbackUrl=${encodeURIComponent(resumeUrl)}`);
```

- [x] **Step 3: Island 테스트 재실행 → 변함없이 PASS**

Run: `npx vitest run src/features/wishlist/ui/__tests__/WishlistHeartIsland.test.tsx`
Expected: 9 PASS (동작 동일).

- [x] **Step 4: 타입체크**

Run: `npm run typecheck`
Expected: 통과.

- [x] **Step 5: Commit**

```bash
git add src/features/wishlist/ui/WishlistHeartIsland.tsx
git commit -m "refactor(wishlist): WishlistHeartIsland uses shared loginPrompt helper"
```

---

### Task 3: `WishlistHeartButton` 테스트 작성 — RED

**Files:**
- Create: `src/features/wishlist/ui/__tests__/WishlistHeartButton.test.tsx`

기존 Button 은 `<form action={...}>` 패턴이고 `loggedIn` prop이 없다. 새 명세는 `onSubmit` 인터셉트 + `loggedIn` 분기.

- [x] **Step 1: 새 명세 테스트 작성 (RED)**

Create `src/features/wishlist/ui/__tests__/WishlistHeartButton.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { Root } from "react-dom/client";

// vi.hoisted: vi.mock factory 실행 전 mocks 객체 확보
const mocks = vi.hoisted(() => ({
  toggleWishlistAction: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock("@/features/wishlist/server/actions", () => ({
  toggleWishlistAction: mocks.toggleWishlistAction,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.routerPush }),
}));

import { WishlistHeartButton } from "../WishlistHeartButton";

const PRODUCT_ID = "clfake000000000000000001";
const RETURN_TO = "/products?page=2";

describe("<WishlistHeartButton />", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    mocks.toggleWishlistAction.mockReset();
    mocks.routerPush.mockReset();
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
    }
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function render(props: {
    loggedIn: boolean;
    inWishlist: boolean;
    productId?: string;
    returnTo?: string;
  }) {
    return act(async () => {
      root = createRoot(container);
      root.render(
        <WishlistHeartButton
          productId={props.productId ?? PRODUCT_ID}
          inWishlist={props.inWishlist}
          loggedIn={props.loggedIn}
          returnTo={props.returnTo ?? RETURN_TO}
        />,
      );
    });
  }

  function submitForm() {
    const form = container.querySelector("form")!;
    return act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
  }

  // (a) 로그인 + 클릭 → server action 호출, confirm 미호출
  it("(a) loggedIn=true 클릭 → toggleWishlistAction 호출, window.confirm 미호출", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    await render({ loggedIn: true, inWishlist: false });
    await submitForm();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mocks.toggleWishlistAction).toHaveBeenCalledOnce();
    expect(mocks.routerPush).not.toHaveBeenCalled();
  });

  // (b) 비로그인 + 클릭 → confirm 호출, server action 미호출
  it("(b) loggedIn=false 클릭 → window.confirm 호출, toggleWishlistAction 미호출", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await render({ loggedIn: false, inWishlist: false });
    await submitForm();

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(confirmSpy.mock.calls[0][0]).toContain("로그인");
    expect(mocks.toggleWishlistAction).not.toHaveBeenCalled();
  });

  // (c) 비로그인 + confirm 취소 → 아무 navigation 없음
  it("(c) loggedIn=false + confirm 취소 → routerPush · toggleWishlistAction 모두 미호출", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await render({ loggedIn: false, inWishlist: false });
    await submitForm();

    expect(mocks.routerPush).not.toHaveBeenCalled();
    expect(mocks.toggleWishlistAction).not.toHaveBeenCalled();
  });

  // (d) 비로그인 + confirm 확인 → /login?callbackUrl=<resume> 으로 router.push
  it("(d) loggedIn=false + confirm 확인 → /login?callbackUrl=<resume URL> 로 router.push", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await render({ loggedIn: false, inWishlist: false });
    await submitForm();

    expect(mocks.routerPush).toHaveBeenCalledOnce();
    const pushed = mocks.routerPush.mock.calls[0][0] as string;
    expect(pushed).toMatch(/^\/login\?callbackUrl=/);
    const decoded = decodeURIComponent(pushed.split("callbackUrl=")[1]);
    expect(decoded).toContain("/api/wishlist/resume");
    expect(decoded).toContain(`productId=${PRODUCT_ID}`);
    expect(decoded).toContain("returnTo=%2Fproducts%3Fpage%3D2");
    // server action 은 호출되지 않아야 함
    expect(mocks.toggleWishlistAction).not.toHaveBeenCalled();
  });

  // (e) inWishlist=true → aria-pressed="true"
  it("(e) inWishlist=true → button aria-pressed=true", async () => {
    await render({ loggedIn: true, inWishlist: true });
    const btn = container.querySelector("button");
    expect(btn?.getAttribute("aria-pressed")).toBe("true");
  });

  // (f) inWishlist=false → aria-pressed="false"
  it("(f) inWishlist=false → button aria-pressed=false", async () => {
    await render({ loggedIn: true, inWishlist: false });
    const btn = container.querySelector("button");
    expect(btn?.getAttribute("aria-pressed")).toBe("false");
  });
});
```

- [x] **Step 2: 테스트 실행 → FAIL 확인 (Button 미수정 상태)**

Run: `npx vitest run src/features/wishlist/ui/__tests__/WishlistHeartButton.test.tsx`
Expected: 일부 FAIL — 특히 (b)(c)(d) 비로그인 분기는 현재 Button 에 없으므로 `confirm`/`routerPush` mock 미호출 + `toggleWishlistAction` 호출이 되어 케이스 (b)(c)(d) 실패. (a)(e)(f) 도 `loggedIn` prop 타입 누락으로 컴파일 실패 가능. 어느 쪽이든 RED.

- [x] **Step 3: Commit (RED 박제)**

```bash
git add src/features/wishlist/ui/__tests__/WishlistHeartButton.test.tsx
git commit -m "test(wishlist): WishlistHeartButton — confirm intercept on logged-out click (RED)"
```

---

### Task 4: `WishlistHeartButton` 구현 — GREEN

**Files:**
- Modify: `src/features/wishlist/ui/WishlistHeartButton.tsx`

- [x] **Step 1: Button 전체 재작성**

`src/features/wishlist/ui/WishlistHeartButton.tsx` 전체 교체:

```tsx
"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleWishlistAction } from "../server/actions";
import { LOGIN_PROMPT_MESSAGE, buildResumeCallbackUrl } from "../lib/loginPrompt";

type Size = "sm" | "md";

type Props = {
  productId: string;
  inWishlist: boolean;
  loggedIn: boolean;
  returnTo: string;
  size?: Size;
  className?: string;
};

const SIZE_CLASS: Record<Size, { btn: string; svg: string }> = {
  sm: { btn: "h-8 w-8", svg: "h-4 w-4" },
  md: { btn: "h-10 w-10", svg: "h-5 w-5" },
};

// SSR 주입형 하트 버튼. `inWishlist` · `loggedIn` 을 페이지 RSC 가 prop 으로 내려준다.
// 비로그인 클릭 흐름은 PDP `WishlistHeartIsland` 와 동일하게 confirm 인터셉트 →
// /login?callbackUrl=<resume URL> 로 navigation. Server Action 은 호출하지 않는다.
// (Server Action 자체도 비로그인 시 redirect 하는 안전망을 그대로 유지.)
export function WishlistHeartButton({
  productId,
  inWishlist,
  loggedIn,
  returnTo,
  size = "sm",
  className = "",
}: Props) {
  const [optimistic, applyOptimistic] = useOptimistic<boolean, boolean>(
    inWishlist,
    (_, next) => next,
  );
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const sz = SIZE_CLASS[size];
  const active = optimistic;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!loggedIn) {
          const ok = window.confirm(LOGIN_PROMPT_MESSAGE);
          if (!ok) return;
          const resumeUrl = buildResumeCallbackUrl(productId, returnTo);
          router.push(`/login?callbackUrl=${encodeURIComponent(resumeUrl)}`);
          return;
        }
        const formData = new FormData(e.currentTarget);
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

- [x] **Step 2: Button 테스트 실행 → 6 PASS 확인 (GREEN)**

Run: `npx vitest run src/features/wishlist/ui/__tests__/WishlistHeartButton.test.tsx`
Expected: 6 PASS.

- [x] **Step 3: Island 테스트도 회귀 없음 확인**

Run: `npx vitest run src/features/wishlist/ui/__tests__/`
Expected: 15 PASS (Island 9 + Button 6).

- [x] **Step 4: 타입체크 (이 시점 호출처 미수정 → FAIL 예상)**

Run: `npm run typecheck`
Expected: FAIL — `ProductCardList`·`WishlistGrid` 의 `<WishlistHeartButton ... />` 가 `loggedIn` prop 누락으로 TS2741. 호출처 수정(Task 5,6,7)에서 해소.

- [x] **Step 5: Commit (호출처 미수정 상태, but 테스트는 GREEN — 다음 task가 호출처 마감)**

```bash
git add src/features/wishlist/ui/WishlistHeartButton.tsx
git commit -m "feat(wishlist): WishlistHeartButton confirm intercept on logged-out click"
```

---

### Task 5: `ProductCardList` — `loggedIn` prop pass-through

**Files:**
- Modify: `src/widgets/product-card-list/ui/ProductCardList.tsx`

- [x] **Step 1: ProductCardList prop 시그니처에 `loggedIn` 추가 + Button 에 전달**

`src/widgets/product-card-list/ui/ProductCardList.tsx` 변경. props 타입에 `loggedIn`을 추가하고, Button 인스턴스화 시 전달.

(a) props 타입 변경:

```ts
type ProductCardListProps = {
  items: ProductCardType[];
  // 로그인 유저면 사전 계산된 wishlist productId Set 을 넘겨 N+1 차단.
  // 비로그인이면 undefined → 하트 미노출.
  wishlistIds?: Set<string>;
  wishlistReturnTo?: string;
  // 비로그인 클릭 시 confirm 인터셉트를 위한 prop. heart 노출 시 필수.
  loggedIn?: boolean;
  // 비교 모드: URL state 보존 + 토글 버튼 노출.
  currentCompareIds?: string[];
  showCompareButton?: boolean;
};
```

(b) 함수 시그니처에 `loggedIn` 추가 및 Button 에 전달:

```ts
export function ProductCardList({
  items,
  wishlistIds,
  wishlistReturnTo,
  loggedIn,
  currentCompareIds,
  showCompareButton = true,
}: ProductCardListProps) {
```

(c) heart 합성 분기 — `loggedIn` 도 함께 체크:

```tsx
const inList = wishlistIds?.has(item.id);
const heart =
  wishlistReturnTo !== undefined && inList !== undefined && loggedIn !== undefined ? (
    <WishlistHeartButton
      productId={item.id}
      inWishlist={inList}
      loggedIn={loggedIn}
      returnTo={wishlistReturnTo}
      size="sm"
    />
  ) : undefined;
```

- [x] **Step 2: 타입체크 — `/products/page.tsx` 가 `loggedIn` 안 넘기면 새 prop 은 optional 이라 통과해야 하지만, heart 노출 분기에서 `loggedIn !== undefined` 가드가 추가됐으므로 페이지 수정 전엔 비로그인 화면에서 하트가 사라지는 회귀가 발생할 수 있다. 다음 step에서 페이지를 즉시 수정.**

Run: `npm run typecheck`
Expected: 통과 (호출처 ProductCardList 는 `loggedIn` optional, Button 은 required지만 ProductCardList 내부에서 항상 전달).

- [x] **Step 3: Commit (ProductCardList 단독, 페이지 수정 직전 박제)**

```bash
git add src/widgets/product-card-list/ui/ProductCardList.tsx
git commit -m "feat(product-card-list): pass loggedIn through to WishlistHeartButton"
```

---

### Task 6: `/products/page.tsx` — `loggedIn` 전달

**Files:**
- Modify: `src/app/(site)/products/page.tsx`

- [x] **Step 1: `loggedIn` 계산 후 ProductCardList 에 전달**

`src/app/(site)/products/page.tsx` 의 `<ProductCardList ... />` 호출(현 라인 ~93) 을 다음과 같이 수정:

```tsx
<ProductCardList
  items={items}
  wishlistIds={wishlistIds}
  wishlistReturnTo={wishlistReturnTo}
  loggedIn={!!session?.user?.id}
  currentCompareIds={compareIds}
/>
```

`session` 변수는 이미 페이지 상단(`const session = await auth();`)에서 계산되어 있음. 추가 조회 없음.

- [x] **Step 2: 타입체크**

Run: `npm run typecheck`
Expected: 통과.

- [x] **Step 3: 전체 테스트 실행**

Run: `npm run test`
Expected: 모든 테스트 통과 (위시리스트 영역 회귀 없음).

- [x] **Step 4: Commit**

```bash
git add src/app/(site)/products/page.tsx
git commit -m "feat(products): forward loggedIn to ProductCardList for wishlist confirm UX"
```

---

### Task 7: `WishlistGrid` — `loggedIn={true}` 박제

**Files:**
- Modify: `src/widgets/wishlist-list/ui/WishlistGrid.tsx`

이 페이지(`/mypage`)는 비로그인 진입 시 redirect 로 차단되는 invariant 가 있어 항상 로그인 상태. 그래도 Button prop 은 명시한다(TS2741 해소 + 의도 명확화).

- [x] **Step 1: Button 인스턴스화에 `loggedIn={true}` 추가**

`src/widgets/wishlist-list/ui/WishlistGrid.tsx` 의 `<WishlistHeartButton ... />` 부분 수정:

```tsx
<WishlistHeartButton
  productId={item.productId}
  inWishlist={true}
  loggedIn={true}
  returnTo="/mypage"
  size="sm"
/>
```

- [x] **Step 2: 타입체크 — 모두 통과해야 함 (호출처 마감)**

Run: `npm run typecheck`
Expected: 통과.

- [x] **Step 3: 전체 테스트 실행**

Run: `npm run test`
Expected: 모든 테스트 통과.

- [x] **Step 4: Commit**

```bash
git add src/widgets/wishlist-list/ui/WishlistGrid.tsx
git commit -m "feat(wishlist-list): WishlistGrid hardcodes loggedIn=true (page invariant)"
```

---

### Task 8: 전체 검증 (QA Engineer 게이트) + plan 체크박스 마감

**Files:** (없음 — 검증 전용 step)

- [x] **Step 1: 타입체크 / 테스트 / 린트 일괄 실행**

Run:
```
npm run typecheck
npm run test
npm run lint
```
Expected: 모두 통과.

- [x] **Step 2: 위반 탐지 grep (Plan 체크박스 완전성)**

Run:
```
grep -n "\- \[ \]" docs/superpowers/plans/2026-05-26-wishlist-ux-consistency.md
```
Expected: Task 8 step 1~2 외 모든 항목이 `[x]` 로 갱신됨. (각 Task 종료 직후 §4.1 규칙대로 즉시 체크.)

- [x] **Step 3: 수동 검증 (자동화 불가 — 사용자 또는 dev 환경에서 1회 확인)**

`npm run dev` 후 비로그인 상태(로그아웃 또는 시크릿 창)로:

1. `/products` 진입 → 임의 상품 카드의 하트 클릭
   - 기대: `"로그인 후 이용하실 수 있습니다.\n로그인하시겠습니까?"` confirm
   - 취소 → 상태 변화 없음, navigation 없음
   - 확인 → `/login?callbackUrl=...` 로 이동, callbackUrl 안에 `/api/wishlist/resume?productId=...&returnTo=%2Fproducts...` 포함
   - 로그인 성공 → resume → `/products` 복귀 시 해당 상품 하트가 채워져 있음
2. PDP(`/products/[id]`) 진입 → 동일 흐름 비교 — Island 와 Button 의 confirm 메시지·navigation URL 형식 100% 일치 확인.
3. `/mypage` — 비로그인 진입 시 `/login?callbackUrl=/mypage` 로 redirect 되어 confirm 케이스 없음(invariant). 로그인 후 하트 클릭 → 정상 토글.

- [x] **Step 4: ADR 발행 여부 판단 (스팸 방지)**

이 결정은 ADR-0012/A6 의 일관된 적용에 가까워 신규 ADR 임계점에 미치지 못함. **ADR 발행 안 함.** 보고 시 한 줄로 "ADR 후보로 검토했으나 기존 결정 확장이라 별도 ADR 미발행" 명시.

- [x] **Step 5: 모든 plan 체크박스 grep 재확인**

Run:
```
grep -c "\- \[ \]" docs/superpowers/plans/2026-05-26-wishlist-ux-consistency.md
```
Expected: `0` (모든 항목 완료).

- [x] **Step 6: 최종 commit (변경 없음일 경우 skip)**

체크박스 갱신만 별도 commit 으로 박제:

```bash
git diff docs/superpowers/plans/2026-05-26-wishlist-ux-consistency.md  # 확인
git add docs/superpowers/plans/2026-05-26-wishlist-ux-consistency.md
git commit -m "docs(plans): wishlist UX consistency — mark all tasks done"
```

---

## Definition of Done

- [x]/[ ] 체크박스 grep `- \[ \]` → 0 hits
- `npm run typecheck` / `npm run test` / `npm run lint` 모두 PASS
- PDP Island ↔ Button 의 비로그인 confirm 메시지 · resume URL 형식 100% 일치 (수동 1회 비교 완료)
- `WishlistHeartButton.test.tsx` 6 PASS, `loginPrompt.test.ts` 3 PASS, 기존 Island 9 PASS 회귀 없음
- 커밋 8건(헬퍼·Island·Button RED·Button GREEN·ProductCardList·products page·WishlistGrid·plan mark done)
