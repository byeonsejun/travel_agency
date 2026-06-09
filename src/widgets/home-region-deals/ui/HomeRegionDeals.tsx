"use client";
import { useState } from "react";
import Link from "next/link";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { ProductCard } from "@/entities/product";
import type { ProductCardType } from "@/entities/product";
import { filterByRegion, buildRegionTabs, ALL_TAB } from "../model/filterByRegion";

export function HomeRegionDeals({ items }: { items: ProductCardType[] }) {
  const tabs = buildRegionTabs(items);
  const [active, setActive] = useState(ALL_TAB);
  const shown = filterByRegion(items, active).slice(0, 8);

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
      <Tabs value={active} onValueChange={setActive} className="mb-6">
        <TabsList className="flex-wrap">
          {tabs.map((t) => (
            <TabsTrigger key={t} value={t}>
              {t}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
        {shown.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
