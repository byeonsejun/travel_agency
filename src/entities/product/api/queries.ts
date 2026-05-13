import { Prisma } from "@prisma/client";
import { db } from "@/shared/lib/db";
import { pickLowestPrice } from "./mapping";
import type { ProductCard, ProductDetail } from "../model/types";

export const PAGE_SIZE = 12;

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

export async function getFeaturedProducts(
  limit: number
): Promise<ProductCard[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const products = await db.product.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { createdAt: "desc" },
    take: limit,
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
}

// ─── 3. Product By ID ─────────────────────────────────────────────────────────

export async function getProductById(
  id: string
): Promise<ProductDetail | null> {
  const product = await db.product.findUnique({
    where: { id },
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
    .map((id) => products.find((p) => p.id === id)!)
    .filter(Boolean);

  return { items: ordered.map(toProductCard), total };
}
