import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { Skeleton } from "../Skeleton";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("<Skeleton />", () => {
  it("애니메이션 펄스 클래스 + 전달된 className 을 함께 렌더한다", () => {
    const container = document.createElement("div");
    root = createRoot(container);
    act(() => {
      root!.render(<Skeleton className="h-4 w-1/2" />);
    });
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("animate-pulse");
    expect(el.className).toContain("h-4");
    expect(el.getAttribute("aria-hidden")).toBe("true");
  });
});
