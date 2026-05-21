"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import {
  MAX_COMPARE,
  addCompareId,
  removeCompareId,
  isInCompare,
  parseCompareIds,
  serializeCompareIds,
} from "../model/compareIds";

type Size = "sm" | "md";

type Props = {
  productId: string;
  size?: Size;
  className?: string;
};

const SIZE_CLASS: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3.5 py-1.5 text-sm",
};

export function CompareToggleButton({ productId, size = "sm", className = "" }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const current = parseCompareIds(searchParams.get("compareIds") ?? undefined);
  const active = isInCompare(current, productId);
  const isFull = !active && current.length >= MAX_COMPARE;

  const handleClick = () => {
    const next = active
      ? removeCompareId(current, productId)
      : addCompareId(current, productId);

    // 변화 없으면 navigation skip (가득 차서 거부된 경우)
    if (serializeCompareIds(next) === serializeCompareIds(current)) return;

    // 기존 쿼리 보존 + compareIds 만 갱신/삭제
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
      disabled={isPending || isFull}
      aria-pressed={active}
      title={isFull ? `최대 ${MAX_COMPARE}개까지 비교할 수 있어요` : undefined}
      className={[
        "inline-flex items-center gap-1 rounded-full font-medium transition",
        SIZE_CLASS[size],
        active
          ? "bg-indigo-600 text-white hover:bg-indigo-700"
          : "bg-gray-100 text-gray-700 hover:bg-gray-200",
        (isFull || isPending) && "opacity-60 cursor-not-allowed",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {active ? "✓ 비교함" : "+ 비교"}
    </button>
  );
}
