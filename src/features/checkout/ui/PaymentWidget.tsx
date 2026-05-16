"use client";

import { useState } from "react";
import { loadTossPayments, ANONYMOUS } from "@tosspayments/tosspayments-sdk";

type Props = {
  bookingId: string;
  orderId: string;
  amount: number;
  customerName: string;
  customerEmail: string | null;
  clientKey: string;
};

export function PaymentWidget({
  bookingId,
  orderId,
  amount,
  customerName,
  customerEmail,
  clientKey,
}: Props) {
  const [isPaying, setIsPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // clientKey 누락 시 결제 비활성 + 안내 (런타임 크래시 금지, Task 7 명세)
  if (!clientKey) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm font-medium text-red-700">결제를 진행할 수 없습니다.</p>
        <p className="mt-1 text-xs text-red-500">
          결제 설정이 누락되었습니다. 관리자에게 문의해 주세요.
        </p>
      </div>
    );
  }

  // useEffect 미사용 — SDK 로드/결제창 호출은 사용자 클릭 핸들러에서만 (Frontend R7)
  async function handlePayClick() {
    if (isPaying) return;
    setIsPaying(true);
    setError(null);

    try {
      const tossPayments = await loadTossPayments(clientKey);
      const payment = tossPayments.payment({ customerKey: ANONYMOUS });

      // Redirect 방식: successUrl/failUrl로 페이지 이동 → 이후 코드 실행 안됨
      await payment.requestPayment({
        method: "CARD",
        amount: { currency: "KRW", value: amount },
        orderId,
        orderName: "패키지 여행 예약",
        successUrl: `${window.location.origin}/bookings/${bookingId}/success`,
        failUrl: `${window.location.origin}/bookings/${bookingId}/failed`,
        customerName,
        customerEmail,
      });
    } catch (err) {
      // 사용자 취소(PAY_PROCESS_CANCELED) 또는 SDK 오류 — redirect 미발생 시만 도달
      const message =
        err instanceof Error ? err.message : "결제창 실행에 실패했습니다";
      setError(message);
      setIsPaying(false);
    }
  }

  return (
    <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-6">
      <div>
        <p className="text-sm text-gray-500">결제 금액</p>
        <p className="mt-1 text-2xl font-bold text-gray-900">
          {amount.toLocaleString("ko-KR")}원
        </p>
        <p className="mt-1 text-sm text-gray-600">{customerName} 고객님</p>
        <p className="mt-0.5 text-xs text-gray-400">주문번호: {orderId}</p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handlePayClick}
        disabled={isPaying}
        aria-label="토스페이먼츠 결제창 열기"
        className="w-full rounded-xl bg-indigo-600 py-3 font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-60"
      >
        {isPaying ? "결제창 열기 중..." : `${amount.toLocaleString("ko-KR")}원 결제하기`}
      </button>
    </div>
  );
}
