import { notFound, redirect } from "next/navigation";
import { auth } from "@/features/auth/server/auth";
import { getBookingDetail } from "@/entities/booking";
import { findActiveRefundJob } from "@/entities/payment";
import { BookingDetailView } from "@/widgets/booking-detail";


type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function BookingDetailPage({ params }: PageProps) {
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

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">예약 상세</h1>
      <BookingDetailView booking={booking} activeRefundJob={activeRefundJob} />
    </div>
  );
}
