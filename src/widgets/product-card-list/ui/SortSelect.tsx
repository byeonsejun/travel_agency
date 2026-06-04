"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type SortSelectProps = {
  current: string;
};

export function SortSelect({ current }: SortSelectProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = new URLSearchParams(params.toString());
    next.set("sort", e.target.value);
    next.delete("page");
    // 네비게이션을 transition 으로 감싸 isPending 으로 펜딩 시각 처리.
    // useTransition 은 타이머/리스너 없음 → cleanup 불필요.
    startTransition(() => {
      router.push(`/products?${next.toString()}`);
    });
  };

  return (
    <div className="relative inline-flex items-center">
      <select
        value={current}
        onChange={handleSortChange}
        disabled={isPending}
        aria-busy={isPending}
        className={`rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:border-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
          isPending ? "opacity-50" : ""
        }`}
      >
        <option value="latest">최신순</option>
        <option value="price_asc">최저가</option>
        <option value="departure_soon">출발임박</option>
      </select>
      {isPending && (
        <span
          aria-hidden="true"
          className="absolute right-2 h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"
        />
      )}
    </div>
  );
}
