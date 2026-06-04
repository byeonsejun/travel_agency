import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

const mocks = vi.hoisted(() => ({ routerPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.routerPush }),
}));

import { SearchBox } from "../SearchBox";

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  mocks.routerPush.mockReset();
});

function submit(container: HTMLElement, value: string) {
  const input = container.querySelector(
    "input[name='q']",
  ) as HTMLInputElement;
  input.value = value;
  const form = container.querySelector("form")!;
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("<SearchBox />", () => {
  it("질의를 URL 인코딩해 /search 로 push 한다", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<SearchBox />));

    submit(container, "온천 3박");

    expect(mocks.routerPush).toHaveBeenCalledTimes(1);
    expect(mocks.routerPush.mock.calls[0][0]).toBe(
      `/search?q=${encodeURIComponent("온천 3박")}`,
    );
  });

  it("빈 질의는 push 하지 않는다", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<SearchBox />));

    submit(container, "   ");

    expect(mocks.routerPush).not.toHaveBeenCalled();
  });
});
