"use client";

import { useState, useTransition } from "react";
import type { ReviewListItem } from "@/entities/review";
import { loadMoreReviewsAction } from "../server/loadMore";
import { ReviewCard } from "./ReviewCard";

type Props = {
  productId: string;
  initialItems: ReviewListItem[];
  initialCursor: string | null;
  isAuthenticated: boolean;
};

// 첫 페이지(10건)는 PDP(RSC)가 prerender 로 전달 → SEO/초기 페인트 보존.
// "더보기"만 client 에서 server action 으로 추가 로드·누적.
export function ReviewFeed({ productId, initialItems, initialCursor, isAuthenticated }: Props) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [isPending, startTransition] = useTransition();

  if (items.length === 0) return null;

  function loadMore() {
    if (!cursor) return;
    startTransition(async () => {
      const page = await loadMoreReviewsAction(productId, cursor);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    });
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-4">
        {items.map((r) => (
          <ReviewCard key={r.id} review={r} isAuthenticated={isAuthenticated} />
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
