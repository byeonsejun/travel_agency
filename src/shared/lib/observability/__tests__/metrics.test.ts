/**
 * metrics.test.ts — 인메모리 metrics 카운터 단위 테스트 (M-OBS Task 6)
 *
 * 검증 축:
 *  1. incr — 단순 카운팅, by 파라미터
 *  2. 태그 키 정규화 (정렬된 k=v 형식)
 *  3. 태그 없는 카운터 키 (name만)
 *  4. observe — percentile 계산 (p50, p95, max)
 *  5. observe — 1000개 초과 시 oldest drop
 *  6. snapshot — 카운터 + 관측값 직렬화
 *  7. resetForTest — 전체 초기화
 */

import { beforeEach, describe, it, expect } from "vitest";
import { metrics } from "../metrics";

beforeEach(() => {
  metrics.resetForTest();
});

describe("metrics.incr — 카운팅", () => {
  it("동일 name으로 여러 번 호출하면 누적된다", () => {
    metrics.incr("payment.confirm.success");
    metrics.incr("payment.confirm.success");
    metrics.incr("payment.confirm.success");
    expect(metrics.snapshot().counters["payment.confirm.success"]).toBe(3);
  });

  it("by 파라미터로 증가량을 지정할 수 있다", () => {
    metrics.incr("requests", undefined, 5);
    metrics.incr("requests", undefined, 3);
    expect(metrics.snapshot().counters["requests"]).toBe(8);
  });

  it("서로 다른 name은 독립된 카운터를 가진다", () => {
    metrics.incr("a");
    metrics.incr("b");
    metrics.incr("b");
    const { counters } = metrics.snapshot();
    expect(counters["a"]).toBe(1);
    expect(counters["b"]).toBe(2);
  });
});

describe("metrics.incr — 태그 키 정규화", () => {
  it("태그가 있으면 name|k=v 형식의 정렬된 키를 생성한다", () => {
    metrics.incr("payment.webhook", { type: "PAYMENT_DONE", env: "test" });
    const { counters } = metrics.snapshot();
    // 태그 키는 알파벳 정렬 → env=test,type=PAYMENT_DONE
    expect(counters["payment.webhook|env=test,type=PAYMENT_DONE"]).toBe(1);
  });

  it("동일 태그가 다른 순서로 전달돼도 같은 키로 집계된다", () => {
    metrics.incr("evt", { z: "1", a: "2" });
    metrics.incr("evt", { a: "2", z: "1" });
    const { counters } = metrics.snapshot();
    expect(counters["evt|a=2,z=1"]).toBe(2);
  });

  it("태그가 없으면 name만으로 키를 만든다 (파이프 없음)", () => {
    metrics.incr("simple.counter");
    const { counters } = metrics.snapshot();
    expect(counters["simple.counter"]).toBe(1);
    // 파이프 포함 키는 없어야 함
    expect(Object.keys(counters).some((k) => k.startsWith("simple.counter|"))).toBe(false);
  });

  it("boolean 태그 값도 직렬화된다", () => {
    metrics.incr("feature", { enabled: true });
    const { counters } = metrics.snapshot();
    expect(counters["feature|enabled=true"]).toBe(1);
  });
});

describe("metrics.observe — percentile 계산", () => {
  it("100개 값 삽입 후 p50/p95/max가 올바르게 계산된다", () => {
    for (let i = 1; i <= 100; i++) metrics.observe("latency", i);
    const obs = metrics.snapshot().observations["latency"];
    expect(obs.count).toBe(100);
    expect(obs.max).toBe(100);
    // sorted [1..100], p50: ceil(50%) * 100 - 1 = 49 → sorted[49] = 50
    expect(obs.p50).toBe(50);
    // p95: ceil(95%) * 100 - 1 = 94 → sorted[94] = 95
    expect(obs.p95).toBe(95);
  });

  it("단일 값: p50 = p95 = max = 해당 값", () => {
    metrics.observe("single", 42);
    const obs = metrics.snapshot().observations["single"];
    expect(obs.count).toBe(1);
    expect(obs.p50).toBe(42);
    expect(obs.p95).toBe(42);
    expect(obs.max).toBe(42);
  });

  it("태그가 있는 observation은 독립된 버킷에 저장된다", () => {
    metrics.observe("http.duration", 100, { route: "/api/health" });
    metrics.observe("http.duration", 200, { route: "/api/payments" });
    const { observations } = metrics.snapshot();
    expect(observations["http.duration|route=/api/health"].count).toBe(1);
    expect(observations["http.duration|route=/api/payments"].count).toBe(1);
  });
});

describe("metrics.observe — 상한 1000 (oldest drop)", () => {
  it("1001개 삽입 시 count가 1000에 머문다", () => {
    for (let i = 0; i < 1_001; i++) metrics.observe("stream", i);
    const obs = metrics.snapshot().observations["stream"];
    expect(obs.count).toBe(1_000);
  });

  it("oldest drop 이후 max는 마지막 값으로 유지된다", () => {
    for (let i = 0; i < 1_001; i++) metrics.observe("stream", i);
    // 0이 드롭되고 1000이 마지막이므로 max = 1000
    expect(metrics.snapshot().observations["stream"].max).toBe(1_000);
  });
});

describe("metrics.resetForTest", () => {
  it("호출 후 카운터와 관측값 모두 초기화된다", () => {
    metrics.incr("a");
    metrics.observe("b", 1);
    metrics.resetForTest();
    const { counters, observations } = metrics.snapshot();
    expect(Object.keys(counters)).toHaveLength(0);
    expect(Object.keys(observations)).toHaveLength(0);
  });
});
