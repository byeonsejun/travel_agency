import { PrismaClient } from "@prisma/client";

const TARGET = "cmpbzqnde00029n2v4yixsu49"; // PAID + real toss key (tviva...)

async function main() {
  const db = new PrismaClient();

  console.log("=== STEP 1: before snapshot ===");
  const before = await db.booking.findUnique({
    where: { id: TARGET },
    include: { payments: true, events: { orderBy: { createdAt: "asc" } } },
  });
  const refundsBefore = await db.refundJob.findMany({
    where: { bookingId: TARGET },
  });
  console.log("booking.status:", before?.status);
  console.log(
    "payments:",
    before?.payments.map((p) => ({
      id: p.id.slice(-8),
      status: p.status,
      amount: p.amount,
      key: p.tossPaymentKey?.slice(0, 18),
    }))
  );
  console.log(
    "events:",
    before?.events.length,
    "entries (last:",
    before?.events.at(-1)?.toState,
    ")"
  );
  console.log("refundJobs:", refundsBefore.length);

  console.log("\n=== STEP 2: call refundBooking ===");
  // 정적 import는 entry 직후에 평가되므로 동적으로 import하여 env 로드 후 실행.
  const mod = await import("../../src/entities/payment/api/refund.ts" as string);
  try {
    await mod.refundBooking({
      bookingId: TARGET,
      actor: `evidence-script:phase3-refund-test`,
      reason: "evidence-test: Toss sandbox cancel API 검증",
    });
    console.log("→ refundBooking 성공");
  } catch (e) {
    console.log(
      "→ refundBooking error:",
      e instanceof Error ? `${e.name}: ${e.message}` : e
    );
    const code = (e as { code?: string }).code;
    if (code) console.log("  code:", code);
  }

  console.log("\n=== STEP 3: after snapshot ===");
  const after = await db.booking.findUnique({
    where: { id: TARGET },
    include: { payments: true, events: { orderBy: { createdAt: "asc" } } },
  });
  const refundsAfter = await db.refundJob.findMany({
    where: { bookingId: TARGET },
  });
  console.log(
    "booking.status:",
    after?.status,
    after?.canceledAt ? `(canceledAt=${after.canceledAt.toISOString()})` : ""
  );
  console.log(
    "payments:",
    after?.payments.map((p) => ({
      id: p.id.slice(-8),
      status: p.status,
      canceledAt: p.canceledAt?.toISOString(),
    }))
  );
  console.log(
    "events (new):",
    after?.events.slice(before?.events.length ?? 0).map((e) => ({
      from: e.fromState,
      to: e.toState,
      actor: e.actor,
      reason: e.reason,
    }))
  );
  console.log(
    "refundJobs:",
    refundsAfter.map((j) => ({
      status: j.status,
      attempts: j.attempts,
      amount: j.amount,
      lastError: j.lastError?.slice(0, 80),
    }))
  );

  console.log("\n=== STEP 4: PaymentEvent (REFUND_REQUEST) ===");
  const paymentEvents = await db.paymentEvent.findMany({
    where: { bookingId: TARGET, type: "REFUND_REQUEST" },
    orderBy: { createdAt: "desc" },
    take: 2,
  });
  console.log(
    paymentEvents.map((e) => ({
      providerEventId: e.providerEventId,
      result: e.result,
      createdAt: e.createdAt.toISOString(),
    }))
  );

  await db.$disconnect();
}

main().catch((err) => {
  console.error("script error:", err);
  process.exit(1);
});
