import { getPublishedProductIndex } from "@/entities/product";
import { buildLlmsTxt } from "@/shared/lib/seo";

export async function GET(): Promise<Response> {
  const products = await getPublishedProductIndex();

  const text = buildLlmsTxt({
    products: products.map((p) => ({
      path: `/products/${p.id}`,
      label: `${p.title} — ${p.destination}, ${p.durationNights}박 ${p.durationDays}일, 성인 기준 ${p.basePriceAdult.toLocaleString("ko-KR")}원~`,
    })),
  });

  return new Response(text, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
