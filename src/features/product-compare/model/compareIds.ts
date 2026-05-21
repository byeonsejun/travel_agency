// 상품 비교 모드 URL state 의 순수 함수 집합.
// 상태의 유일한 진실 원천은 URL `?compareIds=a,b,c` 쿼리. 모든 변환은 여기를 거친다.

export const MAX_COMPARE = 3;

type RawCompareIds = string | string[] | undefined | null;

/**
 * Next.js searchParams (string | string[] | undefined) 또는 URLSearchParams 값
 * 을 정규화한 id 배열로 변환. MAX_COMPARE 로 clamp, 중복 제거, 빈 토큰 무시.
 */
export function parseCompareIds(raw: RawCompareIds): string[] {
  if (raw == null) return [];

  const tokens: string[] = Array.isArray(raw)
    ? raw.flatMap((s) => s.split(","))
    : raw.split(",");

  const result: string[] = [];
  for (const t of tokens) {
    const id = t.trim();
    if (id.length === 0) continue;
    if (result.includes(id)) continue;
    result.push(id);
    if (result.length >= MAX_COMPARE) break;
  }
  return result;
}

export function serializeCompareIds(ids: string[]): string {
  return ids.join(",");
}

export function addCompareId(arr: string[], id: string): string[] {
  if (arr.includes(id)) return arr;
  if (arr.length >= MAX_COMPARE) return arr;
  return [...arr, id];
}

export function removeCompareId(arr: string[], id: string): string[] {
  return arr.filter((x) => x !== id);
}

export function isInCompare(arr: string[], id: string): boolean {
  return arr.includes(id);
}
