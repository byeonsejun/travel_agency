import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

const mocks = vi.hoisted(() => ({ routerPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.routerPush }),
  useSearchParams: () => new URLSearchParams("destination=JP&page=3"),
}));

import { SortSelect } from "../SortSelect";

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  mocks.routerPush.mockReset();
});

describe("<SortSelect />", () => {
  it("정렬 변경 시 page 를 버리고 destination 을 보존한 채 router.push 한다", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<SortSelect current="latest" />);
    });

    const select = container.querySelector("select")!;
    act(() => {
      select.value = "price_asc";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(mocks.routerPush).toHaveBeenCalledTimes(1);
    const url = mocks.routerPush.mock.calls[0][0] as string;
    expect(url).toContain("sort=price_asc");
    expect(url).toContain("destination=JP");
    expect(url).not.toContain("page=");
  });
});
