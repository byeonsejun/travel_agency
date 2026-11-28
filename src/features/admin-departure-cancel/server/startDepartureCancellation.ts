// 출발 강제 취소 DB 오케스트레이션 (인증 없음 — 호출자가 ADMIN 확인 후 호출).
//
// 이 함수는 일부러 "use server" 파일(actions.ts) 밖에 둔다. "use server" 모듈의 모든 export 는
// Next 가 각자 호출 가능한 Server Action 으로 등록하므로, 여기 있던 시절에는 ADMIN 확인을 하는
// forceCancelDepartureAction 을 거치지 않고 이 함수를 직접 부를 수 있었다.
// (scripts/qa 가 tsx 로 직접 import 하므로 "server-only" 는 두지 않는다.)

import type { BookingStatus } from "@prisma/client";
import { db } from "@/shared/lib/db";
import { enqueueRefundJob } from "@/entities/payment";
import { cancelBookingByAgencyTx } from "@/entities/booking";
import { DepartureNotCancelableError, RefundablePaymentMissingError } from "./errors";

// 좌석 점유(활성) 상태 — booking transitions SEAT_HELD_STATES와 동일 집합.
const SEAT_HELD_STATES: BookingStatus[] = [
  "RECEIVED",
  "AWAITING_GROUP",
  "DEPARTURE_CONFIRMED",
  "PAID",
  "READY",
];
const REFUNDABLE: BookingStatus[] = ["PAID", "READY"];

export interface StartCancellationInput {
  departureId: string;
  actor: string; // "admin:<id>" — 호출자가 인증 후 구성
  reason?: string;
}
export interface StartCancellationResult {
  batchId: string;
  total: number;
  enqueued: number;
  immediate: number;
}

/**
 * 출발 강제 취소 fan-out 오케스트레이션. [ADR-0028]
 *
 * **단일 db.$transaction (외부 IO 0, ADR-0003 원칙)**:
 *   1) force CAS: departure SCHEDULED|CONFIRMED|CLOSED → CANCELED (4-A bookedSeats===0 가드 우회)
 *      count===0 이면 이미 취소/부재 → DepartureNotCancelableError (멱등 — 더블클릭 안전)
 *   2) 활성(좌석점유) 예약 로드
 *   3) 배치(DepartureCancellation, PROCESSING) 생성
 *   4) fan-out: PAID/READY → enqueueRefundJob(PG는 cron) / 미결제 → cancelBookingByAgencyTx(즉시)
 *   5) enqueued===0 이면 COMPLETED, 아니면 PROCESSING 으로 immediateCancels 확정
 *
 * 인증·캐시 무효화·redirect 는 호출자(force-cancel 액션) 책임 — 본 함수는 순수 DB 오케스트레이션.
 */
export async function startDepartureCancellation(
  input: StartCancellationInput,
): Promise<StartCancellationResult> {
  const { departureId, actor, reason } = input;

  return db.$transaction(async (tx) => {
    // 1. force CAS
    const cas = await tx.departure.updateMany({
      where: { id: departureId, status: { in: ["SCHEDULED", "CONFIRMED", "CLOSED"] } },
      data: { status: "CANCELED", version: { increment: 1 } },
    });
    if (cas.count === 0) throw new DepartureNotCancelableError(departureId);

    // 2. 활성 예약 + PAID payment 로드
    const bookings = await tx.booking.findMany({
      where: { departureId, status: { in: SEAT_HELD_STATES } },
      select: {
        id: true,
        status: true,
        payments: {
          where: { status: "PAID" },
          select: { id: true, amount: true, tossPaymentKey: true },
          take: 1,
        },
      },
    });

    // 3. 배치 생성
    const batch = await tx.departureCancellation.create({
      data: {
        departureId,
        actor,
        reason: reason ?? null,
        totalBookings: bookings.length,
        status: "PROCESSING",
      },
      select: { id: true },
    });

    // 4. fan-out — status 기준 분기 (PAID/READY는 반드시 환불 enqueue)
    let immediate = 0;
    let enqueued = 0;
    for (const b of bookings) {
      if (REFUNDABLE.includes(b.status)) {
        const paid = b.payments[0];
        if (!paid) throw new RefundablePaymentMissingError(b.id); // 전체 롤백
        const r = await enqueueRefundJob(tx, {
          bookingId: b.id,
          paymentId: paid.id,
          amount: paid.amount,
          actor,
          reason,
          cancellationBatchId: batch.id,
        });
        if (r.enqueued) enqueued++;
      } else {
        await cancelBookingByAgencyTx(tx, { bookingId: b.id, actor, reason });
        immediate++;
      }
    }

    // 5. 즉시 종결 여부
    const status = enqueued === 0 ? "COMPLETED" : "PROCESSING";
    await tx.departureCancellation.update({
      where: { id: batch.id },
      data: { immediateCancels: immediate, status },
    });

    return { batchId: batch.id, total: bookings.length, enqueued, immediate };
  });
}
