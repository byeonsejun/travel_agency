"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ConfirmState = "pending" | "success" | "failed";

type Props = {
  bookingId: string;
  paymentKey: string;
  orderId: string;
  amount: number; // 원 단위 정수
};

export function ConfirmPayment({ bookingId, paymentKey, orderId, amount }: Props) {
  const router = useRouter();
  const calledRef = useRef(false); // single-flight: D4 — 멱등 백엔드지만 클라에서도 이중 호출 차단
  const [state, setState] = useState<ConfirmState>("pending");

  useEffect(() => {
    // calledRef 가드: React StrictMode 이중 실행 + 의존성 변경 시 재호출 방어
    if (calledRef.current) return;
    calledRef.current = true;

    const ac = new AbortController();
    let cancelled = false;

    async function runConfirm() {
      try {
        const res = await fetch("/api/payments/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentKey, orderId, amount }),
          signal: ac.signal,
        });

        if (cancelled) return; // unmount 후 setState 금지 (Frontend R2-5)

        const data: { status?: string; failureMessage?: string; error?: string } =
          await res.json().catch(() => ({}));

        if (cancelled) return;

        if (res.ok && data.status === "PAID") {
          setState("success");
          router.replace(`/bookings/${bookingId}`);
        } else {
          const reason =
            data.failureMessage ?? data.error ?? `HTTP ${res.status}`;
          setState("failed");
          router.replace(
            `/bookings/${bookingId}/failed?reason=${encodeURIComponent(reason)}`
          );
        }
      } catch (err) {
        // AbortError: unmount 시 정상 정리 — 사용자 이탈로 간주, 추가 처리 불필요
        if (cancelled || (err instanceof Error && err.name === "AbortError")) return;
        setState("failed");
        router.replace(
          `/bookings/${bookingId}/failed?reason=${encodeURIComponent("결제 승인 오류")}`
        );
      }
    }

    runConfirm();

    return () => {
      cancelled = true; // unmount 후 setState 방지 (Frontend R2-5)
      ac.abort();       // 진행 중 fetch 정리 (Frontend R2-2)
    };
  }, [bookingId, paymentKey, orderId, amount, router]); // exhaustive deps, calledRef가 재실행 방지

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      {state === "pending" && (
        <>
          <div
            className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600"
            role="status"
            aria-label="결제 확인 중"
          />
          <p className="text-sm text-gray-600">결제를 확인하는 중입니다...</p>
        </>
      )}
      {state === "success" && (
        <p className="text-sm text-gray-600">결제가 완료되었습니다. 예약 상세 페이지로 이동 중...</p>
      )}
      {state === "failed" && (
        <p className="text-sm text-red-600">결제에 실패했습니다. 실패 페이지로 이동 중...</p>
      )}
    </div>
  );
}
