import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    emailJob: {
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  getBookingConfirmationEmailData: vi.fn(),
  getRefundCompletedEmailData: vi.fn(),
  renderEmail: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
vi.mock("@/entities/booking", () => ({
  getBookingConfirmationEmailData: mocks.getBookingConfirmationEmailData,
}));
vi.mock("@/entities/payment", () => ({
  getRefundCompletedEmailData: mocks.getRefundCompletedEmailData,
}));
vi.mock("@/shared/email", () => ({
  renderEmail: mocks.renderEmail,
  sendEmail: mocks.sendEmail,
}));
vi.mock("@/shared/lib/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  metrics: { incr: vi.fn() },
  captureException: vi.fn(),
}));

import { processEmailJobBatch } from "../worker";

// $transaction(cb) 형태 — cb를 tx로 즉시 실행. updateMany claim 성공=count 1.
function wireClaimSuccess() {
  mocks.db.$transaction.mockImplementation(
    async (cb: (tx: unknown) => unknown) =>
      cb({ emailJob: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }),
  );
}

describe("processEmailJobBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wireClaimSuccess();
  });

  it("BOOKING_CONFIRMATION job: hydrate→render→send→SUCCEEDED", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([{ id: "clej1" }]);
    mocks.db.emailJob.findUniqueOrThrow.mockResolvedValue({
      id: "clej1",
      type: "BOOKING_CONFIRMATION",
      dedupeKey: "booking-confirmation:clbk1",
      bookingId: "clbk1",
      attempts: 0,
    });
    mocks.getBookingConfirmationEmailData.mockResolvedValue({
      recipientEmail: "go@nextour.test",
      props: { productTitle: "오사카" },
    });
    mocks.renderEmail.mockResolvedValue({ subject: "s", html: "<p>h</p>", text: "h" });
    mocks.sendEmail.mockResolvedValue({ id: "resend_123" });

    const res = await processEmailJobBatch({ limit: 5 });

    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "go@nextour.test",
        idempotencyKey: "booking-confirmation:clbk1",
      }),
    );
    expect(mocks.db.emailJob.update).toHaveBeenCalledWith({
      where: { id: "clej1" },
      data: { status: "SUCCEEDED", sentTo: "go@nextour.test", providerId: "resend_123" },
    });
    expect(res).toMatchObject({ processed: 1, succeeded: 1 });
  });

  it("hydration null → 영구 FAILED (재시도 무의미)", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([{ id: "clej2" }]);
    mocks.db.emailJob.findUniqueOrThrow.mockResolvedValue({
      id: "clej2",
      type: "REFUND_COMPLETED",
      dedupeKey: "refund-completed:clbk2",
      bookingId: "clbk2",
      attempts: 0,
    });
    mocks.getRefundCompletedEmailData.mockResolvedValue(null);

    const res = await processEmailJobBatch({ limit: 5 });

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.db.emailJob.update).toHaveBeenCalledWith({
      where: { id: "clej2" },
      data: { status: "FAILED", lastError: "hydration data not found" },
    });
    expect(res).toMatchObject({ processed: 1, failed: 1 });
  });

  it("send 실패 + attempts<MAX → PENDING backoff", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([{ id: "clej3" }]);
    mocks.db.emailJob.findUniqueOrThrow.mockResolvedValue({
      id: "clej3",
      type: "BOOKING_CONFIRMATION",
      dedupeKey: "booking-confirmation:clbk3",
      bookingId: "clbk3",
      attempts: 1,
    });
    mocks.getBookingConfirmationEmailData.mockResolvedValue({
      recipientEmail: "a@b.test",
      props: {},
    });
    mocks.renderEmail.mockResolvedValue({ subject: "s", html: "h", text: "h" });
    mocks.sendEmail.mockRejectedValue(new Error("resend 503"));

    const res = await processEmailJobBatch({ limit: 5 });

    const call = mocks.db.emailJob.update.mock.calls[0][0];
    expect(call.data.status).toBe("PENDING");
    expect(call.data.attempts).toEqual({ increment: 1 });
    expect(call.data.nextRunAt).toBeInstanceOf(Date);
    expect(res).toMatchObject({ processed: 1, failed: 1 });
  });
});
