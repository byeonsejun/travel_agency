/**
 * payment-evidence.ts — M-PAYMENT 종합 시나리오 수집기 (qa-engineer R1·R3·R5)
 *
 * 사용법:
 *   npx tsx scripts/qa/payment-evidence.ts <scenario>
 *
 * 시나리오 목록:
 *   setup                        테스트용 booking(DEPARTURE_CONFIRMED) 생성
 *   teardown                     이 스크립트가 생성한 데이터 정리
 *   confirm-success              정상 결제 흐름 (mock DONE)
 *   confirm-amount-mismatch      PG 금액 위조 → compensateCancel (mock amount-tamper 필요)
 *   confirm-double-call-idempotent 동일 paymentKey 2회 → 두 번째 no-op
 *   confirm-pg-network-error     네트워크 타임아웃 → Payment FAILED (mock network-error 필요)
 *   webhook-idempotency          동일 transmissionId × 2회 → PaymentEvent 1건 유지
 *   webhook-bad-signature        위조 paymentKey → cross-check 실패 → InvalidSignatureError (ADR-0016)
 *   webhook-unknown-order        알 수 없는 orderId → IGNORED
 *   webhook-signed-end-to-end    실제 paymentKey cross-check 통과 → 200 + 상태 갱신
 *   refund-success               정상 환불 (mock success 필요)
 *   refund-pg-failure-enqueues-job PG cancel 실패 → RefundJob PENDING (mock fail 필요)
 *
 * 전제: mock-toss-server.ts가 TOSS_API_BASE_URL(기본 localhost:4242) 포트에서 실행 중이어야 함.
 * 출력: JSON.stringify 정형화 → jq로 파싱 가능.
 *
 * 주의 (ADR-0016): webhook 검증이 결제 조회 API cross-check 로 전환됨.
 *   mock-toss-server.ts 의 `GET /v1/payments/{paymentKey}` 응답이 시나리오와 일치해야
 *   `webhook-signed-end-to-end` / `webhook-unknown-order` / `webhook-idempotency` 가 통과.
 *   `webhook-bad-signature` 는 mock 이 모르는 paymentKey 에 404 를 반환해야 통과.
 */

import { db } from "../../src/shared/lib/db";
import { env } from "../../src/shared/lib/env";
import {
  confirmPayment,
  handleTossWebhook,
  refundBooking,
  buildOrderId,
  PaymentError,
  InvalidSignatureError,
} from "../../src/entities/payment";
import {
  createBooking,
  transitionStatus,
} from "../../src/entities/booking";

// ── 공통 태그 — 이 스크립트가 생성한 데이터 식별용 ────────────────────────
const EVIDENCE_TAG = "payment-evidence-script";
const EVIDENCE_TRAVELER = {
  lastNameEn: "EVIDENCE",
  firstNameEn: "TEST",
  gender: "MALE" as const,
  birthDate: new Date("1990-01-01"),
  role: "TRAVELER" as const,
};

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

function log(label: string, data: unknown) {
  console.log(JSON.stringify({ label, data }, null, 2));
}

/** 시드 데이터에서 CUSTOMER + 여유 있는 departure 조회 */
async function getSeedRefs() {
  const user = await db.user.findFirst({ where: { role: "CUSTOMER" } });
  const departure = await db.departure.findFirst({
    where: {
      status: { in: ["SCHEDULED", "CONFIRMED"] },
      capacity: { gt: 2 },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!user || !departure) throw new Error("시드 데이터 없음 — prisma db seed 먼저 실행");
  return { user, departure };
}

/** DEPARTURE_CONFIRMED 상태의 신규 booking 생성 */
async function freshDepartureConfirmedBooking() {
  const { user, departure } = await getSeedRefs();
  const expectedTotal = departure.priceAdult;

  const booking = await createBooking({
    departureId: departure.id,
    userId: user.id,
    adultCount: 1,
    childCount: 0,
    infantCount: 0,
    expectedTotalPrice: expectedTotal,
    travelers: [EVIDENCE_TRAVELER],
    termKeys: ["standard_overseas_v1"],
  });

  await transitionStatus({
    bookingId: booking.id,
    to: "DEPARTURE_CONFIRMED",
    actor: `system:${EVIDENCE_TAG}`,
    reason: "evidence setup",
  });

  return { userId: user.id, bookingId: booking.id, amount: booking.totalPrice };
}

/**
 * webhook signature placeholder (ADR-0016).
 *
 * cross-check 도입 이후 signature 인자는 더 이상 검증되지 않으므로 placeholder.
 * 실제 검증은 tossClient.getPayment 응답이 webhook payload 와 일치하는지로 결정된다.
 */
const WEBHOOK_SIGNATURE_PLACEHOLDER = "qa-evidence-no-signature-needed";

/** DB 스냅샷: booking + payment + paymentEvents + refundJobs */
async function snapshot(bookingId: string) {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, status: true, totalPrice: true },
  });
  const payments = await db.payment.findMany({
    where: { bookingId },
    select: { id: true, status: true, amount: true, tossOrderId: true, tossPaymentKey: true },
  });
  const events = await db.paymentEvent.findMany({
    where: { bookingId },
    select: { id: true, type: true, result: true, providerEventId: true },
    orderBy: { createdAt: "asc" },
  });
  const jobs = await db.refundJob.findMany({
    where: { bookingId },
    select: { id: true, status: true, amount: true, nextRunAt: true, attempts: true },
  });
  return { booking, payments, events, jobs };
}

// ── 시나리오 ───────────────────────────────────────────────────────────────────

/** setup: 테스트용 DEPARTURE_CONFIRMED booking 생성 후 ID 출력 */
async function scenarioSetup() {
  const { userId, bookingId, amount } = await freshDepartureConfirmedBooking();
  log("setup.result", { userId, bookingId, amount, status: "DEPARTURE_CONFIRMED" });
  const snap = await snapshot(bookingId);
  log("setup.snapshot", snap);
}

/** teardown: 이 스크립트가 생성한 booking + 연관 레코드 삭제 */
async function scenarioTeardown() {
  const events = await db.bookingEvent.findMany({
    where: { actor: { startsWith: `system:${EVIDENCE_TAG}` } },
    select: { bookingId: true },
  });
  const bookingIds = [...new Set(events.map((e) => e.bookingId))];

  log("teardown.target", { bookingIds, count: bookingIds.length });

  for (const bid of bookingIds) {
    // 연관 레코드 순서대로 삭제 (FK 제약 존중)
    await db.refundJob.deleteMany({ where: { bookingId: bid } });
    await db.paymentEvent.deleteMany({ where: { bookingId: bid } });
    await db.payment.deleteMany({ where: { bookingId: bid } });
    await db.traveler.deleteMany({ where: { bookingId: bid } });
    await db.bookingEvent.deleteMany({ where: { bookingId: bid } });
    await db.booking.delete({ where: { id: bid } });
  }

  const remaining = await db.booking.count({ where: { id: { in: bookingIds } } });
  log("teardown.result", { deleted: bookingIds.length, remaining });
}

/** confirm-success: 정상 결제 승인 흐름 */
async function scenarioConfirmSuccess() {
  const { userId, bookingId, amount } = await freshDepartureConfirmedBooking();
  const orderId = buildOrderId(bookingId, 1);
  const paymentKey = `ev_pk_${Date.now()}`;

  log("confirm-success.before", await snapshot(bookingId));

  const result = await confirmPayment({ userId, paymentKey, orderId, amount });

  log("confirm-success.result", result);
  log("confirm-success.after", await snapshot(bookingId));
}

/** confirm-amount-mismatch: PG 금액 위조 → compensateCancel 트리거
 *  mock-toss-server.ts를 MOCK_TOSS_SCENARIO=amount-tamper로 실행해야 함 */
async function scenarioConfirmAmountMismatch() {
  const { userId, bookingId, amount } = await freshDepartureConfirmedBooking();
  const orderId = buildOrderId(bookingId, 1);
  const paymentKey = `ev_tamper_${Date.now()}`;

  log("confirm-amount-mismatch.before", await snapshot(bookingId));

  try {
    await confirmPayment({ userId, paymentKey, orderId, amount });
    log("confirm-amount-mismatch.result", { UNEXPECTED: "success — mock should tamper amount" });
  } catch (err) {
    log("confirm-amount-mismatch.error", {
      name: err instanceof Error ? err.name : "unknown",
      code: err instanceof PaymentError ? err.code : null,
    });
  }

  log("confirm-amount-mismatch.after", await snapshot(bookingId));
}

/** confirm-double-call-idempotent: 동일 paymentKey 2회 호출 → 두 번째 멱등 반환 */
async function scenarioConfirmDoubleCallIdempotent() {
  const { userId, bookingId, amount } = await freshDepartureConfirmedBooking();
  const orderId = buildOrderId(bookingId, 1);
  const paymentKey = `ev_idem_${Date.now()}`;

  const first = await confirmPayment({ userId, paymentKey, orderId, amount });
  log("confirm-double-call-idempotent.first", first);

  const eventCountAfterFirst = await db.paymentEvent.count({ where: { bookingId } });

  const second = await confirmPayment({ userId, paymentKey, orderId, amount });
  log("confirm-double-call-idempotent.second", second);

  const eventCountAfterSecond = await db.paymentEvent.count({ where: { bookingId } });

  log("confirm-double-call-idempotent.idempotency", {
    eventCountAfterFirst,
    eventCountAfterSecond,
    pass: eventCountAfterSecond === eventCountAfterFirst,
  });
}

/** confirm-pg-network-error: 네트워크 타임아웃 → Payment FAILED
 *  mock-toss-server.ts를 MOCK_TOSS_SCENARIO=network-error로 실행해야 함 */
async function scenarioConfirmPgNetworkError() {
  const { userId, bookingId, amount } = await freshDepartureConfirmedBooking();
  const orderId = buildOrderId(bookingId, 1);
  const paymentKey = `ev_timeout_${Date.now()}`;

  log("confirm-pg-network-error.before", await snapshot(bookingId));

  try {
    await confirmPayment({ userId, paymentKey, orderId, amount });
    log("confirm-pg-network-error.result", { UNEXPECTED: "success" });
  } catch (err) {
    log("confirm-pg-network-error.error", {
      code: err instanceof PaymentError ? err.code : String(err),
    });
  }

  log("confirm-pg-network-error.after", await snapshot(bookingId));
}

/** webhook-idempotency: 동일 eventId 웹훅 2회 → PaymentEvent 1건 유지 */
async function scenarioWebhookIdempotency() {
  const { bookingId } = await freshDepartureConfirmedBooking();
  // Payment 없이 웹훅만 전송하면 orderId 불인식 → IGNORED로 처리
  // v2 페이로드 + 동일 transmissionId 로 2회 전송하여 멱등 처리 검증
  const transmissionId = `whtrans_qa_idem_${Date.now()}`;
  const payload = JSON.stringify({
    eventType: "PAYMENT_STATUS_CHANGED",
    createdAt: new Date().toISOString(),
    data: {
      paymentKey: `qa_pk_${Date.now()}`,
      orderId: `unknown_order_${Date.now()}`,
      status: "DONE",
      totalAmount: 10000,
    },
  });
  const signature = WEBHOOK_SIGNATURE_PLACEHOLDER;

  const countBefore = await db.paymentEvent.count();

  await handleTossWebhook({ rawBody: payload, signature, transmissionId });
  const countAfterFirst = await db.paymentEvent.count();

  await handleTossWebhook({ rawBody: payload, signature, transmissionId });
  const countAfterSecond = await db.paymentEvent.count();

  log("webhook-idempotency.result", {
    countBefore,
    countAfterFirst,
    countAfterSecond,
    newEventsOnSecondCall: countAfterSecond - countAfterFirst,
    pass: countAfterSecond - countAfterFirst === 0,
  });

  // cleanup test booking (not related to webhook test)
  void db.paymentEvent.deleteMany({ where: { bookingId } });
  void db.bookingEvent.deleteMany({ where: { bookingId } });
  void db.traveler.deleteMany({ where: { bookingId } });
  void db.booking.delete({ where: { id: bookingId } }).catch(() => null);
}

/** webhook-bad-signature: 위조 서명 → InvalidSignatureError */
async function scenarioWebhookBadSignature() {
  const payload = JSON.stringify({
    eventType: "PAYMENT_STATUS_CHANGED",
    createdAt: new Date().toISOString(),
    data: {
      paymentKey: `qa_pk_bad_${Date.now()}`,
      orderId: "any_order",
      status: "DONE",
      totalAmount: 10000,
    },
  });

  try {
    await handleTossWebhook({
      rawBody: payload,
      signature: "forged_signature",
      transmissionId: `whtrans_qa_bad_${Date.now()}`,
    });
    log("webhook-bad-signature.result", { UNEXPECTED: "no error thrown" });
  } catch (err) {
    log("webhook-bad-signature.result", {
      errorName: err instanceof Error ? err.name : "unknown",
      pass: err instanceof InvalidSignatureError,
    });
  }
}

/** webhook-unknown-order: 알 수 없는 orderId → PaymentEvent IGNORED */
async function scenarioWebhookUnknownOrder() {
  const transmissionId = `whtrans_qa_unknown_${Date.now()}`;
  const payload = JSON.stringify({
    eventType: "PAYMENT_STATUS_CHANGED",
    createdAt: new Date().toISOString(),
    data: {
      paymentKey: `qa_pk_unknown_${Date.now()}`,
      orderId: `nonexistent_order_${Date.now()}`,
      status: "DONE",
      totalAmount: 10000,
    },
  });
  const signature = WEBHOOK_SIGNATURE_PLACEHOLDER;

  const countBefore = await db.paymentEvent.count({ where: { result: "IGNORED" } });
  await handleTossWebhook({ rawBody: payload, signature, transmissionId });
  const countAfter = await db.paymentEvent.count({ where: { result: "IGNORED" } });

  log("webhook-unknown-order.result", {
    ignoredEventsBefore: countBefore,
    ignoredEventsAfter: countAfter,
    newIgnoredEvent: countAfter - countBefore === 1,
    pass: countAfter > countBefore,
  });
}

/** webhook-signed-end-to-end: 올바른 HMAC 서명 PAYMENT_DONE → booking PAID */
async function scenarioWebhookSignedEndToEnd() {
  const { userId, bookingId, amount } = await freshDepartureConfirmedBooking();
  const orderId = buildOrderId(bookingId, 1);
  const paymentKey = `ev_webhook_e2e_${Date.now()}`;

  // Payment row 생성 (PENDING) — 웹훅이 도착하기 전 DB에 row가 있어야 상태 갱신 가능
  await db.payment.create({
    data: {
      bookingId,
      tossOrderId: orderId,
      amount,
      method: "CARD",
      status: "PENDING",
    },
  });

  log("webhook-signed-end-to-end.before", await snapshot(bookingId));

  const transmissionId = `whtrans_qa_e2e_${Date.now()}`;
  const payload = JSON.stringify({
    eventType: "PAYMENT_STATUS_CHANGED",
    createdAt: new Date().toISOString(),
    data: {
      paymentKey,
      orderId,
      status: "DONE",
      totalAmount: amount,
      approvedAt: new Date().toISOString(),
    },
  });
  const signature = WEBHOOK_SIGNATURE_PLACEHOLDER;

  await handleTossWebhook({ rawBody: payload, signature, transmissionId });

  log("webhook-signed-end-to-end.after", await snapshot(bookingId));

  const finalBooking = await db.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { status: true },
  });
  log("webhook-signed-end-to-end.result", {
    bookingStatus: finalBooking.status,
    pass: finalBooking.status === "PAID",
  });

  void userId; // userId is available but booking owns the state
}

/** refund-success: 정상 환불 → booking CANCELED_BY_USER, departure.bookedSeats 감소
 *  mock-toss-server.ts를 MOCK_TOSS_SCENARIO=success로 실행해야 함 */
async function scenarioRefundSuccess() {
  const { userId, bookingId, amount } = await freshDepartureConfirmedBooking();
  const orderId = buildOrderId(bookingId, 1);
  const paymentKey = `ev_refund_ok_${Date.now()}`;

  // 결제 완료 상태로 만들기
  await confirmPayment({ userId, paymentKey, orderId, amount });

  const depBefore = await db.departure.findFirst({
    where: { bookings: { some: { id: bookingId } } },
    select: { id: true, bookedSeats: true },
  });

  log("refund-success.before", { ...(await snapshot(bookingId)), bookedSeats: depBefore?.bookedSeats });

  await refundBooking({ bookingId, actor: `user:${userId}`, reason: "evidence test refund" });

  const depAfter = await db.departure.findUnique({
    where: { id: depBefore?.id ?? "" },
    select: { bookedSeats: true },
  });

  log("refund-success.after", { ...(await snapshot(bookingId)), bookedSeatsAfter: depAfter?.bookedSeats });
  log("refund-success.result", {
    seatReleased: depBefore && depAfter ? depAfter.bookedSeats < depBefore.bookedSeats : "N/A",
  });
}

/** refund-pg-failure-enqueues-job: PG cancel 실패 → RefundJob PENDING, booking PAID 유지
 *  mock-toss-server.ts를 MOCK_TOSS_SCENARIO=fail로 실행해야 함 */
async function scenarioRefundPgFailureEnqueuesJob() {
  const { userId, bookingId, amount } = await freshDepartureConfirmedBooking();
  const orderId = buildOrderId(bookingId, 1);

  // 결제 승인은 success 시나리오 mock으로 완료 (confirm 단계)
  // 환불 실패를 테스트하므로: Payment를 직접 PAID로 세팅
  await db.payment.create({
    data: {
      bookingId,
      tossOrderId: orderId,
      tossPaymentKey: `ev_refund_fail_pk_${Date.now()}`,
      amount,
      method: "CARD",
      status: "PAID",
      paidAt: new Date(),
    },
  });
  await transitionStatus({
    bookingId,
    to: "PAID",
    actor: `system:${EVIDENCE_TAG}:direct`,
    reason: "evidence setup for refund failure",
  });

  log("refund-pg-failure-enqueues-job.before", await snapshot(bookingId));

  try {
    // mock 서버가 cancel에 400을 반환하면 RefundJob이 enqueue됨
    await refundBooking({ bookingId, actor: `user:${userId}`, reason: "evidence fail test" });
    log("refund-pg-failure-enqueues-job.result", {
      UNEXPECTED: "refund succeeded — mock should be in fail mode",
    });
  } catch (err) {
    log("refund-pg-failure-enqueues-job.error", {
      code: err instanceof PaymentError ? err.code : String(err),
    });
  }

  const snap = await snapshot(bookingId);
  log("refund-pg-failure-enqueues-job.after", snap);
  log("refund-pg-failure-enqueues-job.result", {
    bookingStillPaid: snap.booking?.status === "PAID",
    refundJobPending: snap.jobs.some((j) => j.status === "PENDING"),
    pass:
      snap.booking?.status === "PAID" && snap.jobs.some((j) => j.status === "PENDING"),
  });
}

// ── 진입점 ──────────────────────────────────────────────────────────────────────

const SCENARIOS: Record<string, () => Promise<void>> = {
  setup: scenarioSetup,
  teardown: scenarioTeardown,
  "confirm-success": scenarioConfirmSuccess,
  "confirm-amount-mismatch": scenarioConfirmAmountMismatch,
  "confirm-double-call-idempotent": scenarioConfirmDoubleCallIdempotent,
  "confirm-pg-network-error": scenarioConfirmPgNetworkError,
  "webhook-idempotency": scenarioWebhookIdempotency,
  "webhook-bad-signature": scenarioWebhookBadSignature,
  "webhook-unknown-order": scenarioWebhookUnknownOrder,
  "webhook-signed-end-to-end": scenarioWebhookSignedEndToEnd,
  "refund-success": scenarioRefundSuccess,
  "refund-pg-failure-enqueues-job": scenarioRefundPgFailureEnqueuesJob,
};

async function main() {
  const scenario = process.argv[2];
  if (!scenario || !(scenario in SCENARIOS)) {
    console.error(`사용법: npx tsx scripts/qa/payment-evidence.ts <scenario>`);
    console.error(`가능한 시나리오: ${Object.keys(SCENARIOS).join(", ")}`);
    process.exit(1);
  }

  console.log(JSON.stringify({ scenario, startedAt: new Date().toISOString() }));

  try {
    await SCENARIOS[scenario]();
    console.log(JSON.stringify({ scenario, status: "PASS", finishedAt: new Date().toISOString() }));
  } catch (err) {
    console.error(JSON.stringify({ scenario, status: "FAIL", error: String(err) }));
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

main();
