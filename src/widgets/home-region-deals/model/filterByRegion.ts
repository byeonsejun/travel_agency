export const ALL_TAB = "전체";

/**
 * destination 문자열에서 국가(region)를 추출한다.
 * 데이터 포맷은 "도시, 국가" (국가가 suffix). 예: "오사카, 일본" → "일본".
 * 콤마가 없으면 전체 문자열이 국가. 예: "스위스" → "스위스".
 */
export function regionOf(destination: string): string {
  const parts = destination.split(",");
  return parts[parts.length - 1].trim();
}

/** 선택한 국가에 속하는 항목만 반환 (도시 무관). "전체" 는 모두 반환. */
export function filterByRegion<T extends { destination: string }>(items: T[], region: string): T[] {
  if (region === ALL_TAB) return items;
  return items.filter((i) => regionOf(i.destination) === region);
}

/** items 의 distinct 국가로 탭을 구성한다("전체" 선두). 빈 탭이 생기지 않도록 표시 데이터에서 도출. */
export function buildRegionTabs(items: { destination: string }[]): string[] {
  const regions = Array.from(new Set(items.map((i) => regionOf(i.destination))));
  return [ALL_TAB, ...regions];
}
