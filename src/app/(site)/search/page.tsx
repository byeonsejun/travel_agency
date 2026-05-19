import { Suspense } from "react";
import { SEARCH_CHIPS, ProductCard } from "@/entities/product";
import type { SearchResultCard } from "@/entities/product";
import { searchProducts, SearchBox } from "@/features/search";
import { EmptyState } from "@/shared/ui/EmptyState";

export const dynamic = "force-dynamic";

type SearchPageProps = {
  searchParams: Promise<{ q?: string }>;
};

async function SearchResults({ q }: { q: string }) {
  const results: SearchResultCard[] = await searchProducts(q);

  if (results.length === 0) {
    return (
      <EmptyState
        title="검색 결과가 없습니다"
        description={`'${q}'에 맞는 여행 상품을 찾지 못했습니다. 다른 키워드로 검색해 보세요.`}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {results.map((item) => (
        <ProductCard key={item.id} product={item} />
      ))}
    </div>
  );
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <section className="mb-8">
        <h1 className="mb-6 text-3xl font-bold text-gray-900">여행 검색</h1>
        <SearchBox defaultValue={query} />
      </section>

      {query ? (
        <section>
          <p className="mb-6 text-sm text-gray-500">
            <span className="font-semibold text-gray-800">&ldquo;{query}&rdquo;</span> 검색
            결과
          </p>
          <Suspense fallback={<SearchSkeleton />}>
            <SearchResults q={query} />
          </Suspense>
        </section>
      ) : (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-gray-700">
            이런 여행은 어떠세요?
          </h2>
          <div className="flex flex-wrap gap-3">
            {SEARCH_CHIPS.map((chip) => (
              <a
                key={chip}
                href={`/search?q=${encodeURIComponent(chip)}`}
                className="rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 transition-colors hover:bg-blue-100"
              >
                {chip}
              </a>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function SearchSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="animate-pulse overflow-hidden rounded-lg border border-gray-200">
          <div className="h-48 bg-gray-200" />
          <div className="p-4 space-y-3">
            <div className="h-3 w-1/3 rounded bg-gray-200" />
            <div className="h-4 w-3/4 rounded bg-gray-200" />
            <div className="h-3 w-1/2 rounded bg-gray-200" />
            <div className="flex gap-2">
              <div className="h-5 w-16 rounded-full bg-gray-200" />
              <div className="h-5 w-12 rounded-full bg-gray-200" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
