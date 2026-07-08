import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// 타이머 콜백에서 발생하는 state 업데이트를 act 로 감싸기 위한 플래그.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mocks = vi.hoisted(() => ({ pathname: "/products", search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

import { NavigationLoadingOverlay } from "../NavigationLoadingOverlay";

let root: Root | null = null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
  mocks.pathname = "/products";
  mocks.search = "";
});

function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<NavigationLoadingOverlay />));
  return container;
}

function rerender() {
  act(() => root!.render(<NavigationLoadingOverlay />));
}

function clickAnchor(href: string) {
  const a = document.createElement("a");
  a.setAttribute("href", href);
  document.body.appendChild(a);
  act(() => {
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
  });
  a.remove();
}

function overlay() {
  return document.querySelector('[role="status"]');
}

describe("<NavigationLoadingOverlay />", () => {
  it("초기엔 오버레이를 렌더하지 않는다", () => {
    render();
    expect(overlay()).toBeNull();
  });

  it("내부 링크 클릭 후 400ms 이전엔 안 뜨고, 400ms 경과 시 오버레이가 뜬다", () => {
    render();
    clickAnchor("/products/abc123");
    act(() => vi.advanceTimersByTime(399));
    expect(overlay()).toBeNull(); // 순간 이동 스킵 threshold

    act(() => vi.advanceTimersByTime(1));
    expect(overlay()).not.toBeNull();
    expect(overlay()?.getAttribute("aria-live")).toBe("polite");
  });

  it("400ms 이전에 이동이 완료되는 빠른 네비는 오버레이를 띄우지 않는다", () => {
    render();
    clickAnchor("/products/abc123");
    act(() => vi.advanceTimersByTime(200));
    // URL 커밋(pathname 변화) = 이동 완료
    mocks.pathname = "/products/abc123";
    rerender();
    act(() => vi.advanceTimersByTime(500));
    expect(overlay()).toBeNull();
  });

  it("오버레이가 뜬 뒤 이동이 완료되면 즉시 사라진다", () => {
    render();
    clickAnchor("/products/abc123");
    act(() => vi.advanceTimersByTime(400));
    expect(overlay()).not.toBeNull();

    mocks.pathname = "/products/abc123";
    rerender();
    expect(overlay()).toBeNull();
  });

  it("이동이 끝내 완료되지 않아도 8s 후 자동 해제된다", () => {
    render();
    clickAnchor("/products/abc123");
    act(() => vi.advanceTimersByTime(400));
    expect(overlay()).not.toBeNull();

    act(() => vi.advanceTimersByTime(8000));
    expect(overlay()).toBeNull();
  });

  it("현재 URL과 동일한 링크·외부 링크는 오버레이를 띄우지 않는다", () => {
    render();
    clickAnchor("/products");
    clickAnchor("https://example.com");
    act(() => vi.advanceTimersByTime(1000));
    expect(overlay()).toBeNull();
  });
});
