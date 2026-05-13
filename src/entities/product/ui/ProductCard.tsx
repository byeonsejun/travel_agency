import Link from "next/link";
import type { ProductCard } from "../model/types";
import { ProductImage } from "./ProductImage";

type ProductCardProps = {
  product: ProductCard;
};

export function ProductCard({ product }: ProductCardProps) {
  const { id, title, destination, durationNights, durationDays, heroImageUrl, basePriceAdult, tags, lowestPrice } = product;

  // 가격 정보 결정
  const displayPrice = lowestPrice ?? basePriceAdult;
  const showNoDeparturesBadge = lowestPrice === undefined;

  // 태그 최대 3개 슬라이싱
  const displayTags = tags.slice(0, 3);

  return (
    <Link href={`/products/${id}`}>
      <article className="group overflow-hidden rounded-lg border border-gray-200 shadow-sm transition-shadow hover:shadow-md">
        {/* 이미지 영역 */}
        <div className="relative h-48 w-full bg-gray-100">
          <ProductImage
            src={heroImageUrl}
            alt={title}
            className="h-full w-full"
          />
        </div>

        {/* 콘텐츠 영역 */}
        <div className="p-4">
          {/* 목적지 */}
          <p className="text-xs text-gray-500">{destination}</p>

          {/* 제목 */}
          <h3 className="mb-2 line-clamp-2 font-semibold text-gray-900">
            {title}
          </h3>

          {/* 기간 */}
          <p className="mb-3 text-sm text-gray-600">
            {durationNights}박 {durationDays}일
          </p>

          {/* 태그 */}
          <div className="mb-4 flex flex-wrap gap-2">
            {displayTags.map((tag, index) => (
              <span
                key={index}
                className="inline-block rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700"
              >
                #{tag.tag}
              </span>
            ))}
          </div>

          {/* 가격 영역 */}
          <div className="flex items-center justify-between border-t border-gray-100 pt-3">
            <p className="text-sm font-semibold text-gray-900">
              최저 {displayPrice.toLocaleString()}원~
            </p>
            {showNoDeparturesBadge && (
              <span className="inline-block rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                출발일 미정
              </span>
            )}
          </div>
        </div>
      </article>
    </Link>
  );
}
