import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/features/auth/server/auth";
import { getProductById } from "@/entities/product";
import { getDepartureById } from "@/entities/departure";
import { CheckoutForm } from "@/features/checkout/ui/CheckoutForm";
import { env } from "@/shared/lib/env";


// 토스 공식 테스트 클라이언트 키 (공개값, 비-프로덕션 폴백용)
const TOSS_TEST_CLIENT_KEY = "test_ck_D5GePWvyJnrK0W0k6q8gLzN97Eqwd36";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ departureId?: string }>;
};

// [ADR-0053] auth()/params/searchParams는 동적 → <Suspense> 안에서만 접근.
// 정적 셸(제목)은 즉시 prerender, 결제 폼(인증·가드·좌석 조회 의존)은 스트리밍.
// 결제 상태는 절대 캐시되지 않음(per-request 스트리밍, NO-REAL-MONEY 무손상).
export default function CheckoutPage({ params, searchParams }: PageProps) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">예약 정보 입력</h1>
      <Suspense fallback={<CheckoutFormSkeleton />}>
        <CheckoutContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function CheckoutContent({ params, searchParams }: PageProps) {
  // Frontend R3: Next 15 async API
  const { id: productId } = await params;
  const { departureId } = await searchParams;

  // 인증 가드 — 미인증 시 login으로 redirect
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=/products/${productId}/checkout${departureId ? `?departureId=${departureId}` : ""}`);
  }

  if (!departureId) notFound();

  const [product, departure] = await Promise.all([
    getProductById(productId),
    getDepartureById(departureId),
  ]);

  if (!product || !departure) notFound();
  if (departure.remainingSeats <= 0 || departure.status === "CANCELED") notFound();

  // D2: 서버에서 clientKey 읽어 client prop으로 주입 (NEXT_PUBLIC_ 불필요)
  const clientKey =
    env.TOSS_CLIENT_KEY ??
    (env.NODE_ENV !== "production" ? TOSS_TEST_CLIENT_KEY : "");

  // 비-프로덕션: 실제 토스 결제창(샌드박스) 대신 success redirect를 직접
  // 시뮬레이션. 서버 측 confirm이 이미 localhost Mock으로 격리된 것과
  // 일관되게 클라이언트도 외부 부작용 0으로 맞춘다 (feedback_dev_external_io).
  // PAYMENT_FORCE_REAL=1 이면 1단계(샌드박스 실거래 테스트)로 전환 —
  // Mock 폴백을 끄고 실제 토스 결제창을 띄운다 (test_ 키 한정, 과금 0).
  const devFallback =
    env.NODE_ENV !== "production" && !env.PAYMENT_FORCE_REAL;

  return (
    <CheckoutForm
      departureId={departureId}
      productTitle={product.title}
      departureDateLabel={departure.departureDate.toLocaleDateString("ko-KR")}
      returnDateLabel={departure.returnDate.toLocaleDateString("ko-KR")}
      priceAdult={departure.priceAdult}
      priceChild={departure.priceChild}
      priceInfant={departure.priceInfant}
      remainingSeats={departure.remainingSeats}
      clientKey={clientKey}
      devFallback={devFallback}
    />
  );
}

function CheckoutFormSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
      <div className="h-40 animate-pulse rounded-xl bg-gray-100" />
      <div className="h-12 animate-pulse rounded-xl bg-gray-100" />
    </div>
  );
}
