"use client";

import { startTransition, useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { CANCEL_REASON_PRESETS } from "@/entities/booking";
import { cancelBookingAction } from "../server/actions";

type Props = {
  bookingId: string;
};

const FREE_TEXT_VALUE = "__free__";

export function CancelBookingButton({ bookingId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string>(
    CANCEL_REASON_PRESETS[0]
  );
  const [freeText, setFreeText] = useState("");
  const [state, dispatch, isPending] = useActionState(
    cancelBookingAction,
    null
  );

  // 자유 입력 모드면 freeText, 아니면 선택된 프리셋이 사유.
  const effectiveReason =
    selectedPreset === FREE_TEXT_VALUE ? freeText.trim() : selectedPreset;
  const submitDisabled = isPending || effectiveReason.length === 0;

  function handleOpen() {
    setOpen(true);
  }

  function handleClose() {
    if (isPending) return; // 진행 중에는 닫기 차단
    setOpen(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitDisabled) return;
    startTransition(() => {
      dispatch({ bookingId, reason: effectiveReason });
    });
  }

  // 성공/지연 시: 다이얼로그 닫고 RSC 재검증 결과를 가져오기 위해 router.refresh
  // (revalidatePath는 캐시 무효화만, 현재 페이지 트리는 router.refresh로 다시 그림).
  // - success: booking 전이 + Payment CANCELED 모두 완료 → UI 즉시 동기
  // - deferred: PG cancel 지연 → RefundJob PENDING 상태로 적재, booking은
  //   아직 PAID. 사용자에겐 토스트성 안내, 페이지 재검증으로 RefundJob 상태 반영.
  if ((state?.type === "success" || state?.type === "deferred") && open) {
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
      >
        예약 취소
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* backdrop */}
          <button
            type="button"
            aria-label="닫기"
            onClick={handleClose}
            disabled={isPending}
            className="absolute inset-0 bg-black/40 backdrop-blur-[1px] disabled:cursor-not-allowed"
          />

          {/* panel */}
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2
              id="cancel-dialog-title"
              className="text-lg font-bold text-gray-900"
            >
              예약을 취소하시겠습니까?
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              취소 후에는 좌석이 환원되며 동일 예약을 되돌릴 수 없습니다.
            </p>

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div>
                <label
                  htmlFor="cancel-reason"
                  className="block text-sm font-medium text-gray-700"
                >
                  취소 사유
                </label>
                <select
                  id="cancel-reason"
                  value={selectedPreset}
                  onChange={(e) => setSelectedPreset(e.target.value)}
                  disabled={isPending}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {CANCEL_REASON_PRESETS.map((preset) => (
                    <option key={preset} value={preset}>
                      {preset}
                    </option>
                  ))}
                  <option value={FREE_TEXT_VALUE}>직접 입력</option>
                </select>
              </div>

              {selectedPreset === FREE_TEXT_VALUE && (
                <div>
                  <label
                    htmlFor="cancel-reason-free"
                    className="block text-sm font-medium text-gray-700"
                  >
                    상세 사유 (최대 200자)
                  </label>
                  <textarea
                    id="cancel-reason-free"
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value)}
                    disabled={isPending}
                    maxLength={200}
                    rows={3}
                    placeholder="취소 사유를 입력해 주세요"
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <p className="mt-1 text-right text-xs text-gray-400">
                    {freeText.length}/200
                  </p>
                </div>
              )}

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
                  {isPending ? "취소 처리 중..." : "예약 취소 확정"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
