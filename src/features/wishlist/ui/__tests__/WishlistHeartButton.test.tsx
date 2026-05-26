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
