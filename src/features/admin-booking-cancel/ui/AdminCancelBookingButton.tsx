"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { adminCancelBookingAction } from "../server/actions";

type Props = {
  bookingId: string;
};

export function AdminCancelBookingButton({ bookingId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [waivePenalty, setWaivePenalty] = useState(false);
  const [state, dispatch, isPending] = useActionState(
    adminCancelBookingAction,
    null
  );

  const trimmed = reason.trim();
  const submitDisabled = isPending || trimmed.length < 5;

  function handleClose() {
    if (isPending) return;
    setOpen(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitDisabled) return;
    startTransition(() => {
      dispatch({ bookingId, reason: trimmed, waivePenalty });
    });
  }

  // 성공/지연 → 다이얼로그 닫고 router.refresh로 RSC 재렌더 강제 (commit 단계)
  useEffect(() => {
    if ((state?.type === "success" || state?.type === "deferred") && open) {
      setOpen(false);
      router.refresh();
    }
  }, [state, open, router]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50"
      >
        관리자 직권 취소
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-cancel-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <button
            type="button"
            aria-label="닫기"
            onClick={handleClose}
            disabled={isPending}
            className="absolute inset-0 bg-black/40 backdrop-blur-[1px] disabled:cursor-not-allowed"
          />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2
              id="admin-cancel-dialog-title"
              className="text-lg font-bold text-gray-900"
            >
              관리자 직권 취소
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              취소 시 좌석이 환원되며, PAID 상태였다면 환불 큐(RefundJob)가
              자동으로 PG 취소를 진행합니다.
            </p>

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div>
                <label
                  htmlFor="admin-cancel-reason"
                  className="block text-sm font-medium text-gray-700"
                >
                  취소 사유 (최소 5자, 최대 200자) — 운영 로그에 기록됩니다
                </label>
                <textarea
                  id="admin-cancel-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={isPending}
                  maxLength={200}
                  rows={4}
                  placeholder="예: 천재지변으로 인한 출발 불가, 약관 위반 행위 발견 등 — 명확한 사유를 기재"
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
                <p className="mt-1 text-right text-xs text-gray-400">
                  {reason.length}/200
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={waivePenalty}
                  onChange={(e) => setWaivePenalty(e.target.checked)}
                  disabled={isPending}
                  className="h-4 w-4 rounded border-gray-300"
                />
                위약금 면제 (여행사 귀책 취소)
              </label>

              {state?.type === "error" && (
                <p
                  role="alert"
                  className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {state.message}
                </p>
              )}
              {state?.type === "deferred" && (
                <p
                  role="status"
                  className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800"
                >
                  {state.message}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isPending}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  닫기
                </button>
                <button
                  type="submit"
                  disabled={submitDisabled}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
                >
                  {isPending ? "취소 처리 중..." : "직권 취소 확정"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
