import Link from 'next/link';
import { getFeaturedProducts } from '@/entities/product';
import { ProductCardList } from '@/widgets/product-card-list/ui/ProductCardList';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const featured = await getFeaturedProducts(6);

  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      {/* 기존 헤더 유지 */}
      <section className="py-12 text-center">
        <h1 className="text-4xl font-bold">Nextour</h1>
        <p className="mt-2 text-gray-600">AI가 찾아주는 맞춤형 패키지 여행. (작업 진행 중)</p>
      </section>

      {/* 추천 상품 섹션 */}
      <section>
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
    </main>
  );
}
