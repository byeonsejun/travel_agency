import { describe, it, expect } from "vitest";
import type { ProductDetail } from "@/entities/product";
import type { DepartureSummary } from "@/entities/departure";
import { buildProductDescription, buildProductJsonLd } from "../productSeo";

const SITE = "https://travel-agency-sooty-mu.vercel.app";

function makeProduct(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: "prod1",
    title: "오사카 온천 3박 4일",
    destination: "오사카, 일본",
    durationNights: 3,
    durationDays: 4,
    basePriceAdult: 1290000,
    aiSummary: "온천과 먹거리",
    heroImageUrl: "https://img.example.com/osaka.jpg",
    status: "PUBLISHED",
    tags: [],
    inclusions: [],
    itineraryDays: [],
    ...overrides,
  } as unknown as ProductDetail;
}

function makeDeparture(
  id: string,
  priceAdult: number,
  overrides: Partial<DepartureSummary> = {},
): DepartureSummary {
  return {
    id,
    departureDate: new Date("2027-01-10"),
    returnDate: new Date("2027-01-13"),
    priceAdult,
    priceChild: 900000,
    capacity: 20,
    bookedSeats: 5,
    minPax: 4,
    status: "SCHEDULED",
    remainingSeats: 15,
    ...overrides,
  } as DepartureSummary;
}

const departures = [
  makeDeparture("d1", 1290000),
  makeDeparture("d2", 1490000),
  makeDeparture("d3", 1390000),
];

describe("buildProductDescription", () => {
  it("AI 추천 포인트의 줄바꿈과 공백을 한 칸으로 정리한다", () => {
    expect(buildProductDescription(makeProduct({ aiSummary: "온천과\n  먹거리" }))).toBe(
      "온천과 먹거리",
    );
  });

  it("aiSummary 가 null 이면 지역 · 일정 · 기준가로 대신한다", () => {
    expect(buildProductDescription(makeProduct({ aiSummary: null }))).toBe(
      "오사카, 일본 · 3박 4일 · 성인 기준 1,290,000원~",
    );
  });

  it("aiSummary 가 공백뿐이어도 대체 문구를 쓴다", () => {
    expect(buildProductDescription(makeProduct({ aiSummary: "  \n " }))).toBe(
      "오사카, 일본 · 3박 4일 · 성인 기준 1,290,000원~",
    );
  });
});

describe("buildProductJsonLd — Product", () => {
  it("이름 · 설명 · 주소 · 이미지를 담는다", () => {
    const product = makeProduct();
    const [item] = buildProductJsonLd(product, departures);
    expect(item["@context"]).toBe("https://schema.org");
    expect(item["@type"]).toBe("Product");
    expect(item.name).toBe(product.title);
    expect(item.description).toBe(buildProductDescription(product));
    expect(item.url).toBe(`${SITE}/products/prod1`);
    expect(item.image).toEqual([product.heroImageUrl]);
  });

  it("heroImageUrl 이 null 이면 image 키가 없다", () => {
    const [item] = buildProductJsonLd(makeProduct({ heroImageUrl: null }), departures);
    expect("image" in item).toBe(false);
  });

  it("출발일 성인가의 최저 · 최고로 AggregateOffer 를 만든다", () => {
    const [item] = buildProductJsonLd(makeProduct(), departures);
    expect(item.offers).toEqual({
      "@type": "AggregateOffer",
      priceCurrency: "KRW",
      lowPrice: 1290000,
      highPrice: 1490000,
      offerCount: 3,
      availability: "https://schema.org/InStock",
    });
  });

  it("출발일이 모두 CLOSED 이면 SoldOut", () => {
    const closed = departures.map((d) => ({ ...d, status: "CLOSED" as const }));
    const [item] = buildProductJsonLd(makeProduct(), closed);
    expect((item.offers as Record<string, unknown>).availability).toBe(
      "https://schema.org/SoldOut",
    );
  });

  it("출발일이 모두 잔여 0석이면 SoldOut", () => {
    const full = departures.map((d) => ({ ...d, remainingSeats: 0 }));
    const [item] = buildProductJsonLd(makeProduct(), full);
    expect((item.offers as Record<string, unknown>).availability).toBe(
      "https://schema.org/SoldOut",
    );
  });

  it("하나라도 예약 가능하면 InStock", () => {
    const mixed = [makeDeparture("d1", 1290000, { remainingSeats: 0 }), makeDeparture("d2", 1490000)];
    const [item] = buildProductJsonLd(makeProduct(), mixed);
    expect((item.offers as Record<string, unknown>).availability).toBe(
      "https://schema.org/InStock",
    );
  });

  it("상품이 CLOSED 이면 offers 가 없다", () => {
    const [item] = buildProductJsonLd(makeProduct({ status: "CLOSED" }), departures);
    expect("offers" in item).toBe(false);
  });

  it("출발일이 0개이면 offers 가 없다", () => {
    const [item] = buildProductJsonLd(makeProduct(), []);
    expect("offers" in item).toBe(false);
  });

  it("입력 출발일 배열을 변이하지 않는다", () => {
    const input = [...departures];
    buildProductJsonLd(makeProduct(), input);
    expect(input.map((d) => d.id)).toEqual(["d1", "d2", "d3"]);
  });
});

describe("buildProductJsonLd — BreadcrumbList", () => {
  it("홈 · 여행 상품 · 상품 이름 세 항목", () => {
    const product = makeProduct();
    const [, crumbs] = buildProductJsonLd(product, departures);
    expect(crumbs).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "홈", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: "여행 상품", item: `${SITE}/products` },
        { "@type": "ListItem", position: 3, name: product.title, item: `${SITE}/products/prod1` },
      ],
    });
  });
});
