"use client";

import { Suspense, useEffect, useState } from "react";
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
function FloatingCompareCartInner() {
  const searchParams = useSearchParams();
  const ids = parseCompareIds(searchParams.get("compareIds") ?? undefined);
  const idsKey = ids.join(",");

  // 로드된 key 를 결과와 함께 저장 → isLoading 을 파생(동기 setState-in-effect 제거).
  // idsKey==="" (빈 카트)는 이미 loaded(빈 결과)로 간주해 별도 동기 setState 불필요.
  const [state, setState] = useState<{
    key: string;
    products: CartProduct[];
    errored: boolean;
  }>({ key: "", products: [], errored: false });
  const isLoading = state.key !== idsKey;

  useEffect(() => {
    if (idsKey === "") return; // 빈 카트 — 초기 state(key==="")가 곧 loaded
    const controller = new AbortController();
    fetch(`/api/compare/products?ids=${encodeURIComponent(idsKey)}`, {
      signal: controller.signal,
    })
      .then((r) =>
        r.ok
          ? (r.json() as Promise<{ products: CartProduct[] }>)
          : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then((d) => setState({ key: idsKey, products: d.products, errored: false }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setState({ key: idsKey, products: [], errored: true });
      });
    return () => controller.abort();
  }, [idsKey]);

  if (ids.length === 0) return null;

  const errored = state.errored;
  // URL 의 ids 순서대로 정렬해 사용자가 담은 순서를 보존.
  const items = state.products.reduce<Map<string, CartProduct>>(
    (acc, p) => acc.set(p.id, p),
    new Map(),
  );
  const ordered = ids
    .map((id) => items.get(id))
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

// useSearchParams 의존을 정적 prerender 에서 격리 — Suspense 없으면 PDP(/products/[id])
// 가 CSR 로 강제 fallback 되어 ISR 깨짐. 카트는 fixed-bottom 이라 fallback null 에도
// CLS 0 (공간 예약 불필요).
export function FloatingCompareCart() {
  return (
    <Suspense fallback={null}>
      <FloatingCompareCartInner />
    </Suspense>
  );
}
