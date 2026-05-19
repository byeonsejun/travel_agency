/**
 * ttlCache.test.ts — in-memory TTL 캐시 순수 유틸 단위 테스트 (M-AI-SEARCH Task 1)
 *
 * 검증 축:
 *  1. set/get — 저장한 값을 동일 키로 회수, 미존재 키는 undefined
 *  2. TTL 만료 — ttlMs 경과 후 get은 miss, 만료 항목은 size에서도 제거
 *  3. 용량 초과 eviction — maxEntries 초과 시 가장 오래된 항목 제거(insertion order)
 *  4. 재설정 recency — 기존 키 재설정은 최신으로 갱신되어 축출 대상에서 제외
 *  5. clear — 전체 초기화
 *
 * 시계는 주입형 `now`로 결정론적 검증 (외부 타이머/대기 0 — feedback_dev_external_io 정신).
 */

import { describe, it, expect } from "vitest";
import { createTtlCache } from "../ttlCache";

describe("createTtlCache — set/get", () => {
  it("set한 값을 동일 키로 get하면 반환한다", () => {
    const c = createTtlCache<number>({ ttlMs: 1000, maxEntries: 10 });
    c.set("a", 42);
    expect(c.get("a")).toBe(42);
  });

  it("미존재 키는 undefined를 반환한다", () => {
    const c = createTtlCache<number>({ ttlMs: 1000, maxEntries: 10 });
    expect(c.get("nope")).toBeUndefined();
  });
});

describe("createTtlCache — TTL 만료", () => {
  it("ttlMs 경계 직전엔 살아있고, 경과 후엔 miss(undefined)", () => {
    let t = 0;
    const c = createTtlCache<string>({
      ttlMs: 1000,
      maxEntries: 10,
      now: () => t,
    });
    c.set("k", "v");
    t = 999;
    expect(c.get("k")).toBe("v");
    t = 1001;
    expect(c.get("k")).toBeUndefined();
  });

  it("만료된 항목은 size에서도 제거된다 (lazy expiry)", () => {
    let t = 0;
    const c = createTtlCache<string>({
      ttlMs: 100,
      maxEntries: 10,
      now: () => t,
    });
    c.set("k", "v");
    t = 200;
    c.get("k");
    expect(c.size).toBe(0);
  });
});

describe("createTtlCache — 용량 초과 eviction", () => {
  it("maxEntries 초과 시 가장 오래된 항목을 제거한다", () => {
    const c = createTtlCache<number>({ ttlMs: 10_000, maxEntries: 2 });
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3); // a 축출
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
    expect(c.size).toBe(2);
  });

  it("기존 키 재설정은 최신으로 갱신되어 축출 대상에서 제외된다", () => {
    const c = createTtlCache<number>({ ttlMs: 10_000, maxEntries: 2 });
    c.set("a", 1);
    c.set("b", 2);
    c.set("a", 11); // a를 최신으로 끌어올림
    c.set("c", 3); // 가장 오래된 b가 축출됨
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(11);
    expect(c.get("c")).toBe(3);
  });
});

describe("createTtlCache — clear", () => {
  it("clear 후 모든 항목이 제거된다", () => {
    const c = createTtlCache<number>({ ttlMs: 1000, maxEntries: 10 });
    c.set("a", 1);
    c.set("b", 2);
    c.clear();
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBeUndefined();
    expect(c.size).toBe(0);
  });
});
