/**
 * searchWeights.ts — 하이브리드 검색 가중치 SSOT + 테마 부스트 공식.
 *
 * 가중치(합 1.0)와 themeBoost 공식의 단일 출처. searchByVector.ts의 SQL,
 * eval 하네스(scoreReplica)가 모두 여기를 import한다 → 3중 surface drift 차단.
 *
 * ⚠️ buildThemeScore(searchByVector.ts)의 SQL 산술이 themeBoost를 미러한다.
 *    한쪽을 바꾸면 반드시 다른 쪽도 갱신할 것.
 */

export interface SearchWeights {
  vector: number;
  keyword: number;
  geo: number;
  theme: number;
}

/** 운영 기본 가중치(합 1.0). 변경은 ADR 검토 후. */
export const SEARCH_WEIGHTS: SearchWeights = {
  vector: 0.5,
  keyword: 0.2,
  geo: 0.2,
  theme: 0.1,
};

/**
 * 테마 부스트 (graduated soft boost). 요청 태그 커버리지 비율 × 천장.
 *   requested ≤ 0 ? 0 : ceiling × (matchCount / requested)
 *
 * ceiling 기본값은 운영 가중치(SEARCH_WEIGHTS.theme). eval sweep은 가변
 * 천장을 주입한다. matchCount ∈ [0, requested] 보장(ProductTag @@unique)이라
 * 반환값은 [0, ceiling] — cap 불필요.
 */
export function themeBoost(
  matchCount: number,
  requested: number,
  ceiling: number = SEARCH_WEIGHTS.theme,
): number {
  // !(requested > 0)는 0·음수·NaN을 모두 차단.
  if (!(requested > 0)) return 0;
  return ceiling * (matchCount / requested);
}
