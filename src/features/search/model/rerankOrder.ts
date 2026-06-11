/**
 * rerankOrder.ts — 재정렬 순열 가드 (순수, 설계 §4.1).
 *
 * LLM이 반환한 key 순서로 items를 재배열한다:
 *  - 환각 key(입력에 없음) → 폐기
 *  - 누락 key(LLM이 빠뜨림) → 원래 순서로 뒤에 append
 *  - 중복 key → 첫 등장만
 * 결과 길이는 항상 입력과 동일(정보 손실 0). 운영 rerank·eval 양쪽 재사용.
 */
export function applyRerankOrder<T>(
  items: T[],
  keyOf: (item: T) => string,
  orderedKeys: string[],
): T[] {
  const byKey = new Map(items.map((it) => [keyOf(it), it]));
  const seen = new Set<string>();
  const ordered: T[] = [];
  for (const key of orderedKeys) {
    const it = byKey.get(key);
    if (it !== undefined && !seen.has(key)) {
      ordered.push(it);
      seen.add(key);
    }
  }
  for (const it of items) {
    if (!seen.has(keyOf(it))) ordered.push(it);
  }
  return ordered;
}
