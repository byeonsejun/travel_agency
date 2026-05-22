// PDP 리뷰 카드 grid. RSC — getReviewPhotoPublicUrl 은 server-only 동기 helper
// (Supabase URL string 조립만, network 0)로 next/image src 를 구성한다.

import Image from "next/image";

import type { ReviewListItem } from "@/entities/review";
import { getReviewPhotoPublicUrl } from "@/shared/lib/supabase/storage";

type Props = {
  reviews: ReviewListItem[];
};

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
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// 작성자 표시 이름은 entities/review query 레이어에서 사전 마스킹되어 내려옴
// (`ReviewListItem.user.displayName`). 본 widget 은 raw email/name 을 절대
// 받지 않는다 — type 으로 봉쇄.

export function ReviewList({ reviews }: Props) {
  if (reviews.length === 0) {
    return null;
  }

  return (
    <ul className="space-y-4">
      {reviews.map((r) => (
        <li
          key={r.id}
          className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900">
                {r.user.displayName}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <Stars value={r.rating} />
                <span className="text-xs text-gray-400">
                  {formatDate(r.createdAt)}
                </span>
              </div>
            </div>
          </div>

          <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">
            {r.content}
          </p>

          {r.photos.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
              {r.photos.map((p) => {
                const url = getReviewPhotoPublicUrl(p.storagePath);
                return (
                  <div
                    key={p.id}
                    className="relative aspect-square overflow-hidden rounded-lg border border-gray-100"
                  >
                    <Image
                      src={url}
                      alt={`후기 사진 ${p.order + 1}`}
                      fill
                      sizes="(min-width: 640px) 120px, 33vw"
                      className="object-cover"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
