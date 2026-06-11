import { Suspense } from "react";
import { ProductCard } from "@/entities/product";
import { searchProducts, SearchBox, SearchChips, ClarifyingChips } from "@/features/search";
import { EmptyState } from "@/shared/ui/EmptyState";

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
          <Suspense fallback={<SearchSkeleton />}>
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
