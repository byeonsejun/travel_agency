import type { Ga4ItemInput } from "@/shared/lib/analytics";

/**
 * 상품 → GA4 item 입력 매핑 (ADR-0062). 목록 카드·검색 결과·PDP 공용.
 * 가격은 실제 출발일 최저가(lowestPrice) 우선, 없으면 노출용 시작가(basePriceAdult).
 * 구조적 타입으로 받아 ProductCard / ProductDetail 양쪽에 그대로 쓴다.
 */
export function toGa4ItemInput(product: {
  id: string;
  title: string;
  destination: string;
  basePriceAdult: number;
  lowestPrice?: number | null;
}): Ga4ItemInput {
  return {
    productId: product.id,
    title: product.title,
    destination: product.destination,
    unitPrice: product.lowestPrice ?? product.basePriceAdult,
  };
}
