"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";

import {
  REPORT_REASONS,
  REPORT_REASON_LABELS,
} from "../model/reportSchema";
import { reportReviewAction, type ReportResult } from "../server/reportReview";

type Props = {
  reviewId: string;
  isAuthenticated: boolean;
};

const ERROR_MESSAGES: Record<
  Extract<ReportResult, { ok: false }>["error"],
  string
> = {
  UNAUTHENTICATED: "로그인이 필요합니다",
  SELF: "본인 리뷰는 신고할 수 없습니다",
  NOT_FOUND: "리뷰를 찾을 수 없습니다",
  INVALID: "입력값을 확인해 주세요",
  RATE_LIMITED: "잠시 후 다시 시도해 주세요",
};

export function ReportReviewButton({ reviewId, isAuthenticated }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] =
    useState<(typeof REPORT_REASONS)[number]>("SPAM");
  const [note, setNote] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 토스트 auto-dismiss 타이머 cleanup (메모리 누수 방지).
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // B2 Escape to close — open 상태에서만 등록.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPending) close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isPending]);

  // B6 닫기 헬퍼 — state 일괄 초기화.
  function close() {
    setOpen(false);
    setNote("");
    setReason("SPAM");
  }

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  function submit() {
    startTransition(async () => {
      const res = await reportReviewAction({
        reviewId,
        reason,
        note: note.trim() || undefined,
      });
      if (res.ok) {
        showToast(
          res.status === "duplicate" ? "이미 신고한 리뷰입니다" : "신고가 접수되었습니다",
        );
        setOpen(false);
        setNote("");
      } else {
        showToast(ERROR_MESSAGES[res.error]);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-gray-400 hover:text-gray-600"
      >
        신고
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !isPending && close()}
        >
          {/* B1 role/aria on the panel */}
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-dialog-title"
            tabIndex={-1}
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {/* B1 id on heading */}
            <h3 id="report-dialog-title" className="text-base font-semibold text-gray-900">리뷰 신고</h3>

            {!isAuthenticated ? (
              <div className="mt-4 text-sm text-gray-600">
                신고하려면 로그인이 필요합니다.
                <Link
                  href="/login"
                  className="ml-1 font-medium text-red-600 hover:underline"
                >
                  로그인하기
                </Link>
              </div>
            ) : (
              <>
                <fieldset className="mt-4 space-y-2">
                  {/* B4 sr-only legend */}
                  <legend className="sr-only">신고 사유</legend>
                  {REPORT_REASONS.map((r) => (
                    <label key={r} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="reason"
                        value={r}
                        checked={reason === r}
                        onChange={() => setReason(r)}
                      />
                      {REPORT_REASON_LABELS[r]}
                    </label>
                  ))}
                </fieldset>
                {/* B5 aria-label on textarea */}
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  placeholder="상세 사유(선택)"
                  aria-label="상세 사유"
                  className="mt-3 w-full rounded-md border border-gray-300 p-2 text-sm"
                  rows={3}
                />
                <div className="mt-4 flex justify-end gap-2">
                  {/* B6 cancel uses close() helper */}
                  <button
                    type="button"
                    onClick={() => !isPending && close()}
                    className="rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={isPending}
                    className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {isPending ? "처리 중…" : "신고하기"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* B3 toast aria-live */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-gray-900 px-4 py-2 text-sm text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </>
  );
}
