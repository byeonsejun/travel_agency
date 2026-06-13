import { Suspense } from "react";
import Link from "next/link";
import { getProductsByIds } from "@/entities/product";
import { parseCompareIds } from "@/features/product-compare";
import { ProductCompareTable } from "@/widgets/product-compare-table";
import { EmptyState } from "@/shared/ui/EmptyState";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// [ADR-0053] searchParams는 동적 → <Suspense> 안에서만 await. 컨테이너 셸은 정적 prerender.
export default function ComparePage({ searchParams }: PageProps) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <Suspense fallback={<CompareSkeleton />}>
        <CompareContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function CompareContent({ searchParams }: PageProps) {
  const sp = await searchParams;
  // parseCompareIds 가 MAX_COMPARE clamp/중복/빈 토큰 모두 처리해 추가 Zod
  // 가드는 생략. 잘못된 cuid 가 들어오면 getProductsByIds 가 단순히 0개로
  // 반환하므로 friendly fallback.
  const ids = parseCompareIds(sp.compareIds);
  const products = await getProductsByIds(ids);

  return (
    <>
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">상품 비교</h1>
        <span className="text-xs text-muted-foreground">{products.length} / 3</span>
      </div>

      {products.length === 0 ? (
        <EmptyState
          title="비교할 상품이 없습니다."
          description="상품 목록에서 ‘+ 비교’ 버튼으로 최대 3개까지 담아보세요."
          action={
            <Link href="/products" className="text-primary hover:underline">
              상품 둘러보기 →
            </Link>
          }
        />
      ) : (
        <ProductCompareTable products={products} />
      )}
    </>
  );
}

function CompareSkeleton() {
  return (
    <>
      <div className="mb-6 flex items-baseline justify-between">
        <div className="h-7 w-28 animate-pulse rounded bg-muted" />
        <div className="h-4 w-10 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-80 animate-pulse rounded-xl bg-muted" />
    </>
  );
}
