import { getFeaturedProducts, ProductCard } from "@/entities/product";
import { TabsContent } from "@/shared/ui/tabs";
import { HomeHero } from "@/widgets/home-hero";
import { HomeRegionDeals, buildRegionTabs, filterByRegion } from "@/widgets/home-region-deals";
import { HomeThemeBento } from "@/widgets/home-theme-bento";

// ISR: 추천 상품은 변동 빈도가 낮아 5분 캐시. getFeaturedProducts 가 unstable_cache 로
// 래핑되어 동일 TTL 동안 DB hit 이 압축된다. 지역 탭은 표시 items 에서 도출(별도 쿼리 불요).
export const revalidate = 300;

export default async function HomePage() {
  const featured = await getFeaturedProducts(12);
  const tabs = buildRegionTabs(featured);

  // 외곽은 div — landmark <main>은 layout.tsx가 단일 제공(중첩 방지).
  // region 별 ProductCard 그리드는 서버에서 렌더해 client 셸(HomeRegionDeals)에
  // children 으로 주입 → entities/product 서버 그래프가 client 번들에 누출되지 않음.
  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <HomeHero />
      <HomeRegionDeals tabs={tabs}>
        {tabs.map((region) => (
          <TabsContent key={region} value={region} className="mt-0">
            <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
              {filterByRegion(featured, region)
                .slice(0, 8)
                .map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
            </div>
          </TabsContent>
        ))}
      </HomeRegionDeals>
      <HomeThemeBento />
    </div>
  );
}
