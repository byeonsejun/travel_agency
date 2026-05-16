import { notFound, redirect } from "next/navigation";
import { auth } from "@/features/auth/server/auth";
import { getBookingDetail } from "@/entities/booking";
import { BookingDetailView } from "@/widgets/booking-detail";

export const dynamic = "force-dynamic";

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
  const booking = await getBookingDetail(bookingId, session.user.id);
  if (!booking) notFound();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">예약 상세</h1>
      <BookingDetailView booking={booking} />
    </div>
  );
}
