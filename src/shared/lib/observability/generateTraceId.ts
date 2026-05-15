/**
 * generateTraceId.ts — 요청 단위 Trace ID 발급기.
 *
 * `crypto.randomUUID()`의 128-bit 난수를 hex 전개 후 16자로 단축.
 * Edge/Node 양쪽에서 사용 가능 (Web Crypto API 기반).
 */

/**
 * 16자 소문자 hex Trace ID를 발급한다.
 * URL-safe하고, 로그 라인에서 시각적으로 구별 가능한 길이.
 */
export function generateTraceId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

const TRACE_ID_RE = /^[0-9a-f]{16}$/;

/**
 * 주어진 문자열이 유효한 Trace ID 형식(16자 소문자 hex)인지 검증한다.
 */
export function isValidTraceId(s: string): boolean {
  return TRACE_ID_RE.test(s);
}
