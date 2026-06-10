"use client";

import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";

import {
  resolveReportsAction,
  dismissReportsAction,
  type ReportModerationState,
} from "../server/actions";
import { Button } from "@/shared/ui/button";

type Props = { reviewId: string };

// 신고 처리 버튼 2종. 숨기기(인정)=destructive, 반려=outline.
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
      {/* 숨기기(신고 인정) = destructive ACTION */}
      <Button
        type="button"
        disabled={isPending || done}
        aria-busy={isPending}
        onClick={() => run(resolveReportsAction)}
        variant="destructive"
        size="sm"
      >
        {isPending ? "처리 중…" : "숨기기 (신고 인정)"}
      </Button>
      {/* 신고 반려 = outline */}
      <Button
        type="button"
        disabled={isPending || done}
        aria-busy={isPending}
        onClick={() => run(dismissReportsAction)}
        variant="outline"
        size="sm"
      >
        {isPending ? "처리 중…" : "신고 반려"}
      </Button>
      {state?.type === "success" && (
        <span className="text-sm text-green-600">처리 완료</span>
      )}
      {state?.type === "error" && (
        <span className="text-sm text-destructive">{state.message}</span>
      )}
    </div>
  );
}
