import Link from "next/link";
import {
  BookingSummaryCard,
  BookingEventTimeline,
  BookingProgressBar,
  isCancelableByUser,
} from "@/entities/booking";
import type { BookingDetail } from "@/entities/booking";
import { PaymentStatusBadge } from "@/entities/payment";
import type { ActiveRefundJob } from "@/entities/payment";
import { computePenalty, getTiersBySnapshot } from "@/entities/penalty-policy";
import { CancelBookingButton } from "@/features/booking-cancel";

type Props = {
  booking: BookingDetail;
  /** 활성 RefundJob — 존재하면 cancel 버튼 hide + "환불 처리 중" 배지 표시. */
  activeRefundJob?: ActiveRefundJob | null;
};

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

export async function BookingDetailView({ booking, activeRefundJob }: Props) {
  // 영수증은 가장 최근 PAID(혹은 환불 전이라도 receiptUrl이 있는) 결제에서만.
  const receipt = booking.payments.find(
    (p) => p.status === "PAID" && p.receiptUrl
  );

  // 결제 내역은 최신순(Server에서는 createdAt asc 가능성 있음 — UI에서 정렬 보장)
  const payments = [...booking.payments].sort(
    (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)
  );

  // 활성 RefundJob 존재 시 cancel 버튼을 숨긴다. 같은 사용자가 동일 booking에
  // 재시도하지 못하게 막아 REFUND_ALREADY_REQUESTED 에러 노출을 사전 차단.
  const refundInFlight = !!activeRefundJob;
  const cancelable = isCancelableByUser(booking.status) && !refundInFlight;

  // 자가취소 미리보기: PAID 결제 + 출발일로 위약금/환불액을 RSC에서 미리 계산.
  // 실제 동결은 Server Action 실행 시점에 권위 재계산 (spec §6.1).
  const paidForPreview = booking.payments.find((p) => p.status === "PAID");
  // 예약 스냅샷(key, version)으로 위약금 tiers 복원 (server-only DB read — RSC).
  const tiers = await getTiersBySnapshot(
    booking.penaltyPolicyKey,
    booking.penaltyPolicyVersion,
  );
  const refundPreview = paidForPreview
    ? computePenalty({
        baseAmount: paidForPreview.amount,
        departureDate: booking.departure.departureDate,
        now: new Date(),
        tiers,
      })
    : null;

  return (
    <div className="space-y-8">
      {/* 예약 진행 상태 바 (PRD §4.1D) — 상세 최상단 배치 */}
      <BookingProgressBar status={booking.status} />

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

      {/* 활성 RefundJob 안내 — PG 취소가 한 번 실패해 backoff 재시도 큐에 적재된
          상태. cancel 버튼은 자동 hide되어 사용자가 이중 요청을 못 보내게 한다. */}
      {activeRefundJob && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-900">
                환불 처리 중 — 자동 재시도
              </p>
              <p className="mt-1 text-xs text-amber-800">
                {activeRefundJob.attempts > 0
                  ? `이전 시도가 일시적으로 실패하여 자동으로 재시도되고 있습니다 (시도 횟수: ${activeRefundJob.attempts}).`
                  : "결제 시스템과 환불 처리를 진행하고 있습니다."}
                {activeRefundJob.nextRunAt && (
                  <>
                    {" "}
                    다음 재시도: {" "}
                    <time
                      dateTime={activeRefundJob.nextRunAt.toISOString()}
                      className="font-medium"
                    >
                      {new Date(activeRefundJob.nextRunAt).toLocaleString(
                        "ko-KR",
                        {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        }
                      )}
                    </time>
                  </>
                )}
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center rounded-full bg-amber-200 px-3 py-1 text-xs font-medium text-amber-900">
              처리 중
            </span>
          </div>
        </div>
      )}

      {/* 결제 내역 섹션 — PaymentStatus(PAID/CANCELED=환불완료/PENDING/FAILED) 시각화.
          refundBooking 성공 직후 Payment.status가 CANCELED로 갱신되며,
          revalidatePath로 RSC가 재렌더되어 자동으로 '환불 완료' 배지로 전환된다. */}
      {payments.length > 0 && (
        <section>
          <h2 className="mb-4 text-base font-semibold text-foreground">결제 내역</h2>
          <ul className="space-y-2">
            {payments.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {formatPrice(p.amount)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
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
        <h2 className="mb-4 text-base font-semibold text-foreground">예약 이력</h2>
        <BookingEventTimeline events={booking.events} />
      </section>

      {/* 사용자 자가 취소 — ALLOWED_TRANSITIONS 화이트리스트로 게이트.
          취소 완료 후 revalidatePath로 RSC 재렌더, 화이트리스트에서 빠지며
          버튼 자동 hide(상태머신이 한 번의 단일 source of truth).
          PAID payment가 있으면 refundBooking 경로로 자동 dispatch된다. */}
      {cancelable && (
        <section className="flex justify-end border-t border-border pt-6">
          <CancelBookingButton bookingId={booking.id} refundPreview={refundPreview} />
        </section>
      )}
    </div>
  );
}
