import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act, StrictMode } from "react";
import type { Root } from "react-dom/client";
import type { Ga4EventPayload } from "@/shared/lib/analytics";

const mocks = vi.hoisted(() => ({ trackEvent: vi.fn() }));

vi.mock("@/shared/lib/analytics", () => ({ trackEvent: mocks.trackEvent }));

import { TrackEvent } from "../TrackEvent";

const viewA: Ga4EventPayload = {
  event: "view_item",
  ecommerce: {
    currency: "KRW",
    value: 1000,
    items: [{ item_id: "A", item_name: "A", item_category: "일본", price: 1000, quantity: 1 }],
  },
};
const viewB: Ga4EventPayload = {
  ...viewA,
  ecommerce: { ...viewA.ecommerce, items: [{ ...viewA.ecommerce.items[0], item_id: "B" }] },
};

describe("<TrackEvent />", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.trackEvent.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("mount 시 trackEvent 를 정확히 1회 호출하고 DOM 은 렌더하지 않는다", () => {
    act(() => root.render(<TrackEvent payload={viewA} dedupeKey="A" />));
    expect(mocks.trackEvent).toHaveBeenCalledTimes(1);
    expect(mocks.trackEvent).toHaveBeenCalledWith(viewA);
    expect(container.innerHTML).toBe("");
  });

  it("StrictMode 이중 effect 에서도 1회만 호출 (ref 가드)", () => {
    act(() =>
      root.render(
        <StrictMode>
          <TrackEvent payload={viewA} dedupeKey="A" />
        </StrictMode>,
      ),
    );
    expect(mocks.trackEvent).toHaveBeenCalledTimes(1);
  });

  it("같은 dedupeKey 로 리렌더(새 payload 객체 identity 포함)되면 재호출하지 않는다", () => {
    act(() => root.render(<TrackEvent payload={viewA} dedupeKey="A" />));
    act(() => root.render(<TrackEvent payload={{ ...viewA }} dedupeKey="A" />));
    expect(mocks.trackEvent).toHaveBeenCalledTimes(1);
  });

  it("dedupeKey 가 바뀌면(다른 상품으로 client 이동) 새 payload 로 재호출한다", () => {
    act(() => root.render(<TrackEvent payload={viewA} dedupeKey="A" />));
    act(() => root.render(<TrackEvent payload={viewB} dedupeKey="B" />));
    expect(mocks.trackEvent).toHaveBeenCalledTimes(2);
    expect(mocks.trackEvent).toHaveBeenLastCalledWith(viewB);
  });
});
