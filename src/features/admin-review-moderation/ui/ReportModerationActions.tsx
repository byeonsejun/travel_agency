"use client";

import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";

import {
  resolveReportsAction,
  dismissReportsAction,
  type ReportModerationState,
} from "../server/actions";

type Props = { reviewId: string };

// 신고 처리 버튼 2종. 숨기기(인정)=빨강, 반려=회색.
// 프로그래밍 방식 Server Action 호출은 자동 refresh 가 없으므로(ADR-0019),
// 성공 시 router.refresh() 로 force-dynamic admin 페이지 RSC 를 재요청해 패널을 갱신.
export function ReportModerationActions({ reviewId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<ReportModerationState | null>(null);

  function run(action: (id: string) => Promise<ReportModerationState>) {
    startTransition(async () => {
      const result = await action(reviewId);
      setState(result);
      if (result.type === "success") router.refresh();
    });
  }

  const done = state?.type === "success";

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={isPending || done}
        aria-busy={isPending}
        onClick={() => run(resolveReportsAction)}
        className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        {isPending ? "처리 중…" : "숨기기 (신고 인정)"}
      </button>
      <button
        type="button"
        disabled={isPending || done}
        aria-busy={isPending}
        onClick={() => run(dismissReportsAction)}
        className="rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
      >
        {isPending ? "처리 중…" : "신고 반려"}
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
