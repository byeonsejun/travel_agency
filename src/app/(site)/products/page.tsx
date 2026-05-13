import { Suspense } from "react";
import {
  getProductList,
  getDistinctDestinations,
  parseProductListParams,
  PAGE_SIZE,
} from "@/entities/product";
import { ProductFilterBar } from "@/widgets/product-card-list/ui/ProductFilterBar";
import { ProductCardList } from "@/widgets/product-card-list/ui/ProductCardList";
import { Pagination } from "@/widgets/product-card-list/ui/Pagination";
import { EmptyState } from "@/shared/ui/EmptyState";
import Link from "next/link";

export const dynamic = "force-dynamic";

// Next.js 15: searchParams is a Promise
type SearchParamsProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProductsPage({ searchParams }: SearchParamsProps) {
  const rawParams = await searchParams;
  const params = parseProductListParams(rawParams);

  const [{ items, total }, destinations] = await Promise.all([
    getProductList({
      filter: params.destination ? { destinationCode: params.destination } : undefined,
      sort: params.sort,
      page: params.page,
      pageSize: PAGE_SIZE,
    }),
    getDistinctDestinations(),
  ]);

  // Pagination용 searchParams (page 제외)
  const paginationSearchParams: Record<string, string> = {};
  if (params.destination) paginationSearchParams.destination = params.destination;
  if (params.sort) paginationSearchParams.sort = params.sort;

  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <h1 className="mb-8 text-3xl font-bold">여행 상품</h1>

      <ProductFilterBar
        destinations={destinations}
        activeCode={params.destination}
        activeSort={params.sort}
      />

      <div className="mt-8">
        {items.length === 0 ? (
          <EmptyState
            title={
              params.destination
                ? "조건에 맞는 상품이 없습니다."
                : "등록된 상품이 없습니다."
            }
            description={
              params.destination
                ? "필터를 초기화하거나 다른 목적지를 선택해보세요."
                : undefined
            }
            action={
              params.destination ? (
                <Link href="/products" className="text-blue-600 hover:underline">
                  필터 초기화
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <ProductCardList items={items} />
            <div className="mt-8">
              <Pagination
                total={total}
                pageSize={PAGE_SIZE}
                currentPage={params.page}
                searchParams={paginationSearchParams}
              />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
