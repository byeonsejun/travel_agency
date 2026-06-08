"use client";

import { useEffect, useState, useTransition } from "react";
import type { ReviewListItem } from "@/entities/review";
import { loadMoreReviewsAction } from "../server/loadMore";
import { ReviewCard } from "./ReviewCard";

type Props = {
  productId: string;
  initialItems: ReviewListItem[];
  initialCursor: string | null;
};

// 첫 페이지(10건)는 PDP(RSC)가 prerender 로 전달 → SEO/초기 페인트 보존.
// "더보기"만 client 에서 server action 으로 추가 로드·누적.
// viewer 컨텍스트(로그인 여부·본인 리뷰 id)는 마운트 후 /api/reviews/viewer-context
// 를 비동기 fetch 해 해소 — PDP ISR(revalidate=3600) 보존을 위해 RSC 에서
// auth() 를 호출하지 않는다 (위시리스트 island 패턴, ADR-0018).
export function ReviewFeed({ productId, initialItems, initialCursor }: Props) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [isPending, startTransition] = useTransition();

  // viewer 컨텍스트 — 마운트 후 비동기 해소.
  const [authenticated, setAuthenticated] = useState(false);
  const [ownIds, setOwnIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/reviews/viewer-context?productId=${productId}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setAuthenticated(Boolean(data.authenticated));
        setOwnIds(new Set<string>(data.ownReviewIds ?? []));
      })
      .catch(() => {
        /* AbortError 또는 네트워크 실패: 신고 버튼은 기본 노출 + 클릭 시 로그인 유도로 폴백 */
      });
    return () => controller.abort();
  }, [productId]);

  if (items.length === 0) return null;

  function loadMore() {
    if (!cursor) return;
    startTransition(async () => {
      const page = await loadMoreReviewsAction(productId, cursor!);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    });
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-4">
        {items.map((review) => (
          <ReviewCard
            key={review.id}
            review={review}
            isAuthenticated={authenticated}
            isOwn={ownIds.has(review.id)}
          />
        ))}
      </ul>
      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={isPending}
          className="w-full rounded-lg border border-gray-300 bg-white py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {isPending ? "불러오는 중…" : "후기 더보기"}
        </button>
      )}
    </div>
  );
}
