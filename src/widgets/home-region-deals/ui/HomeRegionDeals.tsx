"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { ALL_TAB } from "../model/filterByRegion";

/**
 * 지역 탭 client 셸 — 탭 상태만 보유.
 * ProductCard 그리드(서버 컴포넌트)는 부모(page)가 region 별 <TabsContent> 로 미리 렌더해
 * children 으로 주입한다. entities/product 배럴(node:crypto 포함 서버 그래프)을
 * client 번들로 끌어오지 않기 위한 의존성 역전 (ProductCard 의 heart 슬롯과 동일 원리).
 */
export function HomeRegionDeals({ tabs, children }: { tabs: string[]; children: ReactNode }) {
  const [active, setActive] = useState(ALL_TAB);

  return (
    <section className="mt-16">
      <div className="mb-5 flex items-baseline">
        <h2 className="text-2xl font-extrabold tracking-tight">지금 떠나기 좋은 특가</h2>
        <Link
          href="/products"
          className="ml-auto text-sm font-semibold text-muted-foreground hover:text-primary"
        >
          전체보기 ›
        </Link>
      </div>
      <Tabs value={active} onValueChange={setActive}>
        <TabsList className="mb-6 flex-wrap">
          {tabs.map((t) => (
            <TabsTrigger key={t} value={t}>
              {t}
            </TabsTrigger>
          ))}
        </TabsList>
        {children}
      </Tabs>
    </section>
  );
}
