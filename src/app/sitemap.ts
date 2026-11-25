import type { MetadataRoute } from "next";
import { getPublishedProductIndex } from "@/entities/product";
import { absoluteUrl } from "@/shared/lib/seo";

// 로그인 · 마이페이지 · 비교 같은 비공개/빈 화면은 넣지 않는다.
// changeFrequency 는 구글이 무시하므로 쓰지 않는다.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await getPublishedProductIndex();

  return [
    { url: absoluteUrl("/"), priority: 1 },
    { url: absoluteUrl("/products") },
    { url: absoluteUrl("/search") },
    ...products.map((p) => ({
      url: absoluteUrl(`/products/${p.id}`),
      lastModified: p.updatedAt,
    })),
  ];
}
