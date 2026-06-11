import { z } from "zod";
import type { WebVitalMetric } from "./rating";

export const METRICS = ["LCP", "INP", "CLS", "TTFB", "FCP"] as const satisfies readonly WebVitalMetric[];

/**
 * RUM 수신 페이로드 검증. fire-and-forget 비콘이라 엄격하게 — 미상 metric/음수/NaN/과대값 차단.
 * value 상한 1_000_000ms(=1000s) — 정상 측정 불가 범위 거부.
 */
export const webVitalSchema = z.object({
  metric: z.enum(METRICS),
  value: z.number().finite().nonnegative().max(1_000_000),
  route: z.string().min(1).max(120),
  navType: z.string().max(40).optional(),
});

export type WebVitalInput = z.infer<typeof webVitalSchema>;
