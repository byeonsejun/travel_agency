import { notFound, redirect } from "next/navigation";
import { auth } from "@/features/auth/server/auth";
import { ConfirmPayment } from "@/features/checkout";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    paymentKey?: string;
    orderId?: string;
    amount?: string;
  }>;
};

export default async function SuccessPage({ params, searchParams }: PageProps) {
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
    <div className="mx-auto max-w-lg px-4 py-20">
      <ConfirmPayment
        bookingId={bookingId}
        paymentKey={paymentKey}
        orderId={orderId}
        amount={amount}
      />
    </div>
  );
}
