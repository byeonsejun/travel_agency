/**
 * ttlCache.ts — 도메인 무지 in-memory TTL + 용량 제한 캐시 (M-AI-SEARCH).
 *
 * 설계 원칙:
 *  - 관측성 metrics.ts와 동일한 모듈 내 Map 싱글톤 패턴을 팩토리로 일반화.
 *  - 만료는 lazy expiry — get 시점에 TTL 초과면 즉시 제거(타이머 미사용 →
 *    cleanup 누수 없음, 서버리스/엣지 안전).
 *  - 용량 초과 시 insertion order의 가장 오래된 항목부터 축출. Map은 삽입
 *    순서를 보존하므로 별도 LRU 자료구조 불필요. set 시 기존 키는 delete
 *    후 재삽입하여 "최신"으로 끌어올린다(재설정 = recency 갱신).
 *  - `now` 주입으로 TTL 동작을 결정론적으로 테스트(외부 타이머/대기 0).
 *
 * 용도: M-AI-SEARCH에서 동일 `q` 쿼리의 routeQuery/embed 결과 1h 캐시
 *       (LLM·임베딩 비용 폭주 방어 — spec D6 / 로드맵 R5).
 */

export interface TtlCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  clear(): void;
  readonly size: number;
}

interface TtlCacheOptions {
  /** 항목 생존 시간(ms). 이 시간을 초과하면 get에서 miss 처리. */
  ttlMs: number;
  /** 최대 항목 수. 초과 시 가장 오래된 항목부터 축출. */
  maxEntries: number;
  /** 현재 시각(ms) 공급자. 기본 Date.now — 테스트에서 주입해 결정론 확보. */
  now?: () => number;
}

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export function createTtlCache<T>(options: TtlCacheOptions): TtlCache<T> {
  const { ttlMs, maxEntries } = options;
  const now = options.now ?? Date.now;
  const store = new Map<string, Entry<T>>();

  function get(key: string): T | undefined {
    const entry = store.get(key);
    if (entry === undefined) return undefined;
    if (now() >= entry.expiresAt) {
      store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  function set(key: string, value: T): void {
    // 기존 키는 제거 후 재삽입 → Map 삽입 순서상 "최신"으로 이동.
    if (store.has(key)) store.delete(key);
    // 새 키 추가로 용량 초과 시, 가장 오래된 항목(첫 키) 축출.
    if (store.size >= maxEntries) {
      const oldest = store.keys().next().value;
      if (oldest !== undefined) store.delete(oldest);
    }
    store.set(key, { value, expiresAt: now() + ttlMs });
  }

  function clear(): void {
    store.clear();
  }

  return {
    get,
    set,
    clear,
    get size() {
      return store.size;
    },
  };
}
