import { notFound } from "next/navigation";
import { getProductById } from "@/entities/product";
import { getDeparturesByProduct } from "@/entities/departure";
import { ProductDetail } from "@/widgets/product-detail/ui/ProductDetail";

export const dynamic = "force-dynamic";

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
