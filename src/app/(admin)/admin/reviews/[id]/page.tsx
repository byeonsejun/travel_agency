import { notFound } from "next/navigation";
import Link from "next/link";
import { getReviewForAdmin, getReportsForReview } from "@/entities/review";
import { reviewPhotoPublicUrl } from "@/shared/lib/supabase/photoMime";
import { PhotoGrid } from "@/shared/ui/PhotoGrid";
import {
  ReviewStatusToggle,
  ReportModerationActions,
} from "@/features/admin-review-moderation";
import { REPORT_REASON_LABELS } from "@/features/review-feed";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function AdminReviewDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [review, reports] = await Promise.all([
    getReviewForAdmin(id),
    getReportsForReview(id),
  ]);
  if (!review) notFound();

  const images = review.photos.map((p) => ({
    id: p.id,
    url: reviewPhotoPublicUrl(p.storagePath),
    alt: `후기 사진 ${p.order + 1}`,
  }));

  return (
    <div className="max-w-3xl">
      <Link
        href="/admin/reviews"
        className="text-sm text-gray-500 hover:underline"
      >
        ← 리뷰 목록
      </Link>

      {/* 기존 리뷰 본문 카드 */}
      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-gray-500">{review.productTitle}</p>
            <p className="mt-1 font-medium text-gray-900">
              {review.authorDisplayName} · {review.rating}점
            </p>
          </div>
          <ReviewStatusToggle reviewId={review.id} status={review.status} />
        </div>

        <p className="mt-4 whitespace-pre-wrap text-sm text-gray-700">
          {review.content}
        </p>

        {images.length > 0 && (
          <div className="mt-6">
            <p className="mb-2 text-xs font-medium text-gray-500">
              첨부 사진 {images.length}장
            </p>
            <PhotoGrid images={images} />
          </div>
        )}
      </div>

      {/* 신고 패널 */}
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">
            신고 {reports.openCount}건 (처리 대기)
          </h2>
          {reports.openCount > 0 && (
            <ReportModerationActions reviewId={review.id} />
          )}
        </div>

        {reports.openCount > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(
              Object.entries(reports.reasonCounts) as [
                keyof typeof REPORT_REASON_LABELS,
                number,
              ][]
            )
              .filter(([, n]) => n > 0)
              .map(([reason, n]) => (
                <span
                  key={reason}
                  className="rounded bg-white px-2 py-1 text-xs text-gray-700"
                >
                  {REPORT_REASON_LABELS[reason]} {n}
                </span>
              ))}
          </div>
        )}

        <ul className="mt-4 space-y-2">
          {reports.entries.map((e) => (
            <li
              key={e.id}
              className="rounded border border-gray-200 bg-white p-3 text-sm"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {REPORT_REASON_LABELS[e.reason]}
                </span>
                <span className="text-xs text-gray-400">
                  {e.reporterDisplayName} ·{" "}
                  {new Date(e.createdAt).toLocaleString("ko-KR")} · {e.status}
                </span>
              </div>
              {e.note && <p className="mt-1 text-gray-600">{e.note}</p>}
            </li>
          ))}
          {reports.entries.length === 0 && (
            <li className="text-sm text-gray-400">신고 이력 없음</li>
          )}
        </ul>
      </div>
    </div>
  );
}
