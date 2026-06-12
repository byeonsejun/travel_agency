"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { CANCEL_REASON_PRESETS } from "@/entities/booking/client";
import type { PenaltyResult } from "@/entities/penalty-policy";
import { cancelBookingAction } from "../server/actions";

type Props = {
  bookingId: string;
  refundPreview?: PenaltyResult | null;
};

const FREE_TEXT_VALUE = "__free__";

export function CancelBookingButton({ bookingId, refundPreview }: Props) {
  const router = useRouter();
  // rawOpen: 사용자가 연 의도. settled: 액션 성공/지연. open: 둘의 파생.
  const [rawOpen, setRawOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string>(
    CANCEL_REASON_PRESETS[0]
  );
  const [freeText, setFreeText] = useState("");
  const [state, dispatch, isPending] = useActionState(
    cancelBookingAction,
    null
  );

  // success: booking 전이 + Payment CANCELED 완료 / deferred: PG cancel 지연
  // (RefundJob PENDING 적재). 둘 다 다이얼로그를 닫아야 하므로 settled 로 묶는다.
  const settled = state?.type === "success" || state?.type === "deferred";
  const open = rawOpen && !settled;

  // 자유 입력 모드면 freeText, 아니면 선택된 프리셋이 사유.
  const effectiveReason =
    selectedPreset === FREE_TEXT_VALUE ? freeText.trim() : selectedPreset;
  const submitDisabled = isPending || effectiveReason.length === 0;

  function handleOpen() {
    setRawOpen(true);
  }

  function handleClose() {
    if (isPending) return; // 진행 중에는 닫기 차단
    setRawOpen(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitDisabled) return;
    startTransition(() => {
      dispatch({ bookingId, reason: effectiveReason });
    });
  }

  // 성공/지연 시 RSC 재검증만 effect 로(부수효과, setState 아님 → 규칙 무관).
  // 렌더 단계에서 router.refresh 를 부르면 Router 의 setState 가 다른 컴포넌트
  // 렌더 중 실행되어 React 가 거부하므로 commit 이후로 미룬다.
  // 다이얼로그 닫힘은 open 파생으로 자동 처리.
  useEffect(() => {
    if (settled && rawOpen) router.refresh();
  }, [settled, rawOpen, router]);

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

            {refundPreview && (
              <div className="mt-3 rounded-lg bg-slate-50 px-4 py-3 text-sm">
                {refundPreview.penaltyAmount > 0 ? (
                  <>
                    <p className="text-gray-700">
                      환불 예정{" "}
                      <strong className="text-gray-900">
                        {refundPreview.refundAmount.toLocaleString("ko-KR")}원
                      </strong>
                    </p>
                    <p className="mt-1 text-amber-700">
                      위약금 {refundPreview.penaltyAmount.toLocaleString("ko-KR")}원 공제
                      (출발 D-{Math.max(refundPreview.daysBefore, 0)},{" "}
                      {Math.round(refundPreview.rate * 100)}%)
                    </p>
                  </>
                ) : (
                  <p className="font-medium text-emerald-700">
                    전액 환불 ({refundPreview.refundAmount.toLocaleString("ko-KR")}원)
                  </p>
                )}
              </div>
            )}

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
              {/* deferred 는 settled 라 다이얼로그가 즉시 닫힘(open 파생) →
                  여기서 표시 불가. 지연 안내는 닫힘 + router.refresh 후 RSC 상세에서 반영. */}

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
