/** 환불 요청 단위 멱등키 생성 — 동일 논리 요청 재시도가 같은 키를 만들어 이중환불 차단. */

export function travelerCancelKey(bookingId: string, travelerIds: string[]): string {
  const sorted = [...travelerIds].sort();
  return `traveler-cancel:${bookingId}:${sorted.join(",")}`;
}

export function discretionaryKey(bookingId: string, requestId: string): string {
  return `discretionary:${bookingId}:${requestId}`;
}

export function fullCancelKey(bookingId: string): string {
  return `full-cancel:${bookingId}`;
}
