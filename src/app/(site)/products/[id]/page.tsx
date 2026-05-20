import { notFound } from "next/navigation";
import { getProductById } from "@/entities/product";
import { getDeparturesByProduct } from "@/entities/departure";
import { ProductDetail } from "@/widgets/product-detail/ui/ProductDetail";

// ISR 힌트: PDP는 변동 빈도가 낮아 1시간 cache TTL. layout이 auth()로 dynamic
// 이라 페이지는 ƒ로 잡히지만, getProductById는 unstable_cache로 tag(product:[id])
// 래핑되어 booking 생성/취소 시 revalidateTag로 즉시 무효화된다.
export const revalidate = 3600;

// Next.js 15: params is a Promise
type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProductDetailPage({ params }: PageProps) {
  const { id } = await params;

  const [product, departures] = await Promise.all([
    getProductById(id),
    getDeparturesByProduct(id),
  ]);

  if (product === null) {
    notFound();
  }

  return <ProductDetail product={product} departures={departures} />;
}
