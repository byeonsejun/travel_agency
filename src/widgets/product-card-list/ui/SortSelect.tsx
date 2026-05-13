"use client";

import { useRouter, useSearchParams } from "next/navigation";

type SortSelectProps = {
  current: string;
};

export function SortSelect({ current }: SortSelectProps) {
  const router = useRouter();
  const params = useSearchParams();

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = new URLSearchParams(params.toString());
    next.set("sort", e.target.value);
    next.delete("page");
    router.push(`/products?${next.toString()}`);
  };

  return (
    <select
      value={current}
      onChange={handleSortChange}
      className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:border-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
    >
      <option value="latest">최신순</option>
      <option value="price_asc">최저가</option>
      <option value="departure_soon">출발임박</option>
    </select>
  );
}
