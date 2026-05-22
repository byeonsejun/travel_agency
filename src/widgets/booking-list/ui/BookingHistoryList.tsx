import Link from "next/link";
import {
  BookingStatusBadge,
  BookingProgressBar,
  type BookingListItem,
} from "@/entities/booking";
import { EmptyState } from "@/shared/ui/EmptyState";

type Props = {
  bookings: BookingListItem[];
  // 페이지에서 단일 IN 쿼리로 사전 계산한 "후기가 작성된 booking id" Set.
  // 카드별 분기(작성하기 vs 내 후기 보기)를 N+1 없이 결정.
  bookingIdsWithReview?: Set<string>;
};

function formatDate(d: Date): string {
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function totalPax(b: BookingListItem): number {
  return b.adultCount + b.childCount + b.infantCount;
}

export function BookingHistoryList({ bookings, bookingIdsWithReview }: Props) {
  if (bookings.length === 0) {
    return (
      <EmptyState
        title="아직 예약 내역이 없습니다."
        description="원하는 여행을 검색하고 첫 예약을 시작해 보세요."
        action={
          <Link
            href="/search"
            className="inline-block rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            여행 검색하러 가기
          </Link>
        }
      />
    );
  }

  return (
    <ul className="space-y-4">
      {bookings.map((booking) => {
        const { departure } = booking;
        const period = `${formatDate(departure.departureDate)} ~ ${formatDate(departure.returnDate)}`;
        const showReviewCTA = booking.status === "COMPLETED";
        const hasReview =
          showReviewCTA && (bookingIdsWithReview?.has(booking.id) ?? false);

        return (
          <li
            key={booking.id}
            className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md"
          >
            <Link
              href={`/bookings/${booking.id}`}
              className="block p-5"
              aria-label={`예약 상세 — ${departure.product.title}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-semibold text-gray-900">
                    {departure.product.title}
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">{period}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    예약 인원 {totalPax(booking)}명 · 예약 ID {booking.id.slice(-8)}
                  </p>
                </div>
                <BookingStatusBadge status={booking.status} />
              </div>

              {/* 예약 진행 상태 바 (PRD §4.1D) */}
              <BookingProgressBar status={booking.status} className="mt-5" />

              <div className="mt-5 flex items-end justify-between border-t border-gray-100 pt-4">
                <span className="text-xs text-gray-400">
                  {booking.createdAt.toLocaleDateString("ko-KR")} 예약
                </span>
                <span className="text-lg font-bold text-gray-900">
                  {booking.totalPrice.toLocaleString("ko-KR")}원
                </span>
              </div>
            </Link>

            {/* 후기 CTA — Link 중첩 회피를 위해 메인 Link 밖 별도 영역에 배치. */}
            {showReviewCTA && (
              <div className="border-t border-gray-100 bg-gray-50 px-5 py-3">
                {hasReview ? (
                  <Link
                    href={`/products/${departure.product.id}`}
                    className="inline-flex items-center text-sm font-medium text-indigo-700 hover:text-indigo-900"
                  >
                    내 후기 보기 →
                  </Link>
                ) : (
                  <Link
                    href={`/reviews/new?bookingId=${booking.id}`}
                    className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
                  >
                    후기 작성하기
                  </Link>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
