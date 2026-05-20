import Link from "next/link";
import { getFeaturedProducts } from "@/entities/product";
import { SearchBox, SearchChips } from "@/features/search";
import { ProductCardList } from "@/widgets/product-card-list/ui/ProductCardList";

// ISR: 추천 상품은 변동 빈도가 낮아 5분 캐시. 새 상품 등록/대표상품 변경 시
// 별도 onDemand revalidatePath('/')가 필요해지면 admin 모듈에서 호출한다.
// layout이 auth()로 dynamic이라 페이지 자체는 ƒ로 잡히지만, getFeaturedProducts
// 가 unstable_cache로 래핑되어 동일 TTL 동안 DB hit이 압축된다.
export const revalidate = 300;

export default async function HomePage() {
  const featured = await getFeaturedProducts(6);

  // 외곽은 div — landmark <main>은 layout.tsx가 단일 제공(중첩 방지).
  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      {/* 검색 진입점 (골든패스 시작) */}
      <section className="py-10 text-center">
        <h1 className="text-4xl font-bold">Nextour</h1>
        <p className="mt-2 mb-6 text-gray-600">
          AI가 찾아주는 맞춤형 패키지 여행
        </p>
        <div className="mx-auto max-w-2xl">
          <SearchBox />
          <div className="mt-4 flex justify-center">
            <SearchChips />
          </div>
        </div>
      </section>

      {/* 추천 상품 */}
      <section className="mt-8">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold">추천 여행 상품</h2>
          <Link href="/products" className="text-blue-600 hover:underline">
            전체보기 →
          </Link>
        </div>
        {featured.length === 0 ? (
          <p className="text-gray-500">등록된 상품이 없습니다.</p>
        ) : (
          <ProductCardList items={featured} />
        )}
      </section>
    </div>
  );
}
