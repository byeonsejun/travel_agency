import Link from "next/link";
import {
  BookingStatusBadge,
  type BookingListItem,
} from "@/entities/booking";
import { EmptyState } from "@/shared/ui/EmptyState";

type Props = {
  bookings: BookingListItem[];
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

export function BookingHistoryList({ bookings }: Props) {
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

              <div className="mt-4 flex items-end justify-between border-t border-gray-100 pt-4">
                <span className="text-xs text-gray-400">
                  {booking.createdAt.toLocaleDateString("ko-KR")} 예약
                </span>
                <span className="text-lg font-bold text-gray-900">
                  {booking.totalPrice.toLocaleString("ko-KR")}원
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
