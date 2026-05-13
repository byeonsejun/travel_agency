import { ProductCard } from "@/entities/product";
import type { ProductCardType } from "@/entities/product";

type ProductCardListProps = {
  items: ProductCardType[];
};

export function ProductCardList({ items }: ProductCardListProps) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <ProductCard key={item.id} product={item} />
      ))}
    </div>
  );
}
