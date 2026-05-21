"use client";

import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  parseCompareIds,
  serializeCompareIds,
  MAX_COMPARE,
} from "../model/compareIds";
import { CompareRemoveButton } from "./CompareRemoveButton";

type CartProduct = {
  id: string;
  title: string;
  heroImageUrl: string | null;
};

type Props = {
  /** SSR 시점에 부모 RSC 가 사전 조회한 카트 후보. */
  products: CartProduct[];
};

export function FloatingCompareCart({ products }: Props) {
  const searchParams = useSearchParams();
  const ids = parseCompareIds(searchParams.get("compareIds") ?? undefined);

  if (ids.length === 0) return null;

  // URL 의 ids 순서대로 정렬해 사용자가 담은 순서를 보존.
  const byId = new Map(products.map((p) => [p.id, p]));
  const items = ids
    .map((id) => byId.get(id))
    .filter((p): p is CartProduct => p !== undefined);

  const remaining = MAX_COMPARE - ids.length;

  return (
    <div
      role="region"
      aria-label="상품 비교함"
      className="fixed bottom-4 left-1/2 z-40 w-[min(90vw,640px)] -translate-x-1/2 rounded-2xl border border-gray-200 bg-white p-3 shadow-2xl"
    >
      <div className="flex items-center gap-3">
        <ul className="flex flex-1 items-center gap-2 overflow-x-auto">
          {items.map((p) => (
            <li
              key={p.id}
              className="flex shrink-0 items-center gap-2 rounded-lg bg-gray-50 py-1 pl-1 pr-2"
            >
              <div className="relative h-10 w-10 overflow-hidden rounded-md bg-gray-200">
                {p.heroImageUrl && (
                  <Image
                    src={p.heroImageUrl}
                    alt=""
                    fill
                    sizes="40px"
                    className="object-cover"
                  />
                )}
              </div>
              <span className="max-w-[140px] truncate text-xs text-gray-700">
                {p.title}
              </span>
              <CompareRemoveButton productId={p.id} />
            </li>
          ))}
          {remaining > 0 && (
            <li className="shrink-0 text-xs text-gray-400">
              +{remaining}개 추가 가능
            </li>
          )}
        </ul>

        <Link
          href={`/compare?compareIds=${serializeCompareIds(ids)}`}
          className="shrink-0 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition"
        >
          비교하러 가기 ({ids.length})
        </Link>
      </div>
    </div>
  );
}
