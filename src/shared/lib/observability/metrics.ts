/**
 * metrics.ts — 인메모리 카운터 + 관측값(observation) 모듈.
 *
 * 설계 원칙:
 *  - 서버 프로세스 생애 동안 단일 Map 인스턴스를 유지 (모듈 싱글톤)
 *  - observation 상한 1000 — 메모리 누수 방지 (Backend Expert R4)
 *  - `flush()`는 수동 호출 전용 (본 Phase에서 cron 미부착)
 *  - `resetForTest()`는 테스트 전용 — 프로덕션 코드에서 호출 금지
 */

import type { MetricTags } from "./types";
import { logger } from "./logger";

const OBSERVATION_CAP = 1_000;

const counters = new Map<string, number>();
const observations = new Map<string, number[]>();

/**
 * 태그를 정렬된 `k=v` 쌍으로 직렬화하여 카운터 키를 만든다.
 * 태그 없음: name 그대로 반환.
 */
function makeKey(name: string, tags?: MetricTags): string {
  if (!tags || Object.keys(tags).length === 0) return name;
  const pairs = Object.keys(tags)
    .sort()
    .map((k) => `${k}=${String(tags[k])}`)
    .join(",");
  return `${name}|${pairs}`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/** 카운터를 `by`만큼 증가시킨다. 기본값 1. */
function incr(name: string, tags?: MetricTags, by = 1): void {
  const key = makeKey(name, tags);
  counters.set(key, (counters.get(key) ?? 0) + by);
}

/**
 * 관측값(latency, size 등)을 기록한다.
 * 1000개 초과 시 가장 오래된 값(oldest)부터 드롭한다.
 */
function observe(name: string, value: number, tags?: MetricTags): void {
  const key = makeKey(name, tags);
  const arr = observations.get(key) ?? [];
  if (arr.length >= OBSERVATION_CAP) arr.shift();
  arr.push(value);
  observations.set(key, arr);
}

/**
 * 현재 카운터 + 관측값 요약을 반환한다.
 * 관측값은 정렬 후 p50/p95/max를 계산한다.
 */
function snapshot(): {
  counters: Record<string, number>;
  observations: Record<string, { count: number; p50: number; p95: number; max: number }>;
} {
  const cs: Record<string, number> = {};
  for (const [k, v] of counters) cs[k] = v;

  const os: Record<string, { count: number; p50: number; p95: number; max: number }> = {};
  for (const [k, arr] of observations) {
    const sorted = [...arr].sort((a, b) => a - b);
    os[k] = {
      count: arr.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      max: sorted[sorted.length - 1] ?? 0,
    };
  }
  return { counters: cs, observations: os };
}

/** 수동 flush — 현재 snapshot을 구조화 로그로 출력한다. */
function flush(): void {
  logger.info("metrics.flush", snapshot() as unknown as Record<string, unknown>);
}

/** 테스트 전용 — 모든 카운터와 관측값을 초기화한다. */
function resetForTest(): void {
  counters.clear();
  observations.clear();
}

export const metrics = { incr, observe, snapshot, flush, resetForTest };
