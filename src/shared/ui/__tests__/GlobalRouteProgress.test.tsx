import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

const mocks = vi.hoisted(() => ({ pathname: "/products", search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

import { GlobalRouteProgress } from "../GlobalRouteProgress";

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  mocks.pathname = "/products";
  mocks.search = "";
});

function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<GlobalRouteProgress />));
  return container;
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

describe("<GlobalRouteProgress />", () => {
  it("초기엔 진행 바를 렌더하지 않는다", () => {
    render();
    expect(document.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("내부 링크(/...) 클릭 시 상단 진행 바를 표시한다", () => {
    render();
    clickAnchor("/products/abc123");
    const bar = document.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.className).toContain("fixed");
  });

  it("현재 URL과 동일한 링크 클릭은 진행 바를 띄우지 않는다", () => {
    render();
    clickAnchor("/products");
    expect(document.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("외부 링크(http) 클릭은 진행 바를 띄우지 않는다", () => {
    render();
    clickAnchor("https://example.com");
    expect(document.querySelector('[role="progressbar"]')).toBeNull();
  });
});
