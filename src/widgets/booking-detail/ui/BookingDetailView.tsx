import Link from "next/link";
import {
  BookingSummaryCard,
  BookingEventTimeline,
  isCancelableByUser,
} from "@/entities/booking";
import type { BookingDetail } from "@/entities/booking";
import { PaymentStatusBadge } from "@/entities/payment";
import { CancelBookingButton } from "@/features/booking-cancel";

type Props = { booking: BookingDetail };

function formatPrice(amount: number): string {
  return amount.toLocaleString("ko-KR") + "원";
}

function formatDateTime(d: Date): string {
  return new Date(d).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function BookingDetailView({ booking }: Props) {
  // 영수증은 가장 최근 PAID(혹은 환불 전이라도 receiptUrl이 있는) 결제에서만.
  const receipt = booking.payments.find(
    (p) => p.status === "PAID" && p.receiptUrl
  );

  // 결제 내역은 최신순(Server에서는 createdAt asc 가능성 있음 — UI에서 정렬 보장)
  const payments = [...booking.payments].sort(
    (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)
  );

  const cancelable = isCancelableByUser(booking.status);

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

      {/* 결제 내역 섹션 — PaymentStatus(PAID/CANCELED=환불완료/PENDING/FAILED) 시각화.
          refundBooking 성공 직후 Payment.status가 CANCELED로 갱신되며,
          revalidatePath로 RSC가 재렌더되어 자동으로 '환불 완료' 배지로 전환된다. */}
      {payments.length > 0 && (
        <section>
          <h2 className="mb-4 text-base font-semibold text-gray-900">결제 내역</h2>
          <ul className="space-y-2">
            {payments.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">
                    {formatPrice(p.amount)}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {p.canceledAt
                      ? `환불 ${formatDateTime(p.canceledAt)}`
                      : p.paidAt
                        ? `결제 ${formatDateTime(p.paidAt)}`
                        : `요청 ${formatDateTime(p.createdAt)}`}
                  </p>
                </div>
                <PaymentStatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 예약 이벤트 타임라인 */}
      <section>
        <h2 className="mb-4 text-base font-semibold text-gray-900">예약 이력</h2>
        <BookingEventTimeline events={booking.events} />
      </section>

      {/* 사용자 자가 취소 — ALLOWED_TRANSITIONS 화이트리스트로 게이트.
          취소 완료 후 revalidatePath로 RSC 재렌더, 화이트리스트에서 빠지며
          버튼 자동 hide(상태머신이 한 번의 단일 source of truth).
          PAID payment가 있으면 refundBooking 경로로 자동 dispatch된다. */}
      {cancelable && (
        <section className="flex justify-end border-t border-gray-100 pt-6">
          <CancelBookingButton bookingId={booking.id} />
        </section>
      )}
    </div>
  );
}
