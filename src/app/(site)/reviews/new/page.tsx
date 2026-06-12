import { redirect } from "next/navigation";

import { getReviewByBooking } from "@/entities/review";
import { auth } from "@/features/auth/server/auth";
import { ReviewForm } from "@/features/review-upload";
import { db } from "@/shared/lib/db";


type PageProps = {
  searchParams: Promise<{ bookingId?: string }>;
};

// 후기 작성 페이지. RSC 단계에서 4중 게이트 사전 검증 — 자격 미충족 케이스는
// 폼을 보여주지 않고 /mypage 로 즉시 redirect. submitReview Server Action 도
// 동일 게이트를 재실행하므로 (defense in depth) RSC 가드 우회 경로는 차단됨.
export default async function ReviewNewPage({ searchParams }: PageProps) {
  const { bookingId } = await searchParams;

  if (!bookingId) {
    redirect("/mypage");
  }

  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=/reviews/new?bookingId=${bookingId}`);
  }
  const userId = session.user.id;

  // 소유권 + 상태 + 기존 리뷰 부재 — 단일 round-trip 사전 검증.
  const [booking, existing] = await Promise.all([
    db.booking.findUnique({
      where: { id: bookingId },
      select: {
        userId: true,
        status: true,
        departure: { select: { product: { select: { title: true } } } },
      },
    }),
    getReviewByBooking(bookingId),
  ]);

  if (!booking || booking.userId !== userId) {
    redirect("/mypage");
  }
  if (booking.status !== "COMPLETED") {
    redirect("/mypage");
  }
  if (existing) {
    redirect("/mypage");
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">후기 작성</h1>
        <p className="mt-1 text-sm text-gray-500">
          다녀오신{" "}
          <span className="font-medium text-gray-700">
            {booking.departure.product.title}
          </span>
          {" "}여행은 어떠셨나요?
        </p>
      </header>
      <ReviewForm bookingId={bookingId} />
    </div>
  );
}
