"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { ClarifyingChip } from "../model/clarifyingChips";

/**
 * 좁히기 칩. 클릭 시 appendText를 쿼리에 덧붙여 /search?q= 로 재검색.
 * 대화 상태는 URL에만(stateless). useTransition isPending으로 펜딩 표시.
 * 이벤트 리스너·타이머 없음(cleanup 불요). entities/product 배럴 import 금지.
 */
export function ClarifyingChips({
  chips,
  query,
}: {
  chips: ClarifyingChip[];
  query: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (chips.length === 0) return null;

  function refine(appendText: string) {
    const next = `${query} ${appendText}`.trim();
    startTransition(() => {
      router.push(`/search?q=${encodeURIComponent(next)}`);
    });
  }

  return (
    <div className="mb-6">
      <p className="mb-2 text-sm text-muted-foreground">
        💡 더 정확히 찾아드릴게요
      </p>
      <div className="flex flex-wrap gap-2" aria-busy={isPending}>
        {chips.map((chip) => (
          <button
            key={chip.appendText}
            type="button"
            onClick={() => refine(chip.appendText)}
            disabled={isPending}
            className="rounded-full border border-border bg-card px-4 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-secondary disabled:opacity-60"
          >
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
}
