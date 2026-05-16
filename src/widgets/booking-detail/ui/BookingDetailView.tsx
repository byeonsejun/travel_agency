import Link from "next/link";
import {
  BookingSummaryCard,
  BookingEventTimeline,
} from "@/entities/booking";
import type { BookingDetail } from "@/entities/booking";

type Props = { booking: BookingDetail };

export function BookingDetailView({ booking }: Props) {
  // 결제 완료 시 영수증 링크 노출 (Payment.receiptUrl — Toss 제공)
  const receipt = booking.payments.find(
    (p) => p.status === "PAID" && p.receiptUrl
  );

  return (
    <div className="space-y-8">
      {/* 예약 요약 카드 — 상태 배지 포함 */}
      <BookingSummaryCard booking={booking} departure={booking.departure} />

      {/* 영수증 링크 (PAID 상태에서만) */}
      {receipt?.receiptUrl && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-center justify-between">
          <p className="text-sm font-medium text-emerald-800">결제가 완료되었습니다.</p>
          <Link
            href={receipt.receiptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-emerald-700 underline hover:text-emerald-900"
          >
            영수증 보기
          </Link>
        </div>
      )}

      {/* 예약 이벤트 타임라인 */}
      <section>
        <h2 className="mb-4 text-base font-semibold text-gray-900">예약 이력</h2>
        <BookingEventTimeline events={booking.events} />
      </section>
    </div>
  );
}
