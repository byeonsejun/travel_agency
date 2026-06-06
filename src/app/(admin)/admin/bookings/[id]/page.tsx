import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAdminBookingDetail,
  isCancelableByUser,
  BookingStatusBadge,
  BookingSummaryCard,
  BookingEventTimeline,
  ALLOWED_TRANSITIONS,
} from "@/entities/booking";
import { PaymentStatusBadge, findActiveRefundJob, refundableAmount } from "@/entities/payment";
import { AdminCancelBookingButton } from "@/features/admin-booking-cancel";
import { TravelerCancelPanel, DiscretionaryRefundPanel } from "@/widgets/booking-detail";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

function formatDateTime(d: Date): string {
  return new Date(d).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminBookingDetailPage({ params }: PageProps) {
  const { id } = await params;

  // layout이 ADMIN role 가드 통과 → 권한 검증 추가 불필요(belt-and-suspenders는 layout이 1차).
  const booking = await getAdminBookingDetail(id);
  if (!booking) notFound();

  const activeRefundJob = await findActiveRefundJob(id);

  // ALLOWED_TRANSITIONS을 단일 SoT로 사용 (사용자/관리자 동일 화이트리스트)
  const cancelableByAgency =
    ALLOWED_TRANSITIONS[booking.status].includes("CANCELED_BY_AGENCY") &&
    !activeRefundJob; // 환불 처리 중이면 중복 호출 방지

  const payments = [...booking.payments].sort(
    (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/bookings"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← 예약 목록으로
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">예약 상세</h1>
        <p className="mt-1 font-mono text-xs text-gray-500">{booking.id}</p>
      </div>

      {/* 고객 정보 */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          고객 정보
        </h2>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-gray-500">이름</dt>
            <dd className="mt-0.5 font-medium text-gray-900">
              {booking.user.name ?? "(no name)"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">이메일</dt>
            <dd className="mt-0.5 text-gray-900">
              {booking.user.email ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">user ID</dt>
            <dd className="mt-0.5 font-mono text-xs text-gray-500">
              {booking.user.id}
            </dd>
          </div>
        </dl>
      </section>

      {/* 예약 요약 */}
      <BookingSummaryCard booking={booking} departure={booking.departure} />

      {/* 활성 RefundJob 안내 */}
      {activeRefundJob && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-900">
                환불 처리 중 — cron worker 자동 재시도
              </p>
              <p className="mt-1 text-xs text-amber-800">
                상태: {activeRefundJob.status} · 시도{" "}
                {activeRefundJob.attempts}회
                {activeRefundJob.nextRunAt && (
                  <>
                    {" "}
                    · 다음 재시도{" "}
                    {formatDateTime(activeRefundJob.nextRunAt)}
                  </>
                )}
              </p>
              {activeRefundJob.lastError && (
                <p className="mt-1 break-all font-mono text-xs text-amber-700">
                  lastError: {activeRefundJob.lastError.slice(0, 120)}
                </p>
              )}
            </div>
            <BookingStatusBadge status={booking.status} />
          </div>
        </div>
      )}

      {/* 결제 내역 */}
      {payments.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            결제 내역
          </h2>
          <ul className="space-y-2">
            {payments.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">
                    {p.amount.toLocaleString("ko-KR")}원
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-gray-500">
                    {p.tossPaymentKey?.slice(0, 28) ?? "no key"} ...
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {p.canceledAt
                      ? `환불 ${formatDateTime(p.canceledAt)}`
                      : p.paidAt
                        ? `결제 ${formatDateTime(p.paidAt)}`
                        : `요청 ${formatDateTime(p.createdAt)}`}
                  </p>
                  {(p.status === "PAID" || p.status === "PARTIAL_CANCELED") && (
                    <p className="mt-0.5 text-xs text-gray-500">
                      환불됨: {p.refundedAmount.toLocaleString("ko-KR")}원 /
                      잔여: {refundableAmount(p).toLocaleString("ko-KR")}원
                    </p>
                  )}
                </div>
                <PaymentStatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 예약 이벤트 타임라인 */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          예약 이력 (BookingEvent append-only)
        </h2>
        <BookingEventTimeline events={booking.events} />
      </section>

      {/* ── 다회 부분 환불 패널 (Phase 8) ── */}
      {(() => {
        const paidPayment = payments.find(
          (p) => p.status === "PAID" || p.status === "PARTIAL_CANCELED"
        );
        if (!paidPayment) return null;
        return (
          <div className="space-y-4">
            {/* 민감 필드(passportNo 암호문·birthDate·phone·email)가 client island
                RSC 페이로드로 직렬화되지 않도록, 패널이 실제로 쓰는 안전 필드만 추려서 전달한다. */}
            <TravelerCancelPanel
              bookingId={booking.id}
              travelers={booking.travelers.map((t) => ({
                id: t.id,
                firstNameEn: t.firstNameEn,
                lastNameEn: t.lastNameEn,
                paxType: t.paxType,
                unitPrice: t.unitPrice,
                canceledAt: t.canceledAt,
              }))}
            />
            <DiscretionaryRefundPanel
              bookingId={booking.id}
              paymentId={paidPayment.id}
              refundable={refundableAmount(paidPayment)}
            />
          </div>
        );
      })()}

      {/* 관리자 직권 취소 */}
      {cancelableByAgency && (
        <section className="flex justify-end border-t border-gray-100 pt-6">
          <AdminCancelBookingButton bookingId={booking.id} />
        </section>
      )}
      {!cancelableByAgency && (
        <section className="border-t border-gray-100 pt-6 text-right">
          <p className="text-xs text-gray-400">
            {activeRefundJob
              ? "환불 처리 진행 중 — 큐 완료 후 취소 가능"
              : `현재 상태(${booking.status})에서는 직권 취소가 불가합니다.`}
          </p>
        </section>
      )}

      {/* 디버그 — booking.isCancelableByUser 참고 표시 (admin 시인성) */}
      <p className="text-right text-[10px] text-gray-300">
        ref: isCancelableByUser(status) ={" "}
        {String(isCancelableByUser(booking.status))}
      </p>
    </div>
  );
}
