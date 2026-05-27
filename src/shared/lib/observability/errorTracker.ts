/**
 * errorTracker.ts — Error Tracking 어댑터 (Sentry-wired, Phase 3 B2-A).
 *
 * 설계 원칙:
 *  - **동기 함수** — 내부 실패를 swallow하여 호출처 흐름을 절대 차단하지 않는다.
 *  - **ALS 자동 머지** — `getContext()`로 traceId/userId/routeName을 자동 결합한다.
 *  - **PII 방어** — 외부 전송(Sentry) 전 `maskPii`로 민감 정보를 리덕션한다.
 *  - **SDK fanout** — SENTRY_DSN 설정 시 `@sentry/nextjs`로 forwarding (instrumentation.ts에서 init 완료된 싱글톤 동기 참조).
 *  - **Server-only** — 이 모듈은 ALS(async_hooks) 의존이라 client 번들에서 import 금지. 클라이언트는 @sentry/nextjs를 직접 호출 (예: app/global-error.tsx).
 */

import * as Sentry from "@sentry/nextjs";
import type { ErrorTrackerCtx } from "./types";
import { logger } from "./logger";
import { getContext } from "./context";
import { maskPii } from "./pii";

/** Sentry scope의 최소 인터페이스 — setTag/setExtra만 사용한다. */
type ScopeMinimal = {
  setTag: (key: string, value: string | number) => void;
  setExtra: (key: string, value: unknown) => void;
};

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

/**
 * 머지된 context를 Sentry scope에 머지한다.
 * string/number는 setTag(검색 가능), 그 외는 setExtra(payload 저장).
 */
function applyScope(scope: ScopeMinimal, merged: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(merged)) {
    if (typeof v === "string" || typeof v === "number") {
      scope.setTag(k, v);
    } else {
      scope.setExtra(k, v);
    }
  }
}

/**
 * 예외를 캡처한다.
 *
 * - SENTRY_DSN 설정 시: Sentry.withScope로 ALS context를 머지한 뒤 captureException + logger.error fanout
 * - SENTRY_DSN 미설정: logger.error만 fanout (Sentry.init이 no-op이므로 안전하게도 SDK 호출 가능하지만 분기로 명시)
 */
export function captureException(err: unknown, ctx?: ErrorTrackerCtx): void {
  try {
    const merged = mergeAndMaskCtx(ctx);

    if (process.env.SENTRY_DSN) {
      Sentry.withScope((scope) => {
        applyScope(scope as unknown as ScopeMinimal, merged);
        const errAsError = err instanceof Error ? err : new Error(String(err));
        Sentry.captureException(errAsError);
      });
    }

    // logger fanout은 항상 유지 — SDK 장애와 무관한 최후 방어선
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
 * - level "error": Sentry.captureMessage + logger.error fanout
 * - level "warn": Sentry.captureMessage(level: "warning") + logger.warn fanout
 */
export function captureMessage(
  msg: string,
  level: "warn" | "error",
  ctx?: ErrorTrackerCtx,
): void {
  try {
    const merged = mergeAndMaskCtx(ctx);

    if (process.env.SENTRY_DSN) {
      Sentry.withScope((scope) => {
        applyScope(scope as unknown as ScopeMinimal, merged);
        Sentry.captureMessage(msg, level === "error" ? "error" : "warning");
      });
    }

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
