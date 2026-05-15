import type { SafeBooking } from "../model/types";
import { BookingStatusBadge } from "./BookingStatusBadge";

type DepartureInfo = {
  departureDate: Date;
  returnDate: Date;
  product: { title: string };
};

type Props = {
  booking: SafeBooking;
  departure: DepartureInfo;
};

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatPrice(amount: number): string {
  return amount.toLocaleString("ko-KR") + "원";
}

export function BookingSummaryCard({ booking, departure }: Props) {
  const { adultCount, childCount, infantCount, totalPrice, status } = booking;

  const paxParts: string[] = [];
  if (adultCount > 0) paxParts.push(`성인 ${adultCount}명`);
  if (childCount > 0) paxParts.push(`아동 ${childCount}명`);
  if (infantCount > 0) paxParts.push(`영아 ${infantCount}명`);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      {/* 헤더: 상품명 + 상태 배지 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-bold text-gray-900">{departure.product.title}</h2>
        <BookingStatusBadge status={status} />
      </div>

      {/* 여행 정보 */}
      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
            출발일
          </dt>
          <dd className="mt-1 text-sm text-gray-900">{formatDate(departure.departureDate)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
            귀국일
          </dt>
          <dd className="mt-1 text-sm text-gray-900">{formatDate(departure.returnDate)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
            인원
          </dt>
          <dd className="mt-1 text-sm text-gray-900">{paxParts.join(" · ")}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
            결제 금액
          </dt>
          <dd className="mt-1 text-base font-semibold text-gray-900">
            {formatPrice(totalPrice)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
