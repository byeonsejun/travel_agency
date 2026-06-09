export const ALL_TAB = "전체";

/** destination 문자열이 라벨로 시작하면 매칭 ("일본" → "일본 · 도쿄"). */
export function filterByDestination<T extends { destination: string }>(items: T[], label: string): T[] {
  if (label === ALL_TAB) return items;
  return items.filter((i) => i.destination.startsWith(label));
}

export function buildRegionTabs(dests: { label: string }[]): string[] {
  const labels = Array.from(new Set(dests.map((d) => d.label)));
  return [ALL_TAB, ...labels];
}
