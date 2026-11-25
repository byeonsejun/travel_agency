import type { ProductDetail } from "@/entities/product";
import type { DepartureSummary } from "@/entities/departure";
import { absoluteUrl } from "@/shared/lib/seo";

// 화면 출발일 목록(DepartureList)의 마감 표시와 같은 규칙.
function isBookable(departure: DepartureSummary): boolean {
  return departure.status !== "CLOSED" && departure.remainingSeats > 0;
}

// 화면에 보이는 값만 쓴다: "AI 추천 포인트"(aiSummary), 지역, 일정, 기준가.
// 공개 화면에 나오지 않는 summary 컬럼은 쓰지 않는다.
export function buildProductDescription(product: ProductDetail): string {
  const aiSummary = product.aiSummary?.replace(/\s+/g, " ").trim();
  if (aiSummary) return aiSummary;
  const price = product.basePriceAdult.toLocaleString("ko-KR");
  return `${product.destination} · ${product.durationNights}박 ${product.durationDays}일 · 성인 기준 ${price}원~`;
}

export function buildProductJsonLd(
  product: ProductDetail,
  departures: DepartureSummary[],
): Record<string, unknown>[] {
  const url = absoluteUrl(`/products/${product.id}`);

  const breadcrumbLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "홈", item: absoluteUrl("/") },
      { "@type": "ListItem", position: 2, name: "여행 상품", item: absoluteUrl("/products") },
      { "@type": "ListItem", position: 3, name: product.title, item: url },
    ],
  };

  // 판매종료 상품이거나 출발일이 없으면 화면에 가격 · 재고가 없다. 구글은 offers · review ·
  // aggregateRating 이 모두 빠진 Product 를 잘못된 상품 스니펫으로 보고하므로 Product 자체를 내지 않는다.
  if (product.status === "CLOSED" || departures.length === 0) {
    return [breadcrumbLd];
  }

  const productLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: buildProductDescription(product),
    url,
    ...(product.heroImageUrl ? { image: [product.heroImageUrl] } : {}),
    offers: buildOffers(departures),
  };

  return [productLd, breadcrumbLd];
}

// 출발일마다 성인가가 달라 단일 Offer 대신 AggregateOffer 로 최저 · 최고가를 알린다.
function buildOffers(departures: DepartureSummary[]): Record<string, unknown> {
  const prices = departures.map((d) => d.priceAdult);
  return {
    "@type": "AggregateOffer",
    priceCurrency: "KRW",
    lowPrice: Math.min(...prices),
    highPrice: Math.max(...prices),
    offerCount: departures.length,
    availability: departures.some(isBookable)
      ? "https://schema.org/InStock"
      : "https://schema.org/SoldOut",
  };
}
