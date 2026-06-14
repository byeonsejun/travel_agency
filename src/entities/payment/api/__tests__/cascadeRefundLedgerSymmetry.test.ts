/**
 * cascade 환불 원장 대칭성 회귀 가드. [fix/cascade-refund-ledger-symmetry]
 *
 * 닫는 잠복 버그: cascade 환불은 enqueue 시점에 reserveRefund 를 하지 않으면서도,
 * cron 영구실패 경로(refundRetry.ts)는 releaseRefund(amount: job.amount) 를 호출한다.
 * → reserve 없는 release 가 refundedAmount 를 음수로 만든다(불변식 0 ≤ refundedAmount 위반).
 *
 * 이 테스트는 reserve↔release 가 짝이 맞으면 refundedAmount 가 원복(음수 아님)됨을 고정한다.
 * 실제 ledger 함수를 사용(mock 아님) + refundedAmount 를 in-memory 카운터로 모사.
 */
import { describe, it, expect, vi } from "vitest";
import { reserveRefund, releaseRefund } from "../ledger";
import type { Prisma } from "@prisma/client";

/** refundedAmount 를 실제로 증감하는 미니 Prisma tx — reserve 의 lte 가드도 충실히 반영. */
function statefulTx(initialRefunded: number) {
  let refundedAmount = initialRefunded;
  return {
    _get: () => refundedAmount,
    payment: {
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { refundedAmount?: { lte: number } };
          data: { refundedAmount: { increment?: number; decrement?: number } };
        }) => {
          // reserveRefund 의 조건부 CAS 가드(refundedAmount lte) 반영.
          if (
            where.refundedAmount?.lte !== undefined &&
            refundedAmount > where.refundedAmount.lte
          ) {
            return { count: 0 };
          }
          if (data.refundedAmount.increment !== undefined) {
            refundedAmount += data.refundedAmount.increment;
          }
          if (data.refundedAmount.decrement !== undefined) {
            refundedAmount -= data.refundedAmount.decrement;
          }
          return { count: 1 };
        },
      ),
    },
  };
}

const PAYMENT_TOTAL = 1_000_000;

describe("cascade 환불 원장 대칭성 (reserve ↔ release)", () => {
  it("reserve(전액) 후 release(전액) → refundedAmount 원복(0), 음수 아님", async () => {
    const tx = statefulTx(0);

    // enqueue 시점 reserve(전액) — cascade 정상 케이스(refundedAmount=0).
    const ok = await reserveRefund(tx as unknown as Prisma.TransactionClient, {
      paymentId: "p1",
      amount: PAYMENT_TOTAL,
      requestedRefund: PAYMENT_TOTAL,
    });
    expect(ok).toBe(true);
    expect(tx._get()).toBe(PAYMENT_TOTAL); // 예약 반영

    // cron 영구실패 시 release(job.amount = 전액).
    await releaseRefund(tx as unknown as Prisma.TransactionClient, {
      paymentId: "p1",
      amount: PAYMENT_TOTAL,
    });

    expect(tx._get()).toBe(0); // 정확히 cascade 이전 값으로 원복
    expect(tx._get()).toBeGreaterThanOrEqual(0); // 핵심 불변식: 음수 금지
  });

  it("부분환불 잔액(300k 기환불) 상태에서 reserve(잔여 700k)→release(700k)도 원복", async () => {
    const tx = statefulTx(300_000);

    const ok = await reserveRefund(tx as unknown as Prisma.TransactionClient, {
      paymentId: "p1",
      amount: PAYMENT_TOTAL,
      requestedRefund: 700_000,
    });
    expect(ok).toBe(true);
    expect(tx._get()).toBe(PAYMENT_TOTAL); // 300k + 700k

    await releaseRefund(tx as unknown as Prisma.TransactionClient, {
      paymentId: "p1",
      amount: 700_000,
    });

    expect(tx._get()).toBe(300_000); // 기환불 보존
    expect(tx._get()).toBeGreaterThanOrEqual(0);
  });

  it("(버그 문서) reserve 없이 release 만 하면 음수 — 이번 변경(enqueue reserve 추가)이 닫는 잠복 버그", async () => {
    const tx = statefulTx(0);

    // 변경 전 cascade: reserve 없이 cron 영구실패가 release 만 호출.
    await releaseRefund(tx as unknown as Prisma.TransactionClient, {
      paymentId: "p1",
      amount: PAYMENT_TOTAL,
    });

    expect(tx._get()).toBe(-PAYMENT_TOTAL); // 음수 — 불변식 위반(그래서 enqueue 에 reserve 를 추가)
  });
});
