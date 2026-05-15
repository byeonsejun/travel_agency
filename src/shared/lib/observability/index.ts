/**
 * `shared/lib/observability` 슬라이스 공개 API barrel.
 *
 * Architect R3: 명시적 named export만 — 깊은 경로 import 금지.
 * 외부 모듈은 이 파일만 import한다.
 */

// --- 타입 ---
export type {
  LogLevel,
  LogContext,
  MetricTagValue,
  MetricTags,
  ErrorTrackerCtx,
  LogPayload,
} from "./types";

// --- PII 마스킹 ---
export { maskPii } from "./pii";

// --- 요청 컨텍스트 (Node runtime 전용) ---
export { runWithContext, getContext, setContext } from "./context";

// --- Trace ID 발급 ---
export { generateTraceId, isValidTraceId } from "./generateTraceId";

// --- 구조화 로거 v2 ---
export { logger } from "./logger";

// --- Error Tracker 어댑터 (Sentry-ready, logger fanout default) ---
export { captureException, captureMessage } from "./errorTracker";

// --- 인메모리 Metrics 카운터 ---
export { metrics } from "./metrics";

// --- Route 관측 래퍼 (Node runtime 전용) ---
export { withObservedRoute } from "./withObservedRoute";
