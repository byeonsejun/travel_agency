import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

const mocks = vi.hoisted(() => ({ pending: false }));

vi.mock("next/link", () => ({
  useLinkStatus: () => ({ pending: mocks.pending }),
}));

import { RouteProgress } from "../RouteProgress";

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  mocks.pending = false;
});

function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<RouteProgress />));
  return container;
}

describe("<RouteProgress />", () => {
  it("pending=false 면 진행 바를 렌더하지 않는다", () => {
    mocks.pending = false;
    const c = render();
    expect(c.querySelector("[role='progressbar']")).toBeNull();
  });

  it("pending=true 면 fixed 상단 진행 바를 렌더한다", () => {
    mocks.pending = true;
    const c = render();
    const bar = c.querySelector("[role='progressbar']") as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.className).toContain("fixed");
  });
});
