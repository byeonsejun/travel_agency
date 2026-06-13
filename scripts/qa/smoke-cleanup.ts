/**
 * dev DB 정리: [SMOKE] 마커 예약 + 매직링크(VerificationToken) 토큰 제거.
 *
 * 대상 식별:
 *   - Booking.notes 에 "[SMOKE]" 포함된 예약만 (notes=null 인 실제 테스트 예약은 보존).
 *   - VerificationToken 전체 (dev 매직링크 — 만료/유효 무관 정리).
 *
 * 삭제 순서 (RESTRICT FK 회피, 단일 $transaction):
 *   PaymentEvent → RefundJob → Payment → Booking(→ Traveler/BookingTerms/BookingEvent/EmailJob/Review cascade)
 *
 * DRY-RUN 기본. 실제 삭제는 `--apply` 플래그.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const targets = await db.booking.findMany({
    where: { notes: { contains: "[SMOKE" } },
    select: { id: true, status: true, notes: true },
  });
  const ids = targets.map((b) => b.id);

  console.log(`[${APPLY ? "APPLY" : "DRY-RUN"}] SMOKE 예약 대상 ${ids.length}건:`);
  for (const b of targets) console.log(`  ${b.id} | ${b.status} | ${JSON.stringify(b.notes)}`);

  // 자식 레코드 사전 카운트 (증거)
  const [pe, rj, pay, tr, em] = await Promise.all([
    db.paymentEvent.count({ where: { bookingId: { in: ids } } }),
    db.refundJob.count({ where: { bookingId: { in: ids } } }),
    db.payment.count({ where: { bookingId: { in: ids } } }),
    db.traveler.count({ where: { bookingId: { in: ids } } }),
    db.emailJob.count({ where: { bookingId: { in: ids } } }),
  ]);
  const tokenCount = await db.verificationToken.count();
  console.log(`  자식: PaymentEvent=${pe} RefundJob=${rj} Payment=${pay} Traveler=${tr}(cascade) EmailJob=${em}(cascade)`);
  console.log(`  VerificationToken 전체=${tokenCount} (전부 삭제 예정)`);

  if (!APPLY) {
    console.log("\nDRY-RUN 종료. 실제 삭제하려면 --apply 플래그를 붙여 재실행.");
    return;
  }

  const result = await db.$transaction(async (tx) => {
    const dPE = ids.length ? await tx.paymentEvent.deleteMany({ where: { bookingId: { in: ids } } }) : { count: 0 };
    const dRJ = ids.length ? await tx.refundJob.deleteMany({ where: { bookingId: { in: ids } } }) : { count: 0 };
    const dPay = ids.length ? await tx.payment.deleteMany({ where: { bookingId: { in: ids } } }) : { count: 0 };
    const dBk = ids.length ? await tx.booking.deleteMany({ where: { id: { in: ids } } }) : { count: 0 };
    const dTok = await tx.verificationToken.deleteMany({});
    return { dPE, dRJ, dPay, dBk, dTok };
  });

  console.log("\n✅ 삭제 완료:");
  console.log(`  PaymentEvent=${result.dPE.count} RefundJob=${result.dRJ.count} Payment=${result.dPay.count} Booking=${result.dBk.count}(+cascade) VerificationToken=${result.dTok.count}`);

  // 사후 검증
  const [remainSmoke, remainBookings, remainTokens] = await Promise.all([
    db.booking.count({ where: { notes: { contains: "[SMOKE" } } }),
    db.booking.count(),
    db.verificationToken.count(),
  ]);
  console.log(`\n검증: 잔여 SMOKE 예약=${remainSmoke} | 전체 예약=${remainBookings} | 잔여 토큰=${remainTokens}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
