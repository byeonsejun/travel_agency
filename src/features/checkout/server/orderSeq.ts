/** 기존 결제 시도 수를 받아 다음 orderId seq를 반환하는 순수 함수. */
export function nextOrderSeq(existingPaymentCount: number): number {
  return existingPaymentCount + 1;
}
