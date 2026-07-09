import { Suspense } from "react";
import {
  getProductList,
  getDistinctDestinations,
  parseProductListParams,
  PAGE_SIZE,
} from "@/entities/product";
import type { ProductListParams } from "@/entities/product";
import { ProductFilterBar } from "@/widgets/product-card-list/ui/ProductFilterBar";
import { ProductCardList } from "@/widgets/product-card-list/ui/ProductCardList";
import { ProductCardSkeleton } from "@/widgets/product-card-list/ui/ProductCardSkeleton";
import { Pagination } from "@/widgets/product-card-list/ui/Pagination";
import { EmptyState } from "@/shared/ui/EmptyState";
import { CompassLoader } from "@/shared/ui/CompassLoader";
import Link from "next/link";
import { auth } from "@/features/auth/server/auth";
import { getMyWishlistProductIds } from "@/entities/wishlist";
import {
  parseCompareIds,
  FloatingCompareCart,
} from "@/features/product-compare";

// searchParams 사용 페이지 — Next 15가 자동으로 dynamic으로 분류. force-dynamic을
// 명시할 필요 없음(향후 sub-fetch 캐시 옵트인을 막지 않도록 제거).
// Next.js 15: searchParams is a Promise
type SearchParamsProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// 정렬(sort)은 SortSelect의 router.push(useTransition)로 바뀌는 유일한 프로그래매틱
// 네비게이션 — destination/page는 실제 <Link>라 클릭 캡처(useNavigationSignal)로
// 1단계 오버레이가 이미 커버된다. 결과 영역만 별도 async 컴포넌트로 분리해 아래
// <Suspense key={params.sort}>가 sort 변경 시에만 재-suspend되도록 한다.
async function ProductResults({
  params,
  compareIds,
  wishlistIds,
  loggedIn,
  wishlistReturnTo,
}: {
  params: ProductListParams;
  compareIds: string[];
  wishlistIds?: Set<string>;
  loggedIn: boolean;
  wishlistReturnTo: string;
}) {
  const { items, total } = await getProductList({
    filter: params.destination ? { destinationCode: params.destination } : undefined,
    sort: params.sort,
    page: params.page,
    pageSize: PAGE_SIZE,
  });

  if (items.length === 0) {
    return (
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
            <Link href="/products" className="font-semibold text-primary hover:underline">
              필터 초기화
            </Link>
          ) : undefined
        }
      />
    );
  }

  // Pagination용 searchParams (page 제외)
  const paginationSearchParams: Record<string, string> = {};
  if (params.destination) paginationSearchParams.destination = params.destination;
  if (params.sort) paginationSearchParams.sort = params.sort;

  return (
    <>
      <ProductCardList
        items={items}
        wishlistIds={wishlistIds}
        wishlistReturnTo={wishlistReturnTo}
        loggedIn={loggedIn}
        currentCompareIds={compareIds}
      />
      <div className="mt-8">
        <Pagination
          total={total}
          pageSize={PAGE_SIZE}
          currentPage={params.page}
          searchParams={paginationSearchParams}
        />
      </div>
    </>
  );
}

function ProductResultsFallback() {
  return (
    <>
      <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 9 }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
      <CompassLoader />
    </>
  );
}

export default async function ProductsPage({ searchParams }: SearchParamsProps) {
  const rawParams = await searchParams;
  const params = parseProductListParams(rawParams);
  const session = await auth();

  const compareIds = parseCompareIds(rawParams.compareIds);

  // compareIds 자체는 ProductCardList 의 카드별 비교 토글 상태(`currentCompareIds`)
  // 에 여전히 필요하지만, FloatingCompareCart 의 카트 콘텐츠는 hydration 후
  // client-fetch 로 옮겼으므로 `getProductsByIds(compareIds)` prefetch 는 제거 (A4).
  const [destinations, wishlistIds] = await Promise.all([
    getDistinctDestinations(),
    session?.user?.id ? getMyWishlistProductIds(session.user.id) : Promise.resolve(undefined),
  ]);

  // 하트 클릭 후 같은 페이지로 돌아오기 위한 returnTo (현재 쿼리 보존).
  const wishlistReturnTo = (() => {
    const qs = new URLSearchParams();
    if (params.destination) qs.set("destination", params.destination);
    if (params.sort) qs.set("sort", params.sort);
    if (params.page > 1) qs.set("page", String(params.page));
    const tail = qs.toString();
    return tail ? `/products?${tail}` : "/products";
  })();

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <h1 className="mb-8 text-3xl font-extrabold tracking-tight">여행 상품</h1>

      <ProductFilterBar
        destinations={destinations}
        activeCode={params.destination}
        activeSort={params.sort}
      />

      <div className="mt-8">
        <Suspense key={params.sort} fallback={<ProductResultsFallback />}>
          <ProductResults
            params={params}
            compareIds={compareIds}
            wishlistIds={wishlistIds}
            loggedIn={!!session?.user?.id}
            wishlistReturnTo={wishlistReturnTo}
          />
        </Suspense>
      </div>

      <FloatingCompareCart />
    </div>
  );
}
