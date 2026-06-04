/** 잔여 환불가능액 = amount − refundedAmount (0 하한). 순수 함수. */
export function refundableAmount(p: { amount: number; refundedAmount: number }): number {
  return Math.max(p.amount - p.refundedAmount, 0);
}
