"use client";

import { useActionState } from "react";
import type { ReviewStatus } from "@prisma/client";
import {
  setReviewStatusAction,
  type SetReviewStatusState,
} from "../server/actions";
import { Button } from "@/shared/ui/button";

type Props = {
  reviewId: string;
  status: ReviewStatus;
};

// 현재 status 기준으로 반대 동작 버튼 노출. PUBLISHED→숨김, HIDDEN/REPORTED→공개.
export function ReviewStatusToggle({ reviewId, status }: Props) {
  const [state, formAction, isPending] = useActionState<
    SetReviewStatusState | null,
    FormData
  >(async (_prev, formData) => {
    const next = formData.get("next") as "PUBLISHED" | "HIDDEN";
    return setReviewStatusAction(_prev, { reviewId, next });
  }, null);

  // 낙관적 표시는 생략 — 액션 성공 시 revalidatePath 로 서버가 최신 status 재렌더.
  const next = status === "PUBLISHED" ? "HIDDEN" : "PUBLISHED";
  const label = status === "PUBLISHED" ? "숨기기" : "공개로 전환";

  return (
    <form action={formAction} className="flex items-center gap-3">
      <input type="hidden" name="next" value={next} />
      {/* 숨기기(HIDDEN 전환) = destructive; 공개(PUBLISHED 전환) = secondary */}
      <Button
        type="submit"
        disabled={isPending}
        variant={status === "PUBLISHED" ? "destructive" : "secondary"}
        size="sm"
      >
        {isPending ? "처리 중…" : label}
      </Button>
      {state?.type === "error" && (
        <span className="text-sm text-destructive">{state.message}</span>
      )}
    </form>
  );
}
