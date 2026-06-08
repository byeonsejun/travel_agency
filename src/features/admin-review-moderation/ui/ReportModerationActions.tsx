"use client";

import { useTransition, useState } from "react";

import {
  resolveReportsAction,
  dismissReportsAction,
  type ReportModerationState,
} from "../server/actions";

type Props = { reviewId: string };

// 신고 처리 버튼 2종. 숨기기(인정) = 빨강, 반려 = 회색.
export function ReportModerationActions({ reviewId }: Props) {
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<ReportModerationState | null>(null);

  function run(action: (id: string) => Promise<ReportModerationState>) {
    startTransition(async () => {
      setState(await action(reviewId));
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={isPending}
        onClick={() => run(resolveReportsAction)}
        className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        숨기기 (신고 인정)
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => run(dismissReportsAction)}
        className="rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
      >
        신고 반려
      </button>
      {state?.type === "success" && (
        <span className="text-sm text-green-600">처리 완료</span>
      )}
      {state?.type === "error" && (
        <span className="text-sm text-red-600">{state.message}</span>
      )}
    </div>
  );
}
