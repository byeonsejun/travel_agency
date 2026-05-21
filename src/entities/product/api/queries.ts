import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { db } from "@/shared/lib/db";
import { pickLowestPrice } from "./mapping";
import type { ProductCard, ProductDetail } from "../model/types";

export const PAGE_SIZE = 12;

// 캐시 태그 컨벤션 — features 레이어가 revalidateTag로 무효화할 때 사용.
//   products:featured       → 홈 추천 상품(공통)
//   product:${id}           → PDP 단건 상세
//   product:${id}:departures → 좌석/일정 (booking 생성·취소로 즉시 무효화)
const TAG_PRODUCTS_FEATURED = "products:featured";
export const tagProductDetail = (id: string) => `product:${id}`;
export const tagProductDepartures = (id: string) => `product:${id}:departures`;

// ─── 1. Distinct Destinations ─────────────────────────────────────────────────

export async function getDistinctDestinations(): Promise<
  { code: string; label: string; count: number }[]
> {
  const rows = await db.product.groupBy({
    by: ["destinationCode", "destination"],
    where: { status: "PUBLISHED" },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });

  return rows
    .filter((item) => item.destinationCode !== null)
    .map((item) => ({
      code: item.destinationCode as string,
      label: item.destination,
      count: item._count.id,
    }));
}

// ─── 2. Featured Products ─────────────────────────────────────────────────────

// unstable_cache: 5분 TTL + 추천상품 공통 태그. dynamic 페이지에서도 DB hit 압축.
export const getFeaturedProducts = unstable_cache(
  async (limit: number): Promise<ProductCard[]> => {
    const safeLimit = Math.min(limit, 50); // clamp to reasonable maximum
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const products = await db.product.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { createdAt: "desc" },
      take: safeLimit,
      include: {
        tags: { select: { tag: true } },
        departures: {
          where: {
            departureDate: { gte: today },
            status: { not: "CANCELED" },
          },
          orderBy: { priceAdult: "asc" },
          take: 1,
          select: { priceAdult: true },
        },
      },
    });

    return products.map((product) => ({
      id: product.id,
      title: product.title,
      destination: product.destination,
      durationNights: product.durationNights,
      durationDays: product.durationDays,
      heroImageUrl: product.heroImageUrl,
      basePriceAdult: product.basePriceAdult,
      aiSummary: product.aiSummary,
      tags: product.tags,
      lowestPrice: pickLowestPrice(product.departures) ?? undefined,
    }));
  },
  ["featured-products"],
  { revalidate: 300, tags: [TAG_PRODUCTS_FEATURED] }
);

// ─── 3. Product By ID ─────────────────────────────────────────────────────────

// unstable_cache + per-id 태그: 1시간 TTL. 상품 정보 변경 시 admin 모듈이
// revalidateTag(tagProductDetail(id))로 명시적 무효화. 좌석은 별도 태그로 격리.
export async function getProductById(
  id: string
): Promise<ProductDetail | null> {
  return unstable_cache(
    async (productId: string): Promise<ProductDetail | null> => {
      const product = await db.product.findUnique({
        where: { id: productId },
        include: {
          tags: true,
          inclusions: true,
          itineraryDays: {
            include: {
              stops: { orderBy: { order: "asc" } },
            },
            orderBy: { dayNumber: "asc" },
          },
        },
      });

      if (!product || product.status === "DRAFT") {
        return null;
      }

      return product;
    },
    ["product-detail"],
    { revalidate: 3600, tags: [tagProductDetail(id)] }
  )(id);
}

// ─── 4. Product List ──────────────────────────────────────────────────────────

type ListParams = {
  filter?: { destinationCode?: string };
  sort?: "latest" | "price_asc" | "departure_soon";
  page?: number;
  pageSize?: number;
};

export async function getProductList(
  params: ListParams
): Promise<{ items: ProductCard[]; total: number }> {
  const { filter, sort = "latest", page = 1, pageSize = PAGE_SIZE } = params;
  const destinationCode = filter?.destinationCode;

  const skip = (page - 1) * pageSize;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const departuresInclude = {
    where: {
      departureDate: { gte: today },
      status: { not: "CANCELED" as const },
    },
    orderBy: { priceAdult: "asc" as const },
    take: 1,
    select: { priceAdult: true },
  };

  function toProductCard(
    product: Awaited<
      ReturnType<typeof db.product.findMany<{ include: { tags: { select: { tag: true } }; departures: { select: { priceAdult: true } } } }>>
    >[number]
  ): ProductCard {
    return {
      id: product.id,
      title: product.title,
      destination: product.destination,
      durationNights: product.durationNights,
      durationDays: product.durationDays,
      heroImageUrl: product.heroImageUrl,
      basePriceAdult: product.basePriceAdult,
      aiSummary: product.aiSummary,
      tags: product.tags,
      lowestPrice: pickLowestPrice(product.departures) ?? undefined,
    };
  }

  if (sort === "latest") {
    const where = {
      status: "PUBLISHED" as const,
      ...(destinationCode && { destinationCode }),
    };

    const [rawProducts, total] = await Promise.all([
      db.product.findMany({
        where,
        include: {
          tags: { select: { tag: true } },
          departures: departuresInclude,
        },
        orderBy: { createdAt: "desc" },
        take: pageSize,
        skip,
      }),
      db.product.count({ where }),
    ]);

    return { items: rawProducts.map(toProductCard), total };
  }

  // "price_asc" | "departure_soon" — raw SQL for proper ordering
  const sortColumn =
    sort === "price_asc"
      ? Prisma.sql`MIN(d."priceAdult")`
      : Prisma.sql`MIN(d."departureDate")`;

  const sortedIds = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT p.id
    FROM "Product" p
    LEFT JOIN "Departure" d ON d."productId" = p.id
      AND d."departureDate" >= ${today}
      AND d.status <> 'CANCELED'
    WHERE p.status = 'PUBLISHED'
      ${destinationCode ? Prisma.sql`AND p."destinationCode" = ${destinationCode}` : Prisma.sql``}
    GROUP BY p.id
    ORDER BY ${sortColumn} NULLS LAST
    LIMIT ${pageSize} OFFSET ${skip}
  `);

  const ids = sortedIds.map((r) => r.id);

  const [products, total] = await Promise.all([
    db.product.findMany({
      where: { id: { in: ids } },
      include: {
        tags: { select: { tag: true } },
        departures: departuresInclude,
      },
    }),
    db.product.count({
      where: {
        status: "PUBLISHED",
        ...(destinationCode && { destinationCode }),
      },
    }),
  ]);

  // Restore original sort order from raw SQL
  const ordered = ids
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => p != null);

  return { items: ordered.map(toProductCard), total };
}

// ─── 5. Compare — getProductsByIds ────────────────────────────────────────────

// 비교 페이지 (/compare) 용. ids 배열로 PUBLISHED 상품을 한 번에 조회 +
// 입력 순서 보존. status=PUBLISHED 가드로 DRAFT/CLOSED 비교 차단.
// 비교 표는 가격·기간·태그·포함/불포함이 모두 필요해 inclusions 까지 join.
export async function getProductsByIds(
  ids: string[]
): Promise<ProductDetail[]> {
  if (ids.length === 0) return [];

  const products = await db.product.findMany({
    where: { id: { in: ids }, status: "PUBLISHED" },
    include: {
      tags: true,
      inclusions: true,
      itineraryDays: { include: { stops: true } },
    },
  });

  // 입력 순서 보존 — find/filter 조합으로 자연스럽게 정렬.
  return ids
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => p != null);
}
