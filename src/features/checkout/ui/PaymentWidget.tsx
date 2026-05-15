"use client";

// Task 7에서 토스페이먼츠 SDK 연동으로 교체될 스텁
// 현재는 결제 준비 상태를 시각적으로 표시

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
}: Props) {
  return (
    <div className="rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50 p-8 text-center">
      <p className="text-sm font-medium text-indigo-600">결제창 연동 준비 완료</p>
      <p className="mt-1 text-xs text-gray-500">
        예약번호: {bookingId} · 주문번호: {orderId}
      </p>
      <p className="mt-3 text-xl font-bold text-gray-900">
        {amount.toLocaleString("ko-KR")}원
      </p>
      <p className="mt-1 text-sm text-gray-600">{customerName} 고객님</p>
      <p className="mt-4 text-xs text-gray-400">
        Task 7 — 토스페이먼츠 SDK 결제창이 여기에 마운트됩니다.
      </p>
    </div>
  );
}
