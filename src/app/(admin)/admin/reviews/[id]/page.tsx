import { notFound } from "next/navigation";
import Link from "next/link";
import type { ReportStatus } from "@prisma/client";
import { getReviewForAdmin, getReportsForReview } from "@/entities/review";
import { reviewPhotoPublicUrl } from "@/shared/lib/supabase/photoMime";
import { PhotoGrid } from "@/shared/ui/PhotoGrid";
import {
  ReviewStatusToggle,
  ReportModerationActions,
} from "@/features/admin-review-moderation";
import { REPORT_REASON_LABELS } from "@/features/review-feed";
import { Badge } from "@/shared/ui/badge";
import { Card } from "@/shared/ui/card";

const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  OPEN: "대기",
  RESOLVED: "인정(숨김)",
  DISMISSED: "반려",
};


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
        className="text-sm text-muted-foreground hover:underline"
      >
        ← 리뷰 목록
      </Link>

      <h1 className="mt-4 text-2xl font-bold text-foreground">
        {review.productTitle} — 리뷰 상세
      </h1>

      {/* 기존 리뷰 본문 카드 */}
      <Card className="mt-4 p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{review.productTitle}</p>
            <p className="mt-1 font-medium text-foreground">
              {review.authorDisplayName} · {review.rating}점
            </p>
          </div>
          <ReviewStatusToggle reviewId={review.id} status={review.status} />
        </div>

        <p className="mt-4 whitespace-pre-wrap text-sm text-foreground">
          {review.content}
        </p>

        {images.length > 0 && (
          <div className="mt-6">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              첨부 사진 {images.length}장
            </p>
            <PhotoGrid images={images} />
          </div>
        )}
      </Card>

      {/* 신고 패널 */}
      <div className="mt-4 rounded-xl border border-yellow-200 bg-yellow-50 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-foreground">
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
                <Badge key={reason} variant="outline">
                  {REPORT_REASON_LABELS[reason]} {n}
                </Badge>
              ))}
          </div>
        )}

        <ul className="mt-4 space-y-2">
          {reports.entries.map((e) => (
            <li
              key={e.id}
              className="rounded-lg border border-border bg-card p-3 text-sm"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">
                  {REPORT_REASON_LABELS[e.reason]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {e.reporterDisplayName} ·{" "}
                  {new Date(e.createdAt).toLocaleString("ko-KR")} · {REPORT_STATUS_LABELS[e.status]}
                </span>
              </div>
              {e.note && <p className="mt-1 text-foreground">{e.note}</p>}
            </li>
          ))}
          {reports.entries.length === 0 && (
            <li className="text-sm text-muted-foreground">신고 이력 없음</li>
          )}
        </ul>
      </div>
    </div>
  );
}
