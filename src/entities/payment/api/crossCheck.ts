/**
 * 결제 금액 3중 교차 검증 (spec §3.4).
 *
 * 검증 시점:
 *   1. "request"    — DB 금액 vs 클라이언트 요청 금액 (Phase 1)
 *   2. "pg-response" — DB 금액 vs PG 승인 응답 금액 (Phase 3a)
 *
 * 정수가 아닌 금액이 도달하면 Zod·tossClient 이전 단계를 뚫었다는 의미이므로
 * 즉시 AMOUNT_NOT_INTEGER로 차단 — 보상 트랜잭션 판단 전에 실행 중단.
 */

import { PaymentError } from "./errors";

export type AmountSource = "request" | "pg-response";

export function assertAmountMatches(
  expected: number,
  actual: number,
  source: AmountSource
): void {
  // R6: actual이 정수 원 단위인지 먼저 확인.
  // Number.isInteger(10000.0) === true — JS에서 10000.0과 10000은 동일 정수.
  if (!Number.isInteger(actual)) {
    throw new PaymentError("AMOUNT_NOT_INTEGER", { actual, source });
  }

  if (expected !== actual) {
    const code =
      source === "request"
        ? "AMOUNT_MISMATCH_REQUEST"
        : "AMOUNT_MISMATCH_PG_RESPONSE";

    throw new PaymentError(code, { expected, actual, source });
  }
}
