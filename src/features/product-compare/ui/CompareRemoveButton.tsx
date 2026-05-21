"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import {
  parseCompareIds,
  removeCompareId,
  serializeCompareIds,
} from "../model/compareIds";

type Props = {
  productId: string;
  className?: string;
  /** 접근성용. 기본 "비교에서 빼기" */
  label?: string;
};

export function CompareRemoveButton({
  productId,
  className = "",
  label = "비교에서 빼기",
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    const current = parseCompareIds(searchParams.get("compareIds") ?? undefined);
    const next = removeCompareId(current, productId);

    const params = new URLSearchParams(searchParams.toString());
    if (next.length === 0) params.delete("compareIds");
    else params.set("compareIds", serializeCompareIds(next));

    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-label={label}
      className={[
        "inline-flex h-6 w-6 items-center justify-center rounded-full",
        "bg-gray-100 text-gray-500 hover:bg-rose-100 hover:text-rose-600",
        "transition disabled:opacity-50",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-3.5 w-3.5"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  );
}
