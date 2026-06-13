import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/features/auth/server/auth";
import { ConfirmPayment } from "@/features/checkout";


type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    paymentKey?: string;
    orderId?: string;
    amount?: string;
  }>;
};

// [ADR-0053] auth()/params/searchParams는 동적 → <Suspense> 안에서만 접근.
// 결제 confirm(2-phase)은 절대 prerender되지 않음(per-request 스트리밍, NO-REAL-MONEY 무손상).
export default function SuccessPage({ params, searchParams }: PageProps) {
  return (
    <div className="mx-auto max-w-lg px-4 py-20">
      <Suspense fallback={<ConfirmSkeleton />}>
        <SuccessContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SuccessContent({ params, searchParams }: PageProps) {
  // Frontend R3: Next 15 async API
  const { id: bookingId } = await params;
  const { paymentKey, orderId, amount: amountStr } = await searchParams;

  // 인증 가드 — 미인증 시 login redirect
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=/bookings/${bookingId}/success`);
  }

  // 토스 redirect 파라미터 없으면 404
  if (!paymentKey || !orderId || !amountStr) notFound();

  const amount = parseInt(amountStr, 10);
  if (!Number.isInteger(amount) || amount <= 0) notFound();

  return (
    <ConfirmPayment
      bookingId={bookingId}
      paymentKey={paymentKey}
      orderId={orderId}
      amount={amount}
    />
  );
}

function ConfirmSkeleton() {
  return (
    <div className="space-y-4 text-center">
      <div className="mx-auto h-16 w-16 animate-pulse rounded-full bg-gray-100" />
      <div className="mx-auto h-6 w-48 animate-pulse rounded bg-gray-100" />
      <div className="mx-auto h-4 w-64 animate-pulse rounded bg-gray-100" />
    </div>
  );
}
