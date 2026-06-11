/**
 * clarifyingChips.ts — 라우터가 추출한 빈 차원(price/duration/theme)에서
 * "좁히기" 칩을 파생하는 순수 함수 (설계 §3, D9). dev/prod 무관 결정론.
 *
 * 칩 클릭 = appendText를 쿼리에 덧붙여 재검색 → ?q= 누적(대화 상태=URL).
 */
import type { RoutedQuery } from "./schemas";

export interface ClarifyingChip {
  label: string;       // 표시 텍스트
  appendText: string;  // 쿼리에 덧붙일 토큰(라우터가 재파싱)
}

const PRICE_CHIP: ClarifyingChip = { label: "100만원 이하", appendText: "100만원" };
const DURATION_CHIPS: ClarifyingChip[] = [
  { label: "3박4일", appendText: "3박4일" },
  { label: "4박5일", appendText: "4박5일" },
];
// 인기 세부테마 풀(라우터 THEME_KEYWORDS의 정규 태그와 동일 표기).
const THEME_CHIPS: ClarifyingChip[] = [
  { label: "온천", appendText: "온천" },
  { label: "가족", appendText: "가족" },
  { label: "미식", appendText: "미식" },
  { label: "휴양", appendText: "휴양" },
  { label: "가성비", appendText: "가성비" },
];
const MAX_CHIPS = 4;

export function buildClarifyingChips(
  routed: RoutedQuery,
  query: string,
): ClarifyingChip[] {
  const fullySpecified =
    routed.priceMax !== undefined &&
    routed.durationNights !== undefined &&
    (routed.themeTags?.length ?? 0) > 0;
  if (fullySpecified) return [];

  const candidates: ClarifyingChip[] = [];
  if (routed.priceMax === undefined) candidates.push(PRICE_CHIP);
  if (routed.durationNights === undefined) candidates.push(...DURATION_CHIPS);
  const present = new Set(routed.themeTags ?? []);
  for (const chip of THEME_CHIPS) {
    if (!present.has(chip.appendText)) candidates.push(chip);
  }

  // 쿼리에 이미 있는 토큰 제외 + 중복 제거 + 상한.
  const seen = new Set<string>();
  const result: ClarifyingChip[] = [];
  for (const chip of candidates) {
    if (query.includes(chip.appendText) || seen.has(chip.appendText)) continue;
    seen.add(chip.appendText);
    result.push(chip);
    if (result.length >= MAX_CHIPS) break;
  }
  return result;
}
