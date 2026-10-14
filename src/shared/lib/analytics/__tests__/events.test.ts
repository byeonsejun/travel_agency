import { describe, expect, it } from "vitest";
import {
  GA4_CURRENCY,
  buildAddPaymentInfo,
  buildAddToWishlist,
  buildBeginCheckout,
  buildSearch,
  buildViewItem,
  buildViewItemList,
  toGa4Item,
  type Ga4ItemInput,
} from "../events";

const osaka: Ga4ItemInput = {
  productId: "p1",
  title: "오사카 3박 4일",
  destination: "오사카, 일본",
  unitPrice: 890000,
};
const danang: Ga4ItemInput = {
  productId: "p2",
  title: "다낭 4박 5일",
  destination: "다낭, 베트남",
  unitPrice: 650000,
  quantity: 2,
};

describe("toGa4Item", () => {
  it("GA4 item 스키마로 매핑하고 quantity 기본값은 1", () => {
    expect(toGa4Item(osaka)).toEqual({
      item_id: "p1",
      item_name: "오사카 3박 4일",
      item_category: "일본",
      price: 890000,
      quantity: 1,
    });
  });

  it("item_category 는 destination 의 국가 suffix (콤마 없으면 전체)", () => {
    expect(toGa4Item({ ...osaka, destination: "스위스" }).item_category).toBe("스위스");
    expect(toGa4Item({ ...osaka, destination: " 파리 , 프랑스 " }).item_category).toBe("프랑스");
  });

  it("금액이 정수(원)가 아니면 throw — float 금액 금지(§5 Domain Booking)", () => {
    expect(() => toGa4Item({ ...osaka, unitPrice: 890000.5 })).toThrow(RangeError);
    expect(() => toGa4Item({ ...osaka, unitPrice: -1 })).toThrow(RangeError);
  });

  it("quantity 가 양의 정수가 아니면 throw", () => {
    expect(() => toGa4Item({ ...osaka, quantity: 0 })).toThrow(RangeError);
    expect(() => toGa4Item({ ...osaka, quantity: 1.5 })).toThrow(RangeError);
  });

  it("PII 가드 — 입력에 섞인 email/name 등은 출력에 절대 복사되지 않는다(화이트리스트 매핑)", () => {
    const polluted = { ...osaka, email: "user@example.com", name: "홍길동" };
    const item = toGa4Item(polluted);
    expect(Object.keys(item).sort()).toEqual(
      ["item_category", "item_id", "item_name", "price", "quantity"].sort(),
    );
    expect(JSON.stringify(item)).not.toContain("example.com");
  });
});

describe("ecommerce 이벤트 빌더", () => {
  it("view_item_list — item_list_name + index 부여, 입력 배열 비변이", () => {
    const input = [osaka, danang];
    const snapshot = JSON.stringify(input);
    const ev = buildViewItemList("search", input);
    expect(ev.event).toBe("view_item_list");
    expect(ev.ecommerce.item_list_name).toBe("search");
    expect(ev.ecommerce.items.map((i) => i.index)).toEqual([0, 1]);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("view_item — currency KRW, value = price × quantity", () => {
    const ev = buildViewItem(osaka);
    expect(ev).toEqual({
      event: "view_item",
      ecommerce: { currency: GA4_CURRENCY, value: 890000, items: [toGa4Item(osaka)] },
    });
  });

  it("add_to_wishlist — view_item 과 동일 형태, 이벤트명만 다름", () => {
    const ev = buildAddToWishlist(osaka);
    expect(ev.event).toBe("add_to_wishlist");
    expect(ev.ecommerce.value).toBe(890000);
  });

  it("begin_checkout — value 는 Σ price×quantity (정수)", () => {
    const ev = buildBeginCheckout([osaka, danang]);
    expect(ev.event).toBe("begin_checkout");
    expect(ev.ecommerce.value).toBe(890000 + 650000 * 2);
    expect(Number.isInteger(ev.ecommerce.value)).toBe(true);
  });

  it("add_payment_info — 서버 확정 금액(value) 우선 + payment_type", () => {
    const ev = buildAddPaymentInfo([danang], { value: 1250000, paymentType: "toss" });
    expect(ev.event).toBe("add_payment_info");
    expect(ev.ecommerce.value).toBe(1250000);
    expect(ev.ecommerce.payment_type).toBe("toss");
  });

  it("add_payment_info — 서버 금액이 정수가 아니면 throw", () => {
    expect(() => buildAddPaymentInfo([danang], { value: 10.5, paymentType: "toss" })).toThrow(
      RangeError,
    );
  });
});

describe("buildSearch", () => {
  it("공백 정규화 + trim", () => {
    expect(buildSearch("  오사카   온천  ")).toEqual({ event: "search", search_term: "오사카 온천" });
  });

  it("100자 초과는 잘라낸다", () => {
    expect(buildSearch("가".repeat(150))?.search_term).toHaveLength(100);
  });

  it("빈 검색어는 null (이벤트 미발화)", () => {
    expect(buildSearch("   ")).toBeNull();
  });
});

describe("toGa4Item — item_variant (인원 유형 구분)", () => {
  it("variant 지정 시 item_variant 로 매핑", () => {
    expect(toGa4Item({ ...osaka, variant: "child" }).item_variant).toBe("child");
  });

  it("variant 미지정 시 item_variant 키 자체가 없다(undefined 키 금지)", () => {
    expect("item_variant" in toGa4Item(osaka)).toBe(false);
  });
});
