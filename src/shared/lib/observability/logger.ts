/**
 * logger.ts — 구조화 로거 v2.
 *
 * 특징:
 *  - `getContext()`로 ALS 컨텍스트(traceId/userId/routeName 등)를 자동 머지
 *  - `maskPii`로 data 직렬화 직전 PII 리덕션
 *  - `OBSERVABILITY_LOG_LEVEL` 환경 변수로 출력 레벨 임계값 조정 (기본: "info")
 *  - `NODE_ENV === "test"` 또는 레벨 미만이면 silent
 *  - info/debug → console.log (stdout), warn → console.warn, error → console.error
 */

import type { LogLevel, LogPayload } from "./types";
import { getContext } from "./context";
import { maskPii } from "./pii";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getMinRank(): number {
  const raw = process.env.OBSERVABILITY_LOG_LEVEL ?? "info";
  return LEVEL_RANK[raw as LogLevel] ?? LEVEL_RANK.info;
}

function emit(level: LogLevel, event: string, extra: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "test") return;
  if (LEVEL_RANK[level] < getMinRank()) return;

  const ctx = getContext() ?? {};
  const merged = { ...ctx, ...extra };
  const masked = maskPii(merged) as Record<string, unknown>;

  const payload: LogPayload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...masked,
  };

  const line = JSON.stringify(payload);

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug(event: string, data?: Record<string, unknown>): void {
    emit("debug", event, data ?? {});
  },

  info(event: string, data?: Record<string, unknown>): void {
    emit("info", event, data ?? {});
  },

  warn(event: string, data?: Record<string, unknown>): void {
    emit("warn", event, data ?? {});
  },

  /**
   * @param err - Error 인스턴스 또는 임의 값. message/stack 자동 추출.
   * @param data - 추가 컨텍스트 (bookingId, paymentId 등)
   */
  error(event: string, err: unknown, data?: Record<string, unknown>): void {
    emit("error", event, {
      ...data,
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack : undefined,
    });
  },
};
