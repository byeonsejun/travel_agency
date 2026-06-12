/**
 * 고객/관리자 예약 상세의 "취소·환불 내역" 3단 명세를 위한 순수 집계.
 * 결제 금액 = 위약금(취소 수수료) + 실 환불 금액 (위약금 0이면 전액 환불).
 *
 * 💳 금액 정확성은 협상 불가 — 모두 정수(원). 미결제 예약은 `hasData=false`로
 * 섹션 자체를 숨긴다(보여줄 금액이 없음).
 */
type PaymentLike = { amount: number; paidAt: Date | null };
type RefundJobLike = { amount: number; penaltyAmount: number; status: string };

export type RefundSummary = {
  /** 실제 결제된 금액(원) — paidAt 있는 결제의 합. */
  paidAmount: number;
  /** 취소 수수료(위약금) — SUCCEEDED 환불 job의 penaltyAmount 합. */
  penaltyAmount: number;
  /** 실 환불 금액 — SUCCEEDED 환불 job의 amount 합. */
  refundedAmount: number;
  /** 표시 여부 — 결제가 한 번이라도 있었는가(미결제면 false). */
  hasData: boolean;
};

export function computeRefundSummary(
  payments: readonly PaymentLike[],
  refundJobs: readonly RefundJobLike[],
): RefundSummary {
  const paidAmount = payments
    .filter((p) => p.paidAt !== null)
    .reduce((sum, p) => sum + p.amount, 0);

  const settled = refundJobs.filter((j) => j.status === "SUCCEEDED");
  const penaltyAmount = settled.reduce((sum, j) => sum + j.penaltyAmount, 0);
  const refundedAmount = settled.reduce((sum, j) => sum + j.amount, 0);

  return {
    paidAmount,
    penaltyAmount,
    refundedAmount,
    hasData: paidAmount > 0,
  };
}
