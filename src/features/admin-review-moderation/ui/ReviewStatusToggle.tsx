"use client";

import { useActionState } from "react";
import type { ReviewStatus } from "@prisma/client";
import {
  setReviewStatusAction,
  type SetReviewStatusState,
} from "../server/actions";

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
      <button
        type="submit"
        disabled={isPending}
        className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
          status === "PUBLISHED"
            ? "bg-gray-700 hover:bg-gray-800"
            : "bg-green-600 hover:bg-green-700"
        }`}
      >
        {isPending ? "처리 중…" : label}
      </button>
      {state?.type === "error" && (
        <span className="text-sm text-red-600">{state.message}</span>
      )}
    </form>
  );
}
