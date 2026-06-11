/**
 * web-vitals 표준 임계로 good/needs-improvement/poor 판정 (순수함수).
 * 출처: web.dev Core Web Vitals 권장 임계값. 서버(route handler)가 적재 시 호출.
 */

export type WebVitalMetric = "LCP" | "INP" | "CLS" | "TTFB" | "FCP";
export type WebVitalRating = "good" | "needs-improvement" | "poor";

/** [good 상한, ni 상한] — 값 ≤ good → good, ≤ poor 상한 → ni, 초과 → poor. */
const THRESHOLDS: Record<WebVitalMetric, readonly [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

export function ratingFor(metric: WebVitalMetric, value: number): WebVitalRating {
  const [good, ni] = THRESHOLDS[metric];
  if (value <= good) return "good";
  if (value <= ni) return "needs-improvement";
  return "poor";
}
