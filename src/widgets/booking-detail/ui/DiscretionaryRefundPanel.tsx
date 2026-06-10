"use client";
import { useRef, useState, useTransition } from "react";
import { discretionaryRefundAction } from "@/features/admin-discretionary-refund/server/actions";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";

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
      <p className="text-sm text-foreground">
        잔여 환불가능액:{" "}
        <span className="font-semibold text-foreground">
          {refundable.toLocaleString("ko-KR")}원
        </span>
      </p>

      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">
          환불액 (원)
          <Input
            type="number"
            value={amount}
            min={1}
            max={refundable}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1"
            placeholder={`최대 ${refundable.toLocaleString("ko-KR")}원`}
          />
        </label>

        <label className="text-xs text-muted-foreground">
          사유 (선택)
          <Input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1"
            placeholder="환불 사유 입력..."
          />
        </label>
      </div>

      {error && (
        <p className="text-sm text-destructive">오류: {error}</p>
      )}

      <Button
        variant="destructive"
        disabled={isPending || !isValid}
        onClick={handleSubmit}
      >
        {isPending
          ? "처리 중..."
          : `${isValid ? parsed.toLocaleString("ko-KR") : "—"}원 환불`}
      </Button>
    </section>
  );
}
