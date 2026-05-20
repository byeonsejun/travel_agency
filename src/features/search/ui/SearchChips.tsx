import { SEARCH_CHIPS } from "@/entities/product";

/**
 * 추천 검색 칩 — 홈/search 빈 상태 공통 진입 보조 (bottom-up 추출).
 * 순수 링크라 RSC. 클릭 시 /search?q= 로 골든패스 진입.
 */
export function SearchChips() {
  return (
    <div className="flex flex-wrap gap-3">
      {SEARCH_CHIPS.map((chip) => (
        <a
          key={chip}
          href={`/search?q=${encodeURIComponent(chip)}`}
          className="rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 transition-colors hover:bg-blue-100"
        >
          {chip}
        </a>
      ))}
    </div>
  );
}
