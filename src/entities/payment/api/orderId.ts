/**
 * Toss orderId 인코딩 정책 (spec §2.2).
 *
 * 형식: `${bookingId}__${seq}`
 * - `__` 구분자로 bookingId와 재시도 시퀀스를 결합
 * - Toss API orderId 최대 64자 제한 준수
 * - seq: 1 이상의 양의 정수 (같은 bookingId에 대한 재시도 구분)
 *
 * Toss 멱등성 키로 사용되므로: 같은 (bookingId, seq) 쌍은 항상 동일한 orderId를 반환한다.
 */

const TOSS_ORDER_ID_MAX_LEN = 64;

// seq는 1 이상의 양의 정수만 허용 — 0이나 음수는 재시도 의미 없음
const ORDER_ID_PATTERN = /^(.+)__([1-9]\d*)$/;

export function buildOrderId(bookingId: string, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error(`orderId seq must be a positive integer (≥ 1), got: ${seq}`);
  }

  const orderId = `${bookingId}__${seq}`;

  if (orderId.length > TOSS_ORDER_ID_MAX_LEN) {
    throw new Error(
      `orderId exceeds Toss limit of ${TOSS_ORDER_ID_MAX_LEN} chars: length=${orderId.length}`
    );
  }

  return orderId;
}

export function parseBookingIdFromOrderId(orderId: string): string {
  const match = ORDER_ID_PATTERN.exec(orderId);
  if (!match) {
    throw new Error(
      `Invalid orderId format — expected "<bookingId>__<seq≥1>", got: "${orderId}"`
    );
  }
  return match[1]!;
}
