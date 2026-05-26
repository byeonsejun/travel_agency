import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { Root } from "react-dom/client";

// ── vi.hoisted: vi.mock factory 실행 전 mocks 객체 확보 ─────────────
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

import { WishlistHeartIsland } from "../WishlistHeartIsland";

const PRODUCT_ID = "clfake000000000000000001";
const PRODUCT_ID_2 = "clfake000000000000000002";

describe("<WishlistHeartIsland />", () => {
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

  function makeFetch(inWishlist: boolean, loggedIn = true) {
    return vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ inWishlist, loggedIn }),
    });
  }

  // ── (a) mount 시 1회 fetch ────────────────────────────────────────
  it("(a) mount 시 /api/wishlist/check?productId=... 를 1회 호출", async () => {
    const fetchMock = makeFetch(false);
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <WishlistHeartIsland productId={PRODUCT_ID} returnTo="/products/test" />,
      );
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/wishlist/check?productId=${PRODUCT_ID}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  // ── (b) inWishlist:true → aria-pressed="true" ─────────────────────
  it("(b) inWishlist:true 응답 → button aria-pressed=true 로 전환", async () => {
    vi.stubGlobal("fetch", makeFetch(true));

    await act(async () => {
      root = createRoot(container);
      root.render(
        <WishlistHeartIsland productId={PRODUCT_ID} returnTo="/products/test" />,
      );
    });

    const btn = container.querySelector("button");
    expect(btn?.getAttribute("aria-pressed")).toBe("true");
  });

  // ── (c) inWishlist:false → aria-pressed="false" 유지 ─────────────
  it("(c) inWishlist:false 응답 → button aria-pressed=false 유지", async () => {
    vi.stubGlobal("fetch", makeFetch(false));

    await act(async () => {
      root = createRoot(container);
      root.render(
        <WishlistHeartIsland productId={PRODUCT_ID} returnTo="/products/test" />,
      );
    });

    const btn = container.querySelector("button");
    expect(btn?.getAttribute("aria-pressed")).toBe("false");
  });

  // ── (d) unmount → AbortController.abort() 호출 ───────────────────
  it("(d) unmount 시 AbortController.abort() 호출 → in-flight 요청 취소", async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    // fetch 가 영원히 pending 상태 → unmount 시 abort 여부 검증
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    await act(async () => {
      root = createRoot(container);
      root.render(
        <WishlistHeartIsland productId={PRODUCT_ID} returnTo="/products/test" />,
      );
    });

    expect(abortSpy).not.toHaveBeenCalled();

    await act(async () => {
      root!.unmount();
    });
    root = null; // afterEach 이중 unmount 방지

    expect(abortSpy).toHaveBeenCalledOnce();
  });

  // ── (e) productId 변경 → 이전 abort + 신규 fetch ─────────────────
  it("(e) productId 변경 시 이전 요청 abort 후 신규 fetch 호출", async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    const fetchMock = makeFetch(false);
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <WishlistHeartIsland productId={PRODUCT_ID} returnTo="/products/test" />,
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      root!.render(
        <WishlistHeartIsland productId={PRODUCT_ID_2} returnTo="/products/test" />,
      );
    });

    expect(abortSpy).toHaveBeenCalledOnce(); // 이전 effect cleanup
    expect(fetchMock).toHaveBeenCalledTimes(2); // 신규 fetch
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/wishlist/check?productId=${PRODUCT_ID_2}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  // ── (f) 비로그인 + 클릭 → window.confirm 호출 ────────────────────
  it("(f) 비로그인 + 클릭 시 window.confirm 안내 노출", async () => {
    vi.stubGlobal("fetch", makeFetch(false, false));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <WishlistHeartIsland productId={PRODUCT_ID} returnTo="/products/test" />,
      );
    });

    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(confirmSpy.mock.calls[0][0]).toContain("로그인");
  });

  // ── (g) 비로그인 + confirm 확인 → /login 으로 router.push ─────────
  it("(g) 비로그인 + confirm 확인 시 /login?callbackUrl=resume URL 로 navigation", async () => {
    vi.stubGlobal("fetch", makeFetch(false, false));
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <WishlistHeartIsland productId={PRODUCT_ID} returnTo="/products/test" />,
      );
    });

    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(mocks.routerPush).toHaveBeenCalledOnce();
    const pushedUrl = mocks.routerPush.mock.calls[0][0] as string;
    expect(pushedUrl).toMatch(/^\/login\?callbackUrl=/);
    // callbackUrl 안에 resume endpoint + productId + returnTo 가 인코딩되어 있어야 함
    const decoded = decodeURIComponent(pushedUrl.split("callbackUrl=")[1]);
    expect(decoded).toContain("/api/wishlist/resume");
    expect(decoded).toContain(`productId=${PRODUCT_ID}`);
    expect(decoded).toContain("returnTo=%2Fproducts%2Ftest");
    // server action 은 호출되지 않아야 함
    expect(mocks.toggleWishlistAction).not.toHaveBeenCalled();
  });

  // ── (h) 비로그인 + confirm 취소 → 아무 navigation 없음 ──────────
  it("(h) 비로그인 + confirm 취소 시 navigation + server action 모두 없음", async () => {
    vi.stubGlobal("fetch", makeFetch(false, false));
    vi.spyOn(window, "confirm").mockReturnValue(false);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <WishlistHeartIsland productId={PRODUCT_ID} returnTo="/products/test" />,
      );
    });

    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(mocks.routerPush).not.toHaveBeenCalled();
    expect(mocks.toggleWishlistAction).not.toHaveBeenCalled();
  });

  // ── (i) 로그인 + 클릭 → confirm 미호출 + server action 호출 ────────
  it("(i) 로그인 상태 클릭 → confirm 미호출, toggleWishlistAction 호출", async () => {
    vi.stubGlobal("fetch", makeFetch(false, true));
    const confirmSpy = vi.spyOn(window, "confirm");

    await act(async () => {
      root = createRoot(container);
      root.render(
        <WishlistHeartIsland productId={PRODUCT_ID} returnTo="/products/test" />,
      );
    });

    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mocks.routerPush).not.toHaveBeenCalled();
    expect(mocks.toggleWishlistAction).toHaveBeenCalledOnce();
  });
});
