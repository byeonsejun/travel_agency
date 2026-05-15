/**
 * M-OBS 관측성 도메인 타입.
 *
 * 본 모듈은 runtime 의존성 없이 타입만 정의한다 (Edge/Node 양쪽 import 가능).
 * 단, `LogContext`를 채우는 `runWithContext`(context.ts)는 Node runtime 전용이다.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * 요청·작업 단위 관측 컨텍스트.
 *
 * `AsyncLocalStorage`에 저장되어 `logger`/`metrics`/`errorTracker` 호출 시 자동 머지된다.
 * 모든 필드는 optional — 컨텍스트가 없는 곳(스크립트·테스트)에서도 로거가 동작해야 한다.
 */
export interface LogContext {
  traceId?: string;
  userId?: string;
  routeName?: string;
  bookingId?: string;
  paymentId?: string;
}

/**
 * Metric tag 값은 직렬화 가능한 primitive만 허용. 객체·배열 금지.
 */
export type MetricTagValue = string | number | boolean;
export type MetricTags = Record<string, MetricTagValue>;

/**
 * `captureException` / `captureMessage` 부가 컨텍스트.
 * `LogContext`와 자유 형식 extras를 분리해 호출처에서 의도를 명확히 표현.
 */
export interface ErrorTrackerCtx extends LogContext {
  extras?: Record<string, unknown>;
}

/**
 * 구조화 로그 라인 페이로드 (직렬화 직전 형태).
 * 직접 사용처는 logger 내부 — 외부 모듈은 logger API만 사용한다.
 */
export interface LogPayload extends LogContext {
  ts: string;
  level: LogLevel;
  event: string;
  errorMessage?: string;
  errorStack?: string;
  [key: string]: unknown;
}
