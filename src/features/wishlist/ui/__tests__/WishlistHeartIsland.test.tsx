import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { Root } from "react-dom/client";

// ── vi.hoisted: vi.mock factory 실행 전 mocks 객체 확보 ─────────────
const mocks = vi.hoisted(() => ({
  toggleWishlistAction: vi.fn(),
}));

vi.mock("@/features/wishlist/server/actions", () => ({
  toggleWishlistAction: mocks.toggleWishlistAction,
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

  function makeFetch(inWishlist: boolean) {
    return vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ inWishlist }),
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
});
