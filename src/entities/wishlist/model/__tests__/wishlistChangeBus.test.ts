import { describe, it, expect, vi, afterEach } from "vitest";
import {
  dispatchWishlistChanged,
  subscribeWishlistChanged,
  WISHLIST_CHANGED_EVENT,
} from "../wishlistChangeBus";

describe("wishlistChangeBus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("WISHLIST_CHANGED_EVENT 상수: 'wishlist-changed'", () => {
    expect(WISHLIST_CHANGED_EVENT).toBe("wishlist-changed");
  });

  it("subscribe → dispatch → handler 호출", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeWishlistChanged(handler);

    dispatchWishlistChanged();
    expect(handler).toHaveBeenCalledOnce();

    dispatchWishlistChanged();
    expect(handler).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it("unsubscribe 후 dispatch 는 handler 미호출", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeWishlistChanged(handler);

    dispatchWishlistChanged();
    expect(handler).toHaveBeenCalledOnce();

    unsubscribe();
    dispatchWishlistChanged();
    expect(handler).toHaveBeenCalledOnce(); // 추가 호출 없음
  });

  it("여러 구독자: 각각 호출", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeWishlistChanged(a);
    const unsubB = subscribeWishlistChanged(b);

    dispatchWishlistChanged();
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();

    unsubA();
    unsubB();
  });

  it("SSR safety: window 가 없어도 throw 하지 않음", () => {
    const originalWindow = global.window;
    // @ts-expect-error - delete global window for SSR simulation
    delete global.window;

    expect(() => dispatchWishlistChanged()).not.toThrow();
    expect(() => {
      const unsub = subscribeWishlistChanged(() => {});
      unsub();
    }).not.toThrow();

    global.window = originalWindow;
  });
});
