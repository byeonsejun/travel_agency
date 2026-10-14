/**
 * GA4 전자상거래 이벤트 스키마 SSOT (ADR-0062).
 *
 * ⚠️ client-safe 순수 모듈 — `'use client'` island 가 import 한다.
 *    `@/shared/lib/env`·`db`·`server-only`·entities import 금지(브라우저 ZodError /
 *    서버 그래프 누출). 입력은 plain 객체만 받는다.
 *
 * PII 가드: 출력은 화이트리스트 필드만 명시 매핑한다(스프레드 금지) — 입력에 email·이름이
 * 섞여도 GA4 로 새지 않는다. 금액은 정수(원)만 허용(§5 Domain Booking).
 */

export const GA4_CURRENCY = "KRW" as const;

const SEARCH_TERM_MAX = 100;

export interface Ga4ItemInput {
  productId: string;
  title: string;
  /** "도시, 국가" 포맷 (예: "오사카, 일본"). */
  destination: string;
  /** 1인 단가 — 원 단위 정수. */
  unitPrice: number;
  /** 인원 수. 기본 1. */
  quantity?: number;
}

export interface Ga4Item {
  item_id: string;
  item_name: string;
  item_category: string;
  price: number;
  quantity: number;
  index?: number;
}

interface Ga4ValuedEcommerce {
  currency: typeof GA4_CURRENCY;
  value: number;
  items: Ga4Item[];
}

export interface Ga4ViewItemListEvent {
  event: "view_item_list";
  ecommerce: { item_list_name: string; items: Ga4Item[] };
}

export interface Ga4ValuedEvent {
  event: "view_item" | "add_to_wishlist" | "begin_checkout";
  ecommerce: Ga4ValuedEcommerce;
}

export interface Ga4AddPaymentInfoEvent {
  event: "add_payment_info";
  ecommerce: Ga4ValuedEcommerce & { payment_type: string };
}

export interface Ga4SearchEvent {
  event: "search";
  search_term: string;
}

export type Ga4EcommerceEvent = Ga4ViewItemListEvent | Ga4ValuedEvent | Ga4AddPaymentInfoEvent;
export type Ga4EventPayload = Ga4EcommerceEvent | Ga4SearchEvent;

function assertWon(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} 는 0 이상의 정수(원)여야 합니다: ${value}`);
  }
}

/**
 * destination "도시, 국가" → 국가. 콤마가 없으면 전체 문자열.
 * SSOT 규칙은 `widgets/home-region-deals/model/filterByRegion.ts#regionOf` —
 * shared 는 widgets 를 import 할 수 없어(FSD 단방향) 동일 규칙을 미러한다. 한쪽 수정 시 양쪽 갱신.
 */
function categoryOf(destination: string): string {
  const parts = destination.split(",");
  return parts[parts.length - 1].trim();
}

export function toGa4Item(input: Ga4ItemInput): Ga4Item {
  const quantity = input.quantity ?? 1;
  assertWon(input.unitPrice, "unitPrice");
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError(`quantity 는 1 이상의 정수여야 합니다: ${quantity}`);
  }
  return {
    item_id: input.productId,
    item_name: input.title,
    item_category: categoryOf(input.destination),
    price: input.unitPrice,
    quantity,
  };
}

function sumValue(items: readonly Ga4Item[]): number {
  return items.reduce((acc, i) => acc + i.price * i.quantity, 0);
}

function valued(inputs: readonly Ga4ItemInput[]): Ga4ValuedEcommerce {
  const items = inputs.map(toGa4Item);
  return { currency: GA4_CURRENCY, value: sumValue(items), items };
}

/** 목록 노출. GA4 스펙상 view_item_list 는 value/currency 를 받지 않는다. */
export function buildViewItemList(
  listName: string,
  inputs: readonly Ga4ItemInput[],
): Ga4ViewItemListEvent {
  return {
    event: "view_item_list",
    ecommerce: {
      item_list_name: listName,
      items: inputs.map((input, index) => ({ ...toGa4Item(input), index })),
    },
  };
}

export function buildViewItem(input: Ga4ItemInput): Ga4ValuedEvent {
  return { event: "view_item", ecommerce: valued([input]) };
}

export function buildAddToWishlist(input: Ga4ItemInput): Ga4ValuedEvent {
  return { event: "add_to_wishlist", ecommerce: valued([input]) };
}

export function buildBeginCheckout(inputs: readonly Ga4ItemInput[]): Ga4ValuedEvent {
  return { event: "begin_checkout", ecommerce: valued(inputs) };
}

/**
 * 결제 수단 진입. value 는 클라이언트 합산이 아니라 **서버가 재계산해 반환한 금액**을
 * 쓴다(유아 요금·할인 등 클라이언트가 모르는 가격 규칙 반영).
 */
export function buildAddPaymentInfo(
  inputs: readonly Ga4ItemInput[],
  opts: { value: number; paymentType: string },
): Ga4AddPaymentInfoEvent {
  assertWon(opts.value, "value");
  return {
    event: "add_payment_info",
    ecommerce: { ...valued(inputs), value: opts.value, payment_type: opts.paymentType },
  };
}

/** 빈 검색어면 null(이벤트 미발화). 공백 정규화 + 길이 상한. */
export function buildSearch(rawTerm: string): Ga4SearchEvent | null {
  const term = rawTerm.trim().replace(/\s+/g, " ").slice(0, SEARCH_TERM_MAX);
  return term ? { event: "search", search_term: term } : null;
}
