/**
 * Phase 4-B Task 7 종합 QA — 출발 취소 fan-out + 부분 실패 복구 런타임 증거.
 *
 * 핵심: 의도적 결함 주입(Fault Injection) → PARTIALLY_FAILED → 재시도 → COMPLETED 수렴.
 *
 * ⚠️ PG mock(localhost:4242) 미가동 환경이라, worker의 실제 short-circuit 분기로 결정적 재현:
 *   - SC2 (tossPaymentKey 부재 → FAILED): 결함 주입 = 환불 데이터 이상
 *   - SC1 (Payment 이미 CANCELED → SUCCEEDED): 복구 = 환불 완료 반영(외부 reconcile/실 PG 성공과 동치)
 * 두 경로 모두 retryRefundJob(실제 워커)의 설계된 분기 — 워커를 mock하지 않는다.
 *
 * 실행: npx tsx scripts/qa/4b-cascade-qa.ts
 */

import { PrismaClient } from "@prisma/client";
import { createDeparture } from "@/entities/departure";
import { reserveSeats, InsufficientCapacityError } from "@/entities/booking";
import { retryRefundJob } from "@/entities/payment";
import { recomputeBatchStatus } from "@/entities/departure-cancellation";
import {
  startDepartureCancellation,
  DepartureNotCancelableError,
} from "@/features/admin-departure-cancel";

const db = new PrismaClient();

const SEPARATOR = "═".repeat(62);
const PASS = "\x1b[32m✅ PASS\x1b[0m";
const FAIL = "\x1b[31m❌ FAIL\x1b[0m";
let totalPass = 0;
let totalFail = 0;

function section(t: string) {
  console.log(`\n${SEPARATOR}\n  ${t}\n${SEPARATOR}`);
}
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ${PASS}  ${msg}`);
    totalPass++;
  } else {
    console.error(`  ${FAIL}  ${msg}`);
    totalFail++;
    process.exitCode = 1;
  }
}
async function assertThrows(
  fn: () => Promise<unknown>,
  ErrCls: new (...a: never[]) => Error,
  msg: string,
) {
  try {
    await fn();
    assert(false, `${msg} — 예외 미발생`);
  } catch (e) {
    assert(e instanceof ErrCls, `${msg}${e instanceof ErrCls ? "" : ` — 다른 예외(${(e as Error).name})`}`);
  }
}

async function main() {
  const product = await db.product.findFirst({ select: { id: true } });
  const user = await db.user.findFirst({ select: { id: true } });
  if (!product || !user) throw new Error("seed 필요 (product/user 부재)");

  const ts = Date.now();
  let depId = "";
  const bookingIds: string[] = [];
  let batchId = "";

  try {
    // ── 픽스처: dep + PAID 2건(A,B) + 미결제 1건(C) ───────────────
    section("Setup: 출발일 + PAID 2 + 미결제 1 예약");
    depId = await createDeparture(product.id, {
      departureDate: new Date("2027-11-01"),
      returnDate: new Date("2027-11-05"),
      priceAdult: 1_000_000,
      priceChild: 700_000,
      priceInfant: 0,
      capacity: 10,
      minPax: 2,
    });
    await reserveSeats(db, depId, 3); // A,B,C 각 1석

    async function mkBooking(status: "PAID" | "DEPARTURE_CONFIRMED") {
      const b = await db.booking.create({
        data: { userId: user!.id, departureId: depId, adultCount: 1, totalPrice: 1_000_000, status },
        select: { id: true },
      });
      bookingIds.push(b.id);
      return b.id;
    }
    const aId = await mkBooking("PAID");
    const bId = await mkBooking("PAID");
    const cId = await mkBooking("DEPARTURE_CONFIRMED");

    async function mkPayment(bookingId: string, key: string) {
      await db.payment.create({
        data: {
          bookingId,
          method: "CARD",
          amount: 1_000_000,
          status: "PAID",
          tossOrderId: `qa4b-${ts}-${key}`,
          tossPaymentKey: `qa4b-tk-${ts}-${key}`,
          paidAt: new Date(),
        },
      });
    }
    await mkPayment(aId, "A");
    await mkPayment(bId, "B");
    console.log(`  fixtures: dep=${depId.slice(-6)} A=${aId.slice(-6)}(PAID) B=${bId.slice(-6)}(PAID) C=${cId.slice(-6)}(미결제)`);
    assert(true, "픽스처 생성 완료");

    // ── S1: 강제 취소 fan-out ─────────────────────────────────────
    section("S1: startDepartureCancellation → 즉시 CANCELED + 배치 PROCESSING + fan-out");
    const res = await startDepartureCancellation({ departureId: depId, actor: "admin:qa", reason: "QA 강제취소" });
    batchId = res.batchId;
    const depAfter = await db.departure.findUnique({ where: { id: depId }, select: { status: true } });
    const batch1 = await db.departureCancellation.findUniqueOrThrow({ where: { id: batchId } });
    const cBooking = await db.booking.findUniqueOrThrow({ where: { id: cId }, select: { status: true } });
    const jobs = await db.refundJob.findMany({ where: { cancellationBatchId: batchId }, select: { id: true, bookingId: true, status: true } });
    console.log(`  [DB raw] dep.status=${depAfter?.status} batch.status=${batch1.status} total=${batch1.totalBookings} immediate=${batch1.immediateCancels} jobs=${jobs.length} C.status=${cBooking.status}`);
    assert(depAfter?.status === "CANCELED", "departure 즉시 CANCELED (force, bookedSeats>0였음)");
    assert(batch1.status === "PROCESSING", "배치 PROCESSING");
    assert(batch1.totalBookings === 3, "totalBookings = 3");
    assert(batch1.immediateCancels === 1, "immediateCancels = 1 (미결제 C 즉시)");
    assert(jobs.length === 2, "RefundJob 2건 enqueue (PAID A,B, batchId 연결)");
    assert(cBooking.status === "CANCELED_BY_AGENCY", "미결제 C → CANCELED_BY_AGENCY 즉시");

    const jobA = jobs.find((j) => j.bookingId === aId)!;
    const jobB = jobs.find((j) => j.bookingId === bId)!;

    // ── S2: 결함 주입 → 부분 실패 ─────────────────────────────────
    section("S2: 결함 주입(B의 tossPaymentKey 훼손) → drain → 부분 실패");
    // A: Payment CANCELED (환불 완료 반영) → worker SC1 → SUCCEEDED
    await db.payment.updateMany({ where: { bookingId: aId }, data: { status: "CANCELED", canceledAt: new Date() } });
    // B: tossPaymentKey 훼손 → worker SC2 → FAILED
    await db.payment.updateMany({ where: { bookingId: bId }, data: { tossPaymentKey: null } });

    const rA = await retryRefundJob(jobA.id);
    const rB = await retryRefundJob(jobB.id);
    const jobsAfter = await db.refundJob.findMany({ where: { cancellationBatchId: batchId }, select: { bookingId: true, status: true, lastError: true } });
    const batch2Status = await recomputeBatchStatus(batchId);
    const jA = jobsAfter.find((j) => j.bookingId === aId)!;
    const jB = jobsAfter.find((j) => j.bookingId === bId)!;
    console.log(`  [DB raw] jobA=${jA.status}(${rA.type}) jobB=${jB.status}(${rB.type}) lastError(B)="${jB.lastError}" → batch=${batch2Status}`);
    assert(jA.status === "SUCCEEDED", "jobA SUCCEEDED (Payment CANCELED → SC1)");
    assert(jB.status === "FAILED", "jobB FAILED (tossPaymentKey 부재 → SC2, 결함 주입)");
    assert(batch2Status === "PARTIALLY_FAILED", "★ 부분 실패 가시성: 배치 PARTIALLY_FAILED");

    // ── S3: 자가 치유 — 결함 제거 + 재시도 → COMPLETED ────────────
    section("S3: 결함 제거 + retry → cron 재drain → COMPLETED 수렴");
    // 결함 제거: B의 환불이 해소됨(Payment CANCELED 반영, 실 PG 환경에선 key 복구 후 cancel 성공과 동치)
    await db.payment.updateMany({ where: { bookingId: bId }, data: { status: "CANCELED", tossPaymentKey: `qa4b-tk-${ts}-B`, canceledAt: new Date() } });
    // 재시도 코어(retryBatchRefundAction의 DB ops): FAILED → PENDING(nextRunAt=now)
    await db.refundJob.updateMany({ where: { cancellationBatchId: batchId, status: "FAILED" }, data: { status: "PENDING", nextRunAt: new Date() } });
    const batchAfterRetry = await recomputeBatchStatus(batchId);
    console.log(`  [DB raw] 재시도 직후 batch=${batchAfterRetry} (jobB PENDING 복귀)`);
    assert(batchAfterRetry === "PROCESSING", "재시도 직후 배치 PROCESSING 복귀");
    // cron 재drain (worker 재실행)
    const rB2 = await retryRefundJob(jobB.id);
    const finalStatus = await recomputeBatchStatus(batchId);
    const jBfinal = await db.refundJob.findFirstOrThrow({ where: { cancellationBatchId: batchId, bookingId: bId }, select: { status: true } });
    console.log(`  [DB raw] 재drain jobB=${jBfinal.status}(${rB2.type}) → batch=${finalStatus}`);
    assert(jBfinal.status === "SUCCEEDED", "jobB 재시도 → SUCCEEDED (SC1)");
    assert(finalStatus === "COMPLETED", "★ 자가 치유: 배치 COMPLETED 수렴");

    // ── S4: 멱등 ──────────────────────────────────────────────────
    section("S4: 멱등 — 이미 CANCELED 출발 재취소 시도");
    await assertThrows(
      () => startDepartureCancellation({ departureId: depId, actor: "admin:qa" }),
      DepartureNotCancelableError,
      "이미 CANCELED → DepartureNotCancelableError (신규 배치 미생성)",
    );
    const batchCount = await db.departureCancellation.count({ where: { departureId: depId } });
    assert(batchCount === 1, "배치는 여전히 1개 (더블클릭 방어)");

    // ── S5: 신규 예약 차단 ────────────────────────────────────────
    section("S5: CANCELED 출발 → 신규 예약 차단");
    await assertThrows(
      () => reserveSeats(db, depId, 1),
      InsufficientCapacityError,
      "CANCELED 출발 → reserveSeats 차단",
    );
  } finally {
    // 정리 (FK 순서: RefundJob → batch → Payment → Booking(events cascade) → Departure)
    if (batchId) await db.refundJob.deleteMany({ where: { cancellationBatchId: batchId } }).catch(() => {});
    if (batchId) await db.departureCancellation.delete({ where: { id: batchId } }).catch(() => {});
    if (bookingIds.length) await db.payment.deleteMany({ where: { bookingId: { in: bookingIds } } }).catch(() => {});
    if (bookingIds.length) await db.booking.deleteMany({ where: { id: { in: bookingIds } } }).catch(() => {});
    if (depId) await db.departure.delete({ where: { id: depId } }).catch(() => {});
    console.log("\n  정리 완료 — QA 픽스처 삭제");
  }

  section(`결과: ${totalPass} PASS / ${totalFail} FAIL`);
  await db.$disconnect();
  if (totalFail > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
