"use client";

import { useEffect, useState } from "react";
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

// SSR prefetch 의존을 제거하고 hydration 후 자체적으로 카트 콘텐츠 fetch.
// 이 변경으로 부모 RSC(PDP)가 searchParams 의존 0 → ISR 복귀 가능 (A4).
//
// 라이프사이클:
//   - ids 변화 시 AbortController 로 이전 요청 취소 후 재요청
//   - loading 상태에 ids.length 만큼 skeleton placeholder 렌더 → layout shift 0
//   - cleanup 으로 unmount 시 in-flight 요청 abort (Frontend Expert critical rule)
export function FloatingCompareCart() {
  const searchParams = useSearchParams();
  const ids = parseCompareIds(searchParams.get("compareIds") ?? undefined);
  const idsKey = ids.join(",");

  const [products, setProducts] = useState<CartProduct[] | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (ids.length === 0) {
      setProducts([]);
      setErrored(false);
      return;
    }
    const controller = new AbortController();
    setErrored(false);
    setProducts(null); // loading
    fetch(`/api/compare/products?ids=${encodeURIComponent(idsKey)}`, {
      signal: controller.signal,
    })
      .then((r) =>
        r.ok
          ? (r.json() as Promise<{ products: CartProduct[] }>)
          : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then((d) => setProducts(d.products))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setErrored(true);
      });
    return () => controller.abort();
    // idsKey 가 primitive 문자열이라 stable 비교 — eslint 가 ids 도 요구하지만
    // ids 는 idsKey 로부터 파생되므로 중복.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  if (ids.length === 0) return null;

  // URL 의 ids 순서대로 정렬해 사용자가 담은 순서를 보존.
  const items = (products ?? [])
    .reduce<Map<string, CartProduct>>((acc, p) => acc.set(p.id, p), new Map());
  const ordered = ids
    .map((id) => items.get(id))
    .filter((p): p is CartProduct => p !== undefined);

  const remaining = MAX_COMPARE - ids.length;
  const isLoading = products === null && !errored;

  return (
    <div
      role="region"
      aria-label="상품 비교함"
      className="fixed bottom-4 left-1/2 z-40 w-[min(90vw,640px)] -translate-x-1/2 rounded-2xl border border-gray-200 bg-white p-3 shadow-2xl"
    >
      <div className="flex items-center gap-3">
        <ul className="flex flex-1 items-center gap-2 overflow-x-auto">
          {isLoading &&
            ids.map((id) => (
              <li
                key={id}
                aria-hidden="true"
                className="flex shrink-0 items-center gap-2 rounded-lg bg-gray-50 py-1 pl-1 pr-2"
              >
                <div className="h-10 w-10 animate-pulse rounded-md bg-gray-200" />
                <div className="h-3 w-24 animate-pulse rounded bg-gray-200" />
              </li>
            ))}
          {errored && (
            <li className="shrink-0 text-xs text-red-600">
              카트 정보를 불러오지 못했습니다.
            </li>
          )}
          {!isLoading &&
            !errored &&
            ordered.map((p) => (
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
          {!isLoading && !errored && remaining > 0 && (
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
