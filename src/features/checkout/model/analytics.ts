import type { Ga4ItemInput } from "@/shared/lib/analytics";

export type CheckoutAnalyticsBase = Pick<Ga4ItemInput, "productId" | "title" | "destination">;

/**
 * 인원 유형별 GA4 item (ADR-0062). 같은 상품을 성인/아동/유아 단가로 나눠 item_variant 로 구분 —
 * 합계가 서버 가격 공식(Σ 단가×인원, entities/booking computeTotalPrice)과 일치한다.
 * 인원 0 인 유형은 제외.
 */
export function buildPaxItems(
  base: CheckoutAnalyticsBase,
  prices: { priceAdult: number; priceChild: number; priceInfant: number },
  counts: { adult: number; child: number; infant: number },
): Ga4ItemInput[] {
  const rows = [
    { variant: "adult", unitPrice: prices.priceAdult, quantity: counts.adult },
    { variant: "child", unitPrice: prices.priceChild, quantity: counts.child },
    { variant: "infant", unitPrice: prices.priceInfant, quantity: counts.infant },
  ];
  return rows.filter((r) => r.quantity > 0).map((r) => ({ ...base, ...r }));
}
