"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";

type SearchBoxProps = {
  defaultValue?: string;
  placeholder?: string;
};

/**
 * 무상태 검색 폼. 제출 시 /search?q= 로 라우팅.
 * useEffect/이벤트 리스너 없으므로 cleanup 불필요.
 */
export function SearchBox({ defaultValue = "", placeholder = "어떤 여행을 원하세요? (예: 부모님 모시고 온천 3박)" }: SearchBoxProps) {
  const router = useRouter();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const q = (form.elements.namedItem("q") as HTMLInputElement).value.trim();
    if (!q) return;
    router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full gap-2">
      <input
        name="q"
        type="search"
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="flex-1 rounded-lg border border-gray-300 px-4 py-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
        maxLength={200}
        autoComplete="off"
      />
      <button
        type="submit"
        className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
      >
        검색
      </button>
    </form>
  );
}
