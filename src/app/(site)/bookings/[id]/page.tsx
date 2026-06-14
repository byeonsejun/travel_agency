import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/features/auth/server/auth";
import { getBookingDetail } from "@/entities/booking";
import { findActiveRefundJob } from "@/entities/payment";
import { BookingDetailView } from "@/widgets/booking-detail";
import { TransactionFallback } from "@/shared/ui/TransactionFallback";


type PageProps = {
  params: Promise<{ id: string }>;
};

// [ADR-0053] auth()/params/소유권 쿼리는 동적 → <Suspense> 안에서만 접근.
// 정적 셸(제목)은 prerender, 예약 상세(소유권 스코프 조회)는 per-request 스트리밍.
export default function BookingDetailPage({ params }: PageProps) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold text-foreground">예약 상세</h1>
      <Suspense fallback={<TransactionFallback variant="detail" />}>
        <BookingDetailContent params={params} />
      </Suspense>
    </div>
  );
}

async function BookingDetailContent({ params }: PageProps) {
  // Frontend R3: Next 15 async API
  const { id: bookingId } = await params;

  // 인증 가드
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=/bookings/${bookingId}`);
  }

  // D5 소유권=쿼리 경계: userId 스코프 조회 → null이면 notFound
  // RefundJob 조회는 booking 소유권이 확정된 뒤에만 사용 (소유자 정보 우회 불가).
  const booking = await getBookingDetail(bookingId, session.user.id);
  if (!booking) notFound();

  // 활성(PENDING/IN_PROGRESS) RefundJob — cancel 버튼 게이트 및 "환불 처리 중" 배지에 사용.
  const activeRefundJob = await findActiveRefundJob(bookingId);

  return <BookingDetailView booking={booking} activeRefundJob={activeRefundJob} />;
}
