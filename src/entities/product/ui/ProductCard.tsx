import Link from "next/link";
import type { ReactNode } from "react";
import { formatTagLabel } from "@/shared/lib/format";
import type { ProductCard } from "../model/types";
import { ProductImage } from "./ProductImage";

type ProductCardProps = {
  product: ProductCard;
  // 이미지 우상단에 자리할 액션 슬롯 (보통 WishlistHeartButton).
  // entities/product 가 features/wishlist 를 직접 import 하면
  // entities/product barrel 의 module graph 가 server-action 체인을 끌어와
  // vitest 의 router.test 등 무관 테스트의 module resolution 을 깬다.
  // 의존성 역전으로 부모(widgets/페이지)가 인스턴스를 주입.
  heart?: ReactNode;
  // 가격 라인 옆 액션 슬롯 (보통 CompareToggleButton). 같은 이유로 슬롯만 노출.
  compareButton?: ReactNode;
  // 카드 Link 에 보존할 쿼리스트링 (예: "compareIds=a,b"). 다음 페이지로
  // 이동해도 URL state(비교함)가 따라가도록 페이지가 합성해 넘김.
  linkQueryString?: string;
};

export function ProductCard({ product, heart, compareButton, linkQueryString }: ProductCardProps) {
  const { id, title, destination, durationNights, durationDays, heroImageUrl, basePriceAdult, tags, lowestPrice } = product;

  // 가격 정보 결정
  const displayPrice = lowestPrice ?? basePriceAdult;
  const showNoDeparturesBadge = lowestPrice === undefined;

  // 태그 최대 3개 슬라이싱
  const displayTags = tags.slice(0, 3);

  return (
    // <a> 내부에 <button>/<form> 중첩은 HTML 위반이므로 카드 컨테이너는 article,
    // 네비게이션은 콘텐츠 영역의 Link로 한정. Heart 는 형제 absolute.
    <article className="group relative overflow-hidden rounded-lg border border-border bg-card transition-all hover:-translate-y-1 hover:shadow-card">
      <Link
        href={linkQueryString ? `/products/${id}?${linkQueryString}` : `/products/${id}`}
        className="block"
      >
        {/* 이미지 영역 */}
        <div className="relative h-48 w-full overflow-hidden bg-secondary">
          <ProductImage
            src={heroImageUrl}
            alt={title}
            className="h-full w-full transition-transform duration-300 group-hover:scale-105"
          />
        </div>

        {/* 콘텐츠 영역 */}
        <div className="p-4">
          {/* 목적지 */}
          <p className="text-xs font-bold text-primary">{destination}</p>

          {/* 제목 */}
          <h3 className="mb-2 mt-1 line-clamp-2 font-bold leading-snug text-foreground">
            {title}
          </h3>

          {/* 기간 */}
          <p className="mb-3 text-sm text-muted-foreground">
            {durationNights}박 {durationDays}일
          </p>

          {/* 태그 */}
          <div className="mb-4 flex flex-wrap gap-2">
            {displayTags.map((tag, index) => (
              <span
                key={index}
                className="inline-block rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground"
              >
                {formatTagLabel(tag.tag)}
              </span>
            ))}
          </div>

          {/* 가격 영역 */}
          <div className="flex items-end justify-between border-t border-border pt-3">
            <p className="flex items-baseline gap-1">
              <span className="text-xl font-extrabold text-foreground">
                {displayPrice.toLocaleString("ko-KR")}
              </span>
              <span className="text-xs text-muted-foreground">원~</span>
            </p>
            {showNoDeparturesBadge && (
              <span className="inline-block rounded-full bg-secondary px-2 py-1 text-xs font-medium text-muted-foreground">
                출발일 미정
              </span>
            )}
          </div>
        </div>
      </Link>

      {heart && <div className="absolute right-2 top-2 z-10">{heart}</div>}

      {/* 가격 영역 우측에 absolute 배치 — Link 외부라 클릭 이벤트 분리 */}
      {compareButton && (
        <div className="absolute bottom-3 right-3 z-10">{compareButton}</div>
      )}
    </article>
  );
}
