"use client";

import type { ReviewListItem } from "@/entities/review";
import { reviewPhotoPublicUrl } from "@/shared/lib/supabase/photoMime";
import { PhotoGrid } from "@/shared/ui/PhotoGrid";

function Stars({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${value}점`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          viewBox="0 0 20 20"
          aria-hidden="true"
          className={`h-4 w-4 ${n <= value ? "fill-amber-400" : "fill-gray-200"}`}
        >
          <path d="M9.05.927C9.349.012 10.651.012 10.95.927l1.713 5.272a1 1 0 00.95.69h5.546c.962 0 1.362 1.232.586 1.798l-4.488 3.26a1 1 0 00-.364 1.118l1.713 5.272c.299.916-.756 1.677-1.539 1.118l-4.488-3.26a1 1 0 00-1.175 0l-4.488 3.26c-.783.56-1.838-.202-1.539-1.118l1.713-5.272a1 1 0 00-.364-1.118L2.255 8.687c-.776-.566-.377-1.798.586-1.798h5.547a1 1 0 00.949-.69L9.05.927z" />
        </svg>
      ))}
    </div>
  );
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// 작성자 displayName 은 entities query 레이어에서 사전 마스킹됨 — raw PII 미수신.
export function ReviewCard({ review }: { review: ReviewListItem }) {
  const images = review.photos.map((p) => ({
    id: p.id,
    url: reviewPhotoPublicUrl(p.storagePath),
    alt: `후기 사진 ${p.order + 1}`,
  }));

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">
            {review.user.displayName}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <Stars value={review.rating} />
            <span className="text-xs text-gray-400">
              {formatDate(review.createdAt)}
            </span>
          </div>
        </div>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">
        {review.content}
      </p>
      {images.length > 0 && (
        <div className="mt-4">
          <PhotoGrid images={images} />
        </div>
      )}
    </li>
  );
}
