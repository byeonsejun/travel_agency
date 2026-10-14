import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { Root } from "react-dom/client";

// vi.hoisted: vi.mock factory 실행 전 mocks 객체 확보
const mocks = vi.hoisted(() => ({
  toggleWishlistAction: vi.fn(),
  routerPush: vi.fn(),
  routerRefresh: vi.fn(),
  dispatchWishlistChanged: vi.fn(),
}));

vi.mock("@/features/wishlist/server/actions", () => ({
  toggleWishlistAction: mocks.toggleWishlistAction,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.routerPush,
    refresh: mocks.routerRefresh,
  }),
}));

vi.mock("@/entities/wishlist", () => ({
  dispatchWishlistChanged: mocks.dispatchWishlistChanged,
}));


// GA4 add_to_wishlist 검증용 — 빌더는 실물, dataLayer push 만 spy (ADR-0062).
const analyticsMocks = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock("@/shared/lib/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/lib/analytics")>()),
  trackEvent: analyticsMocks.trackEvent,
}));

import { WishlistHeartButton } from "../WishlistHeartButton";

const PRODUCT_ID = "clfake000000000000000001";
const RETURN_TO = "/products?page=2";
const ANALYTICS_ITEM = { productId: PRODUCT_ID, title: "오사카", destination: "오사카, 일본", unitPrice: 890000 };

describe("<WishlistHeartButton />", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    mocks.toggleWishlistAction.mockReset();
    mocks.toggleWishlistAction.mockResolvedValue(undefined);
    mocks.routerPush.mockReset();
    mocks.routerRefresh.mockReset();
    mocks.dispatchWishlistChanged.mockReset();
    analyticsMocks.trackEvent.mockReset();
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
    withAnalytics?: boolean;
  }) {
    return act(async () => {
      root = createRoot(container);
      root.render(
        <WishlistHeartButton
          productId={props.productId ?? PRODUCT_ID}
          inWishlist={props.inWishlist}
          loggedIn={props.loggedIn}
          returnTo={props.returnTo ?? RETURN_TO}
          analyticsItem={props.withAnalytics ? ANALYTICS_ITEM : undefined}
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

  // (g) 클릭 시 즉시 aria-pressed 가 토글되어야 함 (optimistic, no flicker)
  it("(g) loggedIn=true 클릭 → aria-pressed 가 즉시 토글 (false→true), 액션 완료 후에도 유지", async () => {
    await render({ loggedIn: true, inWishlist: false });
    expect(container.querySelector("button")?.getAttribute("aria-pressed")).toBe("false");

    await submitForm();
    // optimistic 적용 후
    expect(container.querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
  });

  // (h) 액션 완료 후 dispatchWishlistChanged + router.refresh 호출 (헤더 카운트 동기화)
  it("(h) loggedIn=true 클릭 → 액션 await 후 router.refresh + dispatchWishlistChanged 호출", async () => {
    await render({ loggedIn: true, inWishlist: false });
    await submitForm();

    expect(mocks.toggleWishlistAction).toHaveBeenCalledOnce();
    expect(mocks.routerRefresh).toHaveBeenCalledOnce();
    expect(mocks.dispatchWishlistChanged).toHaveBeenCalledOnce();
  });

  // (i) inWishlist prop 이 외부에서 변경되면 displayed 상태 동기화
  it("(i) inWishlist prop 변경 시 aria-pressed 자동 동기화", async () => {
    await render({ loggedIn: true, inWishlist: false });
    expect(container.querySelector("button")?.getAttribute("aria-pressed")).toBe("false");

    // prop 변경을 시뮬레이션: 같은 root 에 다시 render
    await act(async () => {
      root!.render(
        <WishlistHeartButton
          productId={PRODUCT_ID}
          inWishlist={true}
          loggedIn={true}
          returnTo={RETURN_TO}
        />,
      );
    });
    expect(container.querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
  });
  // ── GA4 add_to_wishlist (ADR-0062) ─────────────────────────────────
  it("(ga-1) 찜 추가(false→true) 액션 완료 후 add_to_wishlist 1회 push", async () => {
    await render({ loggedIn: true, inWishlist: false, withAnalytics: true });
    await submitForm();
    expect(analyticsMocks.trackEvent).toHaveBeenCalledOnce();
    expect(analyticsMocks.trackEvent.mock.calls[0][0]).toMatchObject({
      event: "add_to_wishlist",
      ecommerce: { currency: "KRW", value: 890000 },
    });
  });

  it("(ga-2) 찜 해제(true→false)는 이벤트 미발화", async () => {
    await render({ loggedIn: true, inWishlist: true, withAnalytics: true });
    await submitForm();
    expect(analyticsMocks.trackEvent).not.toHaveBeenCalled();
  });

  it("(ga-3) analyticsItem 미주입 시 추가해도 이벤트 미발화(옵트인)", async () => {
    await render({ loggedIn: true, inWishlist: false });
    await submitForm();
    expect(analyticsMocks.trackEvent).not.toHaveBeenCalled();
  });
});
