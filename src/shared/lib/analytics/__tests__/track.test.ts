import { afterEach, describe, expect, it, vi } from "vitest";
import { trackEvent } from "../track";
import { buildSearch, buildViewItem } from "../events";

type DLWindow = Window & { dataLayer?: object[] };

afterEach(() => {
  vi.unstubAllGlobals(); // window 복원이 먼저 — SSR 케이스가 window 를 undefined 로 stub
  delete (window as DLWindow).dataLayer;
});

const item = { productId: "p1", title: "오사카", destination: "오사카, 일본", unitPrice: 1000 };

describe("trackEvent", () => {
  it("dataLayer 가 없으면 생성 후 push", () => {
    const search = buildSearch("오사카");
    if (!search) throw new Error("unreachable");
    trackEvent(search);
    expect((window as DLWindow).dataLayer).toEqual([{ event: "search", search_term: "오사카" }]);
  });

  it("ecommerce 이벤트는 직전에 { ecommerce: null } 로 이전 객체를 비운다(GA4 권장)", () => {
    trackEvent(buildViewItem(item));
    const dl = (window as DLWindow).dataLayer ?? [];
    expect(dl).toHaveLength(2);
    expect(dl[0]).toEqual({ ecommerce: null });
    expect(dl[1]).toMatchObject({ event: "view_item" });
  });

  it("기존 dataLayer(GTM 이 만든 배열)를 교체하지 않고 이어서 push", () => {
    const existing: object[] = [{ event: "gtm.js" }];
    (window as DLWindow).dataLayer = existing;
    trackEvent(buildViewItem(item));
    expect((window as DLWindow).dataLayer).toBe(existing);
    expect(existing).toHaveLength(3);
  });

  it("SSR(window 없음)에서는 no-op — throw 하지 않는다", () => {
    vi.stubGlobal("window", undefined);
    expect(() => trackEvent(buildViewItem(item))).not.toThrow();
  });
});
