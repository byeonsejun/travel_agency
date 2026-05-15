/**
 * errorTracker.ts — Error Tracking 어댑터 추상화 (Sentry-ready, logger fanout default).
 *
 * 설계 원칙:
 *  - **동기 함수** — 내부 실패를 swallow하여 호출처 흐름을 절대 차단하지 않는다.
 *  - **ALS 자동 머지** — `getContext()`로 traceId/userId/routeName을 자동 결합한다.
 *  - **PII 방어** — 외부 전송(Sentry) 전 `maskPii`로 민감 정보를 리덕션한다.
 *  - **어댑터 인터페이스** — SENTRY_DSN 설정 시 `// TODO(M-OBS-2)` 경로로 전환 가능.
 *    현 Phase에서는 logger fanout만 수행하고 DSN 감지 시 1회 경고를 발한다.
 */

import type { ErrorTrackerCtx } from "./types";
import { logger } from "./logger";
import { getContext } from "./context";
import { maskPii } from "./pii";

/** DSN이 감지됐으나 SDK가 미연결임을 알리는 warn — 프로세스 생애 1회만 발한다. */
let sentryWarnEmitted = false;

/** 테스트 전용 — sentryWarnEmitted 상태를 초기화한다. */
export function _resetForTest(): void {
  sentryWarnEmitted = false;
}

/**
 * ALS 컨텍스트와 추가 ctx를 병합한 뒤 PII를 마스킹하여 반환한다.
 *
 * 병합 우선순위: ctx > ALS getContext()
 * extras는 별도 키로 보존되어 Sentry breadcrumb용으로 사용된다.
 */
function mergeAndMaskCtx(ctx?: ErrorTrackerCtx): Record<string, unknown> {
  const alsCtx = getContext() ?? {};
  const { extras, ...ctxBase } = ctx ?? {};

  const merged: Record<string, unknown> = {
    ...alsCtx,
    ...ctxBase,
    ...(extras !== undefined ? { extras } : {}),
  };

  return maskPii(merged) as Record<string, unknown>;
}

/** DSN이 설정됐으나 SDK가 미연결인 경우 1회 경고를 발한다. */
function notifySentryNotWired(): void {
  if (sentryWarnEmitted) return;
  sentryWarnEmitted = true;
  // TODO(M-OBS-2): dynamic import("@sentry/node") — DSN 설정 후 여기서 Sentry SDK를 초기화한다.
  logger.warn("errorTracker.sentry.not_wired", {
    hint: "SENTRY_DSN is configured but @sentry/node is not wired. Add dynamic import to enable Sentry transport.",
  });
}

/**
 * 예외를 캡처한다.
 *
 * - SENTRY_DSN 미설정: `logger.error("error.captured", err, maskedCtx)` fanout만 수행
 * - SENTRY_DSN 설정: 1회 경고 후 동일 logger fanout (SDK 미연결 Phase)
 */
export function captureException(err: unknown, ctx?: ErrorTrackerCtx): void {
  try {
    if (process.env.SENTRY_DSN) notifySentryNotWired();

    const merged = mergeAndMaskCtx(ctx);
    logger.error("error.captured", err, merged);
  } catch (internalErr) {
    try {
      logger.warn("errorTracker.internal_failure", {
        internalErrorMessage:
          internalErr instanceof Error ? internalErr.message : String(internalErr),
      });
    } catch {
      // 최후 방어선 — 로거 자체가 실패한 경우. 더 이상 할 수 있는 게 없다.
    }
  }
}

/**
 * 메시지를 캡처한다.
 *
 * - level "error": `logger.error("message.captured", msg, maskedCtx)` 팬아웃
 * - level "warn": `logger.warn("message.captured", { message, ...maskedCtx })` 팬아웃
 */
export function captureMessage(
  msg: string,
  level: "warn" | "error",
  ctx?: ErrorTrackerCtx
): void {
  try {
    if (process.env.SENTRY_DSN) notifySentryNotWired();

    const merged = mergeAndMaskCtx(ctx);

    if (level === "error") {
      logger.error("message.captured", msg, merged);
    } else {
      logger.warn("message.captured", { message: msg, ...merged });
    }
  } catch (internalErr) {
    try {
      logger.warn("errorTracker.internal_failure", {
        internalErrorMessage:
          internalErr instanceof Error ? internalErr.message : String(internalErr),
      });
    } catch {
      // 최후 방어선
    }
  }
}
