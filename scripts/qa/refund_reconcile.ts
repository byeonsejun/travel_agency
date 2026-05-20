/**
 * refund_reconcile.ts — stale dev RefundJob을 수동으로 종료해 일관 상태로 되돌리는 admin 스크립트.
 *
 * 언제 사용?
 *   - dev 폴백 모드에서 만들어진 합성 tossPaymentKey(`dev_mock_*`)로 결제된
 *     booking은 Toss가 인식하지 못해 PG cancel이 영원히 실패한다. backoff
 *     재시도를 아무리 돌려도 성공 못 함 — 운영자가 끊어줘야 한다.
 *
 * 무엇을 하는가?
 *   1) 활성 RefundJob을 SUCCEEDED로 종료 (lastError에 reconciliation 사유 기록).
 *   2) Payment.status = CANCELED + canceledAt = now.
 *   3) booking.transitionStatus(CANCELED_BY_USER, actor=admin:reconcile)
 *      → 좌석 환원 + BookingEvent append 자동 처리.
 *   4) PaymentEvent (RECONCILED) append — providerEventId 멱등성 키 부여.
 *
 * 절대로 production에서 자동 실행되지 않게 안전장치:
 *   - NODE_ENV가 'production'이면 즉시 중단.
 *   - tossPaymentKey가 `dev_mock_*` 또는 명시적 --force 플래그가 있을 때만 진행.
 *
 * 사용:
 *   npx tsx scripts/qa/refund_reconcile.ts <bookingId> [--force]
 */

import { PrismaClient } from "@prisma/client";

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("[refund_reconcile] production 환경에서는 실행 불가");
    process.exit(2);
  }

  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const bookingId = args.find((a) => !a.startsWith("--"));
  if (!bookingId) {
    console.error("usage: refund_reconcile.ts <bookingId> [--force]");
    process.exit(2);
  }

  const db = new PrismaClient();
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { payments: true },
  });
  if (!booking) {
    console.error(`booking ${bookingId} not found`);
    process.exit(2);
  }
  console.log("booking.status :", booking.status);
  console.log(
    "payments       :",
    booking.payments.map((p) => ({ id: p.id.slice(-8), status: p.status, key: p.tossPaymentKey?.slice(0, 18) }))
  );

  // 안전장치 1: PAID 상태가 아니면 reconcile 의미 없음
  if (booking.status !== "PAID" && booking.status !== "READY") {
    console.error(
      `booking 상태(${booking.status})는 reconcile 대상이 아닙니다 (PAID/READY만).`
    );
    process.exit(2);
  }

  const paidPayment = booking.payments.find((p) => p.status === "PAID");
  if (!paidPayment) {
    console.error("PAID payment 없음 — reconcile 불필요");
    process.exit(2);
  }
  console.log("paidPayment.tossKey:", paidPayment.tossPaymentKey);

  // 안전장치 2: dev_mock_ 키가 아닐 경우 --force 요구
  const isDevSyntheticKey = paidPayment.tossPaymentKey?.startsWith("dev_mock_");
  if (!isDevSyntheticKey && !force) {
    console.error(
      "tossPaymentKey가 실제 Toss 키로 보입니다. 실 결제 reconcile은 --force가 필요합니다."
    );
    process.exit(2);
  }

  const activeJob = await db.refundJob.findFirst({
    where: { bookingId, status: { in: ["PENDING", "IN_PROGRESS"] } },
    orderBy: { createdAt: "desc" },
  });
  console.log("activeJob      :", activeJob ? { id: activeJob.id, status: activeJob.status, attempts: activeJob.attempts, lastError: activeJob.lastError?.slice(0, 80) } : "none");

  // ── Step 1+2+4: Payment + RefundJob + PaymentEvent (단일 Tx) ────────
  console.log("\n[RECONCILE] Payment.status → CANCELED, RefundJob → SUCCEEDED, PaymentEvent append");
  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: paidPayment.id },
      data: { status: "CANCELED", canceledAt: new Date() },
    });

    if (activeJob) {
      await tx.refundJob.update({
        where: { id: activeJob.id },
        data: {
          status: "SUCCEEDED",
          lastError:
            "manual reconciliation: dev synthetic key — PG cancel impossible, marked succeeded by admin",
        },
      });
    }

    await tx.paymentEvent.create({
      data: {
        providerEventId: `reconcile:${paidPayment.id}:${Date.now()}`,
        bookingId,
        paymentId: paidPayment.id,
        type: "REFUND_REQUEST",
        payload: {
          bookingId,
          reason: "admin reconciliation — stale dev_mock key",
          actor: "admin:dev-reconcile",
        },
        result: "PROCESSED",
      },
    });
  });

  // ── Step 3: booking 전이 (좌석 환원 + BookingEvent는 transitionStatus가 자동 처리) ─
  console.log("[RECONCILE] booking.transitionStatus → CANCELED_BY_USER");
  const { transitionStatus } = await import(
    "../../src/entities/booking/api/mutations.ts" as string
  );
  await transitionStatus({
    bookingId,
    to: "CANCELED_BY_USER",
    actor: "admin:dev-reconcile",
    reason: "manual reconciliation of stale dev_mock payment",
  });

  // ── after snapshot ────────────────────────────────────────────────
  const after = await db.booking.findUnique({
    where: { id: bookingId },
    include: { payments: true, events: { orderBy: { createdAt: "asc" } } },
  });
  console.log("\n=== AFTER ===");
  console.log("booking.status :", after?.status, after?.canceledAt ? `(canceledAt=${after.canceledAt.toISOString()})` : "");
  console.log("payments       :", after?.payments.map((p) => ({ id: p.id.slice(-8), status: p.status })));
  console.log("events tail    :", after?.events.slice(-2).map((e) => ({ from: e.fromState, to: e.toState, actor: e.actor })));

  await db.$disconnect();
}

main().catch((err) => {
  console.error("[refund_reconcile] error:", err);
  process.exit(1);
});
