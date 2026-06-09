export type ThemeTile = { label: string; sub: string; query: string; className: string };

export function buildThemeHref(query: string): string {
  return `/search?q=${encodeURIComponent(query)}`;
}

export const THEME_TILES: ThemeTile[] = [
  { sub: "가족과 함께", label: "키즈 동반 추천", query: "가족여행", className: "from-primary to-[#0a4fd6]" },
  { sub: "단둘이", label: "허니문 특집", query: "허니문", className: "from-[#ff7e5f] to-[#ff5470]" },
  { sub: "혼자라서 좋아", label: "나홀로 여행", query: "나홀로 여행", className: "from-[#0fb9b1] to-[#0a8f88]" },
  { sub: "짧고 굵게", label: "주말 근거리", query: "주말 근거리", className: "from-[#8a5cf6] to-[#6d28d9]" },
];
