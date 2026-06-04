"use client";
import { useRef, useState, useTransition } from "react";
import { discretionaryRefundAction } from "@/features/admin-discretionary-refund/server/actions";

interface Props {
  bookingId: string;
  paymentId: string;
  refundable: number;
}

export function DiscretionaryRefundPanel({ bookingId, paymentId, refundable }: Props) {
  const requestId = useRef(crypto.randomUUID());
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const parsed = parseInt(amount, 10);
  const isValid = !isNaN(parsed) && parsed > 0 && parsed <= refundable;

  function handleSubmit() {
    if (!isValid) return;
    setError(null);
    startTransition(async () => {
      const result = await discretionaryRefundAction(null, {
        bookingId,
        paymentId,
        amount: parsed,
        requestId: requestId.current,
        reason: reason || undefined,
      });
      if (result.type === "error") {
        setError(result.message);
        // 새 requestId로 재시도 가능하도록 재생성
        requestId.current = crypto.randomUUID();
      } else {
        setAmount("");
        setReason("");
        requestId.current = crypto.randomUUID();
      }
    });
  }

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-700">
        재량 금액 환불
      </h2>
      <p className="text-xs text-amber-700">
        ⚠️ 재량 환불은 좌석·예약 인원을 변경하지 않습니다 (순수 금액 이동).
      </p>
      <p className="text-sm text-gray-700">
        잔여 환불가능액:{" "}
        <span className="font-semibold text-gray-900">
          {refundable.toLocaleString("ko-KR")}원
        </span>
      </p>

      <div className="space-y-2">
        <label className="text-xs text-gray-600">
          환불액 (원)
          <input
            type="number"
            value={amount}
            min={1}
            max={refundable}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
            placeholder={`최대 ${refundable.toLocaleString("ko-KR")}원`}
          />
        </label>

        <label className="text-xs text-gray-600">
          사유 (선택)
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
            placeholder="환불 사유 입력..."
          />
        </label>
      </div>

      {error && (
        <p className="text-sm text-red-600">오류: {error}</p>
      )}

      <button
        disabled={isPending || !isValid}
        onClick={handleSubmit}
        className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
      >
        {isPending
          ? "처리 중..."
          : `${isValid ? parsed.toLocaleString("ko-KR") : "—"}원 환불`}
      </button>
    </section>
  );
}
