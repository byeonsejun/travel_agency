import { Suspense } from "react";
import { ProductCard } from "@/entities/product";
import { searchProducts, SearchBox, SearchChips, ClarifyingChips } from "@/features/search";
import { EmptyState } from "@/shared/ui/EmptyState";
import { CompassLoader } from "@/shared/ui/CompassLoader";

// searchParams로 분기되므로 Next 15가 자동으로 dynamic으로 분류. searchProducts
// 자체는 Upstash Redis 캐시(M-CACHE)로 동일 q에 대한 반복 비용을 흡수한다.
type SearchPageProps = {
  searchParams: Promise<{ q?: string }>;
};

async function SearchResults({ q }: { q: string }) {
  const { results, chips } = await searchProducts(q);

  return (
    <>
      <ClarifyingChips chips={chips} query={q} />
      {results.length === 0 ? (
        <EmptyState
          title="검색 결과가 없습니다"
          description={`'${q}'에 맞는 여행 상품을 찾지 못했습니다. 다른 키워드로 검색해 보세요.`}
        />
      ) : (
        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {results.map((item) => (
            <ProductCard key={item.id} product={item} />
          ))}
        </div>
      )}
    </>
  );
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  // 외곽 div — <main> landmark는 layout.tsx 단일 제공(중첩 방지).
  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <section className="mb-8">
        <h1 className="mb-6 text-3xl font-extrabold tracking-tight text-foreground">여행 검색</h1>
        <div className="rounded-2xl bg-card p-3 shadow-float">
          <SearchBox defaultValue={query} />
        </div>
      </section>

      {query ? (
        <section>
          <p className="mb-6 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">&ldquo;{query}&rdquo;</span> 검색
            결과
          </p>
          {/* key={query}: 재검색(같은 세그먼트의 q 변경) 시 이 서브트리를 강제 재마운트해
              fallback을 재노출한다 — Next는 searchParams만 바뀌는 이동에선 자동으로
              재-suspend하지 않기 때문(같은 인스턴스로 취급). CompassLoader는 라우트
              loading.tsx(2단계)와 동일 비주얼을 공유해 나침반이 링크 네비와 동일하게 보이도록 함. */}
          <Suspense
            key={query}
            fallback={
              <>
                <SearchSkeleton />
                <CompassLoader />
              </>
            }
          >
            <SearchResults q={query} />
          </Suspense>
        </section>
      ) : (
        <section>
          <h2 className="mb-4 text-lg font-bold text-foreground">
            이런 여행은 어떠세요?
          </h2>
          <SearchChips />
        </section>
      )}
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="animate-pulse overflow-hidden rounded-lg border border-border bg-card">
          <div className="h-48 bg-secondary" />
          <div className="space-y-3 p-4">
            <div className="h-3 w-1/3 rounded bg-secondary" />
            <div className="h-4 w-3/4 rounded bg-secondary" />
            <div className="h-3 w-1/2 rounded bg-secondary" />
            <div className="flex gap-2">
              <div className="h-5 w-16 rounded-full bg-secondary" />
              <div className="h-5 w-12 rounded-full bg-secondary" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
