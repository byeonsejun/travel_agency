import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

import { CompassLoader } from "../CompassLoader";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

describe("<CompassLoader />", () => {
  it("접근성 role/aria 와 안내 문구를 렌더한다", () => {
    const c = render(<CompassLoader />);
    const status = c.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.getAttribute("aria-label")).toBe("페이지를 불러오는 중입니다");
    expect(c.textContent).toContain("잠시만 기다려주세요");
    expect(c.textContent).toContain("페이지를 불러오는 중입니다");
  });

  it("나침반은 reduced-motion 에서 회전을 멈추는 클래스를 가진다", () => {
    const c = render(<CompassLoader />);
    const spinner = c.querySelector(".animate-spin");
    expect(spinner).not.toBeNull();
    expect(spinner?.className).toContain("motion-reduce:animate-none");
  });

  it("className 을 루트에 덧붙인다(1단계 진입 페이드용)", () => {
    const c = render(<CompassLoader className="animate-in fade-in" />);
    const status = c.querySelector('[role="status"]');
    expect(status?.className).toContain("animate-in");
    expect(status?.className).toContain("fade-in");
  });
});
