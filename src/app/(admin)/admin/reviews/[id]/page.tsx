import { notFound } from "next/navigation";
import Link from "next/link";
import { getReviewForAdmin } from "@/entities/review";
import { reviewPhotoPublicUrl } from "@/shared/lib/supabase/photoMime";
import { PhotoGrid } from "@/shared/ui/PhotoGrid";
import { ReviewStatusToggle } from "@/features/admin-review-moderation";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function AdminReviewDetailPage({ params }: PageProps) {
  const { id } = await params;
  const review = await getReviewForAdmin(id);
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
    </div>
  );
}
