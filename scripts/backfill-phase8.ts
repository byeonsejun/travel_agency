/**
 * Phase 8 backfill — 멱등. 재실행 안전(이미 채워진 row 스킵).
 *  1) Traveler.paxType/unitPrice (assignPaxTypes, totalPrice 잔차보정)
 *  2) Payment.refundedAmount = Σ active RefundJob.amount
 *  3) 기존 RefundJob kind/baseAmount/seatsReleased/idempotencyKey
 * 실행: npx tsx scripts/backfill-phase8.ts
 */
import type { RefundJobStatus } from "@prisma/client";
import { db } from "@/shared/lib/db";
import { assignPaxTypes } from "@/entities/booking/model/paxAssignment";
import { fullCancelKey } from "@/entities/payment/model/refundKeys";

const ACTIVE: RefundJobStatus[] = ["PENDING", "IN_PROGRESS", "SUCCEEDED"];

export function computeRefundedFromJobs(jobs: { amount: number; status: string }[]): number {
  return jobs
    .filter((j) => ACTIVE.includes(j.status as RefundJobStatus))
    .reduce((s, j) => s + j.amount, 0);
}

async function backfillTravelers() {
  const bookings = await db.booking.findMany({
    where: { travelers: { some: { paxType: null } } },
    include: {
      travelers: true,
      departure: { select: { priceAdult: true, priceChild: true, priceInfant: true } },
    },
  });
  for (const b of bookings) {
    if (b.travelers.length !== b.adultCount + b.childCount + b.infantCount) {
      console.warn(`SKIP booking ${b.id}: traveler count mismatch (manual review)`);
      continue;
    }
    const assigned = assignPaxTypes({
      travelers: b.travelers.map((t) => ({ key: t.id, birthDate: t.birthDate })),
      adultCount: b.adultCount,
      childCount: b.childCount,
      infantCount: b.infantCount,
      priceAdult: b.departure.priceAdult,
      priceChild: b.departure.priceChild,
      priceInfant: b.departure.priceInfant,
      totalPrice: b.totalPrice,
    });
    for (const a of assigned) {
      await db.traveler.update({
        where: { id: a.key },
        data: { paxType: a.paxType, unitPrice: a.unitPrice },
      });
    }
    console.log(`✓ traveler backfill booking ${b.id}`);
  }
}

async function backfillPayments() {
  const payments = await db.payment.findMany({
    include: {
      refundJobs: true,
      booking: { select: { adultCount: true, childCount: true } },
    },
  });
  for (const p of payments) {
    const refunded = computeRefundedFromJobs(p.refundJobs);
    await db.payment.update({
      where: { id: p.id },
      data: { refundedAmount: refunded },
    });
    for (const j of p.refundJobs) {
      if (j.idempotencyKey) continue; // 멱등: 이미 처리
      await db.refundJob
        .update({
          where: { id: j.id },
          data: {
            baseAmount: p.amount,
            seatsReleased: p.booking.adultCount + p.booking.childCount,
            idempotencyKey: fullCancelKey(j.bookingId),
          },
        })
        .catch((e) => console.warn(`RefundJob ${j.id} idempotencyKey conflict skipped: ${e}`));
    }
    console.log(`✓ payment backfill ${p.id} refunded=${refunded}`);
  }
}

async function main() {
  await backfillTravelers();
  await backfillPayments();
  console.log("Phase 8 backfill done.");
}

if (process.env.NODE_ENV !== "test") {
  main().catch(console.error).finally(() => db.$disconnect());
}
