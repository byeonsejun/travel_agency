import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  enqueueRefundJob: vi.fn(),
  cancelBookingByAgencyTx: vi.fn(),
  recomputeBatchStatus: vi.fn(),
  tx: {
    departure: { updateMany: vi.fn() },
    booking: { findMany: vi.fn() },
    departureCancellation: { create: vi.fn(), update: vi.fn() },
  },
  db: { $transaction: vi.fn() },
}));

vi.mock("@/features/auth/server/auth", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  updateTag: mocks.updateTag,
}));
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
vi.mock("@/entities/payment", () => ({ enqueueRefundJob: mocks.enqueueRefundJob }));
vi.mock("@/entities/booking", () => ({ cancelBookingByAgencyTx: mocks.cancelBookingByAgencyTx }));
vi.mock("@/entities/departure-cancellation", () => ({
  recomputeBatchStatus: mocks.recomputeBatchStatus,
}));
vi.mock("@/entities/departure", () => ({
  tagDeparturesByProduct: (pid: string) => `product:${pid}:departures`,
}));

import { startDepartureCancellation } from "../actions";
import {
  DepartureNotCancelableError,
  RefundablePaymentMissingError,
} from "../errors";

beforeEach(() => {
  vi.clearAllMocks();
  // db.$transaction(cb) → cb(tx) 실행
  mocks.db.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(mocks.tx));
  mocks.tx.departureCancellation.create.mockResolvedValue({ id: "batch1" });
  mocks.tx.departureCancellation.update.mockResolvedValue({});
});

describe("startDepartureCancellation", () => {
  it("이미 CANCELED(또는 부재) → DepartureNotCancelableError (배치 미생성)", async () => {
    mocks.tx.departure.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      startDepartureCancellation({ departureId: "d1", actor: "admin:a1" }),
    ).rejects.toBeInstanceOf(DepartureNotCancelableError);
    expect(mocks.tx.departureCancellation.create).not.toHaveBeenCalled();
  });

  it("PAID→enqueue / 미결제→인라인 취소 / 카운트 정확 + PROCESSING", async () => {
    mocks.tx.departure.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.booking.findMany.mockResolvedValue([
      { id: "b1", status: "PAID", payments: [{ id: "p1", amount: 100, tossPaymentKey: "tk1" }] },
      { id: "b2", status: "DEPARTURE_CONFIRMED", payments: [] },
    ]);
    mocks.enqueueRefundJob.mockResolvedValue({ enqueued: true });

    const res = await startDepartureCancellation({
      departureId: "d1",
      actor: "admin:a1",
      reason: "운영 취소",
    });

    expect(res.batchId).toBe("batch1");
    expect(res.enqueued).toBe(1);
    expect(res.immediate).toBe(1);
    expect(res.total).toBe(2);
    expect(mocks.enqueueRefundJob).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueRefundJob).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ bookingId: "b1", paymentId: "p1", amount: 100, cancellationBatchId: "batch1" }),
    );
    expect(mocks.cancelBookingByAgencyTx).toHaveBeenCalledTimes(1);
    expect(mocks.cancelBookingByAgencyTx).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ bookingId: "b2", actor: "admin:a1" }),
    );
    expect(mocks.tx.departureCancellation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PROCESSING", immediateCancels: 1 }),
      }),
    );
  });

  it("PAID인데 payment 부재 → RefundablePaymentMissingError (롤백)", async () => {
    mocks.tx.departure.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.booking.findMany.mockResolvedValue([{ id: "b1", status: "PAID", payments: [] }]);
    await expect(
      startDepartureCancellation({ departureId: "d1", actor: "admin:a1" }),
    ).rejects.toBeInstanceOf(RefundablePaymentMissingError);
  });

  it("활성 예약 0건 → 배치 COMPLETED 즉시", async () => {
    mocks.tx.departure.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.booking.findMany.mockResolvedValue([]);
    const res = await startDepartureCancellation({ departureId: "d1", actor: "admin:a1" });
    expect(res.enqueued).toBe(0);
    expect(res.immediate).toBe(0);
    expect(mocks.tx.departureCancellation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }),
    );
  });
});
