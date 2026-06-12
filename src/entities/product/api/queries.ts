import { Prisma } from "@prisma/client";
import { cacheTag, cacheLife } from "next/cache";
import { db } from "@/shared/lib/db";
import { pickLowestPrice } from "./mapping";
import type { ProductCard, ProductDetail } from "../model/types";

export const PAGE_SIZE = 12;

// 캐시 태그 컨벤션 — features 레이어가 revalidateTag로 무효화할 때 사용.
//   products:featured       → 홈 추천 상품(공통)        (5min TTL fallback)
//   products:list           → /products 리스팅 + filter (5min TTL fallback)
//   products:destinations   → /products 필터 옵션 목록  (1h  TTL fallback)
//   product:${id}           → PDP 단건 상세 + compare   (1h  TTL fallback)
export const TAG_PRODUCTS_FEATURED = "products:featured";
export const TAG_PRODUCTS_LIST = "products:list";
export const TAG_DESTINATIONS_LIST = "products:destinations";
export const tagProductDetail = (id: string) => `product:${id}`;

// ─── 1. Distinct Destinations ─────────────────────────────────────────────────

// use cache: 1h TTL + 목적지 목록 태그. 목적지는 거의 변하지 않는 데이터.
// 미래 admin product CRUD 가 상품 status 변경 시 revalidateTag(TAG_DESTINATIONS_LIST)
// 로 명시 무효화.
export async function getDistinctDestinations(): Promise<
  { code: string; label: string; count: number }[]
> {
  "use cache";
  cacheTag(TAG_DESTINATIONS_LIST);
  cacheLife({ revalidate: 3600 });

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

// use cache: 5분 TTL + 추천상품 공통 태그. dynamic 페이지에서도 DB hit 압축.
export async function getFeaturedProducts(limit: number): Promise<ProductCard[]> {
  "use cache";
  cacheTag(TAG_PRODUCTS_FEATURED);
  cacheLife({ revalidate: 300 });

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
}

// ─── 3. Product By ID ─────────────────────────────────────────────────────────

// use cache + per-id 태그: 1시간 TTL. id 인자가 자동 캐시 키. 상품 정보 변경 시
// admin 모듈이 revalidateTag(tagProductDetail(id))로 명시적 무효화. 좌석은 별도 태그.
export async function getProductById(
  id: string
): Promise<ProductDetail | null> {
  "use cache";
  cacheTag(tagProductDetail(id));
  cacheLife({ revalidate: 3600 });

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

// use cache: 5분 TTL + 리스팅 태그. 같은 (sort, page, destinationCode) 조합
// 반복 요청 시 DB hit 압축. 미래 admin CMS 가 상품 status 변경·신규 등록 시
// revalidateTag(TAG_PRODUCTS_LIST) 로 일괄 무효화.
// outer wrapper 가 params 를 primitive args 로 정규화 → cache key 안정화.
// (use cache 키는 인자 직렬화 — 객체 params 직접 전달 시 undefined 필드로 키가
//  불안정해지므로, 정규화된 primitive 만 _getProductListCached 로 넘긴다.)
export async function getProductList(
  params: ListParams
): Promise<{ items: ProductCard[]; total: number }> {
  // cache key 안정화: undefined 를 구체적 primitive 로 정규화.
  const sort = params.sort ?? "latest";
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? PAGE_SIZE;
  const destinationCode = params.filter?.destinationCode ?? null;

  return _getProductListCached(sort, page, pageSize, destinationCode);
}

async function _getProductListCached(
  sortKey: NonNullable<ListParams["sort"]>,
  pageKey: number,
  pageSizeKey: number,
  destinationKey: string | null
): Promise<{ items: ProductCard[]; total: number }> {
  "use cache";
  cacheTag(TAG_PRODUCTS_LIST);
  cacheLife({ revalidate: 300 });

  return getProductListInner({
    sort: sortKey,
    page: pageKey,
    pageSize: pageSizeKey,
    filter: destinationKey ? { destinationCode: destinationKey } : undefined,
  });
}

// 기존 본문 100% 보존 — inner 함수로 분리 (file-private, non-export).
// today 는 inner 에 위치: 캐시 미스 시마다 fresh today 를 계산하는 것이 의도.
async function getProductListInner(
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
  return _getProductsByIdsCached(ids);
}

// use cache: 1h TTL + per-id 태그 fan-out. ids 배열이 자동 캐시 키.
// 비교 페이지 ids 가 [A,B,C] 이면 tags=[product:A, product:B, product:C].
// 어떤 id 가 admin 에서 update 되어 revalidateTag(tagProductDetail(id)) 가
// 호출되면, 그 id 를 포함하는 모든 비교 캐시 엔트리가 한 번에 무효화된다.
// cache key 폭발 방지: parseCompareIds 가 MAX_COMPARE=3 으로 clamp 함.
async function _getProductsByIdsCached(
  ids: string[]
): Promise<ProductDetail[]> {
  "use cache";
  cacheTag(...ids.map(tagProductDetail));
  cacheLife({ revalidate: 3600 });

  const products = await db.product.findMany({
    where: { id: { in: ids }, status: "PUBLISHED" },
    include: {
      tags: true,
      inclusions: true,
      itineraryDays: { include: { stops: true } },
    },
  });

  return ids
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => p != null);
}

// ─── 7. Static Params for ISR Prerender ───────────────────────────────────────
//
// PDP(`/products/[id]`) 의 `generateStaticParams()` 가 build time 에 호출하는
// helper. PUBLISHED 상품만 prerender 후보 — CLOSED 는 첫 요청 시 ISR-on-demand.
// `dynamicParams = true` (Next default) 이므로 신규 등록 상품도 첫 요청 시 자동
// prerender → 새 PR 마다 별도 작업 불필요.
export async function getAllPublishedProductIds(): Promise<string[]> {
  const rows = await db.product.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
