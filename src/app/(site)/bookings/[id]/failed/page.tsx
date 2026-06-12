import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/features/auth/server/auth";
import { getBookingForRetry } from "@/entities/booking";


type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    reason?: string;  // ConfirmPayment → failed 경로
    code?: string;    // Toss failUrl 직접 redirect
    message?: string; // Toss failUrl 직접 redirect
    orderId?: string; // Toss failUrl 직접 redirect (참고용)
  }>;
};

export default async function FailedPage({ params, searchParams }: PageProps) {
  // Frontend R3: Next 15 async API
  const { id: bookingId } = await params;
  const { reason, code, message } = await searchParams;

  // 인증 가드
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=/bookings/${bookingId}/failed`);
  }

  // D5 소유권 검증: userId 스코프 쿼리 → null이면 notFound (타인 booking 차단)
  const booking = await getBookingForRetry(bookingId, session.user.id);
  if (!booking) notFound();

  // 실패 사유 조립
  // 우선순위: reason(내부) > message(Toss 한국어) > code(Toss 코드) > 기본
  const displayReason =
    reason ??
    message ??
    (code ? `오류 코드: ${code}` : null) ??
    "결제에 실패했습니다";

  // 재시도 링크 — 동일 departure 재선택, seq 증가로 새 orderId 생성 (D3)
  const retryUrl = `/products/${booking.departure.productId}/checkout?departureId=${booking.departureId}`;

  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      {/* 에러 아이콘 */}
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
        <svg
          className="h-8 w-8 text-red-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </div>

      {/* 제목 */}
      <h1 className="text-xl font-bold text-gray-900">결제에 실패했습니다</h1>

      {/* 실패 사유 */}
      <p className="mt-3 text-sm text-gray-600">{displayReason}</p>

      {/* 에러 코드 (Toss 직접 redirect 시 디버그 참고용) */}
      {code && (
        <p className="mt-1 text-xs text-gray-400">오류 코드: {code}</p>
      )}

      {/* CTA */}
      <div className="mt-10 flex flex-col gap-3">
        <Link
          href={retryUrl}
          className="w-full rounded-xl bg-indigo-600 py-3 text-center font-semibold text-white transition-colors hover:bg-indigo-700"
        >
          다시 결제하기
        </Link>
        <Link
          href="/"
          className="w-full rounded-xl border border-gray-200 bg-white py-3 text-center text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          홈으로 돌아가기
        </Link>
      </div>
    </div>
  );
}
