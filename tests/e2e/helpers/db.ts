/**
 * E2E DB 정리 헬퍼 (테스트 전용 — Prisma 직접 사용).
 *
 * 체크아웃 스모크가 dev DB에 만든 예약을 self-cleaning 한다. 도메인 함수/스키마는
 * 일절 건드리지 않고, 테스트가 *직접 만든* 행만 결정적으로 식별해 삭제·좌석 복원한다.
 *
 * 식별 기준(절대 실데이터 미접촉):
 *   - userId === 시드 customer(테스트 전용 계정)  AND
 *   - traveler.lastNameEn === E2E 마커("E2ETEST")
 * 두 조건을 동시에 만족하는 예약만 대상. 시드 booking(KIM/…)·실사용자 예약은 제외된다.
 */

import { PrismaClient, type BookingStatus } from "@prisma/client";
import { loadEnvFromDotenv } from "./loadEnv";
import { SEED_CUSTOMER } from "./auth";

/**
 * 체크아웃 테스트가 여행자 성/이름에 심는 마커 — 실데이터엔 없는 sentinel.
 * TravelerSchema 제약상 영문 대문자만 허용(`/^[A-Z]+$/`)이라 숫자 불가 → 순수 알파벳.
 * 실제 로마자 성(KIM/LEE/PARK/HONG/CHOI…)과 겹치지 않는 합성 토큰.
 */
export const E2E_LASTNAME = "ETESTSMOKE";
/** 체크아웃 테스트 여행자 이름(firstNameEn). */
export const E2E_FIRSTNAME = "ETESTGUEST";

/**
 * 좌석을 점유 중인 booking 상태.
 * src/entities/booking/model/transitions.ts 의 SEAT_HELD_STATES 를 미러(SSOT 동기 주의).
 * 이 상태의 예약을 삭제하면 점유 좌석을 복원해야 한다. 취소 상태(CANCELED_*)는
 * 이미 좌석이 반환됐으므로 복원하지 않는다(이중 복원 방지).
 */
const SEAT_HELD_STATES: BookingStatus[] = [
  "RECEIVED",
  "AWAITING_GROUP",
  "DEPARTURE_CONFIRMED",
  "PAID",
  "READY",
];

let _db: PrismaClient | null = null;

/** 테스트 러너용 Prisma 싱글턴. .env는 읽기만(loadEnv). */
export function testDb(): PrismaClient {
  if (!_db) {
    loadEnvFromDotenv();
    _db = new PrismaClient();
  }
  return _db;
}

export async function closeTestDb(): Promise<void> {
  if (_db) {
    await _db.$disconnect();
    _db = null;
  }
}

/**
 * 단일 예약을 딸린 행과 함께 삭제하고, 점유 좌석을 복원한다(단일 Tx).
 *
 * 삭제 순서(FK 제약 — schema.prisma 기준):
 *   1. PaymentEvent(bookingId)  — onDelete:SetNull(차단 안 함) → 고아 방지 위해 먼저 삭제
 *   2. RefundJob(bookingId)     — onDelete 기본(Restrict) → Booking/Payment보다 먼저
 *   3. Payment(bookingId)       — onDelete 기본(Restrict) → Booking보다 먼저
 *   4. Booking.delete           — Cascade: Traveler/BookingTerms/BookingEvent/EmailJob/Review
 *   5. Departure.bookedSeats    — 점유 상태였으면 (adult+child) 복원 (infant 미차감)
 *
 * @returns 삭제 여부(존재하지 않으면 false)
 */
export async function deleteBookingDeep(bookingId: string): Promise<boolean> {
  const db = testDb();
  return db.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: {
        status: true,
        adultCount: true,
        childCount: true,
        departureId: true,
      },
    });
    if (!booking) return false;

    await tx.paymentEvent.deleteMany({ where: { bookingId } });
    await tx.refundJob.deleteMany({ where: { bookingId } });
    await tx.payment.deleteMany({ where: { bookingId } });
    await tx.booking.delete({ where: { id: bookingId } });

    // 좌석 복원 — 예약 생성 시 reserveSeats가 bookedSeats를 *증가*시켰으므로,
    // 삭제(=release)는 점유 좌석만큼 *감소*시킨다. releaseSeats(seatLock.ts)와 동일하게
    // 0 미만으로 내려가지 않도록 floor. 취소 상태(좌석 이미 반환)는 복원하지 않는다.
    const heldSeats = booking.adultCount + booking.childCount; // infant 미차감
    if (heldSeats > 0 && SEAT_HELD_STATES.includes(booking.status)) {
      const dep = await tx.departure.findUnique({
        where: { id: booking.departureId },
        select: { bookedSeats: true },
      });
      await tx.departure.update({
        where: { id: booking.departureId },
        data: { bookedSeats: Math.max(0, (dep?.bookedSeats ?? 0) - heldSeats) },
      });
    }
    return true;
  });
}

/**
 * 시드 customer + E2E 마커로 식별되는 예약을 전부 삭제·좌석 복원한다.
 * 부분 실패(결제 전 중단)로 남은 예약도 마커로 잡힌다(여행자 성은 생성 시점에 박힘).
 *
 * @param lastNames 매칭할 여행자 성 목록(기본: 현행 마커). 과거 잔류분 일괄 정리 시 확장.
 * @returns 삭제된 booking ID 목록
 */
export async function purgeE2EBookings(
  lastNames: string[] = [E2E_LASTNAME],
): Promise<string[]> {
  const db = testDb();
  const bookings = await db.booking.findMany({
    where: {
      userId: SEED_CUSTOMER.id,
      travelers: { some: { lastNameEn: { in: lastNames } } },
    },
    select: { id: true },
  });

  const deleted: string[] = [];
  for (const { id } of bookings) {
    if (await deleteBookingDeep(id)) deleted.push(id);
  }
  return deleted;
}
