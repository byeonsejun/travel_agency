import { describe, it, expect } from "vitest";
import { computeRefundSummary } from "../refundSummary";

const paid = (amount: number) => ({ amount, paidAt: new Date("2026-06-01") });
const unpaid = (amount: number) => ({ amount, paidAt: null });
const rj = (amount: number, penaltyAmount: number, status = "SUCCEEDED") => ({
  amount,
  penaltyAmount,
  status,
});

describe("computeRefundSummary", () => {
  it("위약금 차감 전체취소: 결제=위약금+환불", () => {
    const s = computeRefundSummary([paid(1_980_000)], [rj(1_782_000, 198_000)]);
    expect(s).toEqual({
      paidAmount: 1_980_000,
      penaltyAmount: 198_000,
      refundedAmount: 1_782_000,
      hasData: true,
    });
  });

  it("위약금 면제(0원): 환불=결제 전액", () => {
    const s = computeRefundSummary([paid(1_980_000)], [rj(1_980_000, 0)]);
    expect(s.penaltyAmount).toBe(0);
    expect(s.refundedAmount).toBe(1_980_000);
    expect(s.hasData).toBe(true);
  });

  it("미결제(RECEIVED) 예약: 표시할 금액 없음 → hasData=false", () => {
    const s = computeRefundSummary([], []);
    expect(s).toEqual({ paidAmount: 0, penaltyAmount: 0, refundedAmount: 0, hasData: false });
  });

  it("결제는 했으나 환불 job 아직 없음(처리 중): 결제액만, 환불 0", () => {
    const s = computeRefundSummary([paid(1_000_000)], []);
    expect(s.paidAmount).toBe(1_000_000);
    expect(s.refundedAmount).toBe(0);
    expect(s.hasData).toBe(true);
  });

  it("다회 부분환불: SUCCEEDED job들의 위약금·환불액을 합산", () => {
    const s = computeRefundSummary([paid(2_000_000)], [rj(800_000, 200_000), rj(900_000, 100_000)]);
    expect(s.penaltyAmount).toBe(300_000);
    expect(s.refundedAmount).toBe(1_700_000);
  });

  it("미완료(PENDING/IN_PROGRESS) job은 합산에서 제외", () => {
    const s = computeRefundSummary(
      [paid(2_000_000)],
      [rj(900_000, 100_000, "SUCCEEDED"), rj(900_000, 100_000, "PENDING")],
    );
    expect(s.refundedAmount).toBe(900_000);
    expect(s.penaltyAmount).toBe(100_000);
  });

  it("paidAt 없는(미결제) payment row는 결제액에서 제외", () => {
    const s = computeRefundSummary([unpaid(500_000), paid(1_000_000)], []);
    expect(s.paidAmount).toBe(1_000_000);
  });

  it("입력 배열을 변이하지 않는다", () => {
    const payments = [paid(1_000_000)];
    const jobs = [rj(900_000, 100_000)];
    const snapP = JSON.parse(JSON.stringify(payments));
    const snapJ = JSON.parse(JSON.stringify(jobs));
    computeRefundSummary(payments, jobs);
    expect(JSON.parse(JSON.stringify(payments))).toEqual(snapP);
    expect(JSON.parse(JSON.stringify(jobs))).toEqual(snapJ);
  });
});
