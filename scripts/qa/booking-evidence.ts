import { db } from "../../src/shared/lib/db";
import { createBooking } from "../../src/entities/booking/api/mutations";
import { transitionStatus } from "../../src/entities/booking/api/mutations";
import { cancelBookingByUser } from "../../src/entities/booking/api/mutations";
import { InsufficientCapacityError } from "../../src/entities/booking/api/seatLock";
import { PriceMismatchError } from "../../src/entities/booking/api/errors";
import { ForbiddenError } from "../../src/entities/booking/api/errors";
import { InvalidTransitionError } from "../../src/entities/booking/model/transitions";

const scenario = process.argv[2] ?? "createBooking";

async function getTestData() {
  const user = await db.user.findFirst({ where: { role: "CUSTOMER" } });
  const departure = await db.departure.findFirst({
    where: { status: { in: ["SCHEDULED", "CONFIRMED"] }, capacity: { gt: 2 } },
    include: { product: { select: { title: true } } },
  });
  return { user, departure };
}

const traveler = {
  lastNameEn: "KIM",
  firstNameEn: "JIHOON",
  gender: "MALE" as const,
  birthDate: new Date("1990-01-01"),
  role: "TRAVELER" as const,
};

async function runCreateBooking() {
  console.log("\n=== createBooking 시나리오 ===");
  const { user, departure } = await getTestData();
  if (!user || !departure) {
    console.log("SKIP: 테스트 데이터 없음");
    return null;
  }

  const priceAdult = departure.priceAdult;
  const priceChild = departure.priceChild;
  const expectedTotal = priceAdult * 1 + priceChild * 1;

  const depBefore = await db.departure.findUniqueOrThrow({ where: { id: departure.id } });
  console.log("departure before:", { bookedSeats: depBefore.bookedSeats, version: depBefore.version });

  // 시나리오 1: 정상 생성
  const booking = await createBooking({
    departureId: departure.id,
    userId: user.id,
    adultCount: 1,
    childCount: 1,
    infantCount: 0,
    expectedTotalPrice: expectedTotal,
    travelers: [traveler, traveler],
    termKeys: ["standard_overseas_v1"],
  });
  console.log("시나리오 1 (정상 생성) Booking.id:", booking.id, "status:", booking.status);

  const events = await db.bookingEvent.findMany({ where: { bookingId: booking.id } });
  const travelers = await db.traveler.findMany({ where: { bookingId: booking.id } });
  console.log("BookingEvent count:", events.length, "toState:", events[0]?.toState);
  console.log("Traveler count:", travelers.length);

  const depAfter = await db.departure.findUniqueOrThrow({ where: { id: departure.id } });
  console.log("departure after:", { bookedSeats: depAfter.bookedSeats, version: depAfter.version });
  console.log("bookedSeats +2 (adult+child):", depAfter.bookedSeats === depBefore.bookedSeats + 2 ? "PASS" : "FAIL");

  // 시나리오 2: 가격 불일치
  try {
    await createBooking({
      departureId: departure.id,
      userId: user.id,
      adultCount: 1,
      childCount: 0,
      infantCount: 0,
      expectedTotalPrice: 999,
      travelers: [traveler],
      termKeys: ["standard_overseas_v1"],
    });
    console.log("시나리오 2: FAIL (거부 안 됨)");
  } catch (e) {
    console.log("시나리오 2 (PriceMismatch):", e instanceof PriceMismatchError ? "PASS" : "FAIL: " + (e as Error).name);
  }

  // 시나리오 3: 좌석 부족
  try {
    await createBooking({
      departureId: departure.id,
      userId: user.id,
      adultCount: 9999,
      childCount: 0,
      infantCount: 0,
      expectedTotalPrice: priceAdult * 9999,
      travelers: Array(9).fill(traveler),
      termKeys: ["standard_overseas_v1"],
    });
    console.log("시나리오 3: FAIL (거부 안 됨)");
  } catch (e) {
    const isInsuff = e instanceof InsufficientCapacityError;
    // zod가 먼저 걸릴 수 있음 (9999 > 9 인원 제한)
    console.log("시나리오 3 (InsufficientCapacity or ZodError):", isInsuff || (e as Error).name === "ZodError" ? "PASS" : "FAIL: " + (e as Error).name);
  }

  return booking;
}

async function runTransitionStatus(bookingId: string) {
  console.log("\n=== transitionStatus 시나리오 ===");

  // 시나리오 1: 잘못된 전이 (RECEIVED → PAID)
  try {
    await transitionStatus({ bookingId, to: "PAID", actor: "test" });
    console.log("시나리오 T1: FAIL");
  } catch (e) {
    console.log("시나리오 T1 (RECEIVED→PAID 거부):", e instanceof InvalidTransitionError ? "PASS" : "FAIL: " + (e as Error).name);
  }

  // 시나리오 2: 정상 전이 RECEIVED → CANCELED_BY_USER (좌석 환원 포함)
  const depBefore = await db.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { departureId: true, adultCount: true, childCount: true } });
  const depSeatBefore = await db.departure.findUniqueOrThrow({ where: { id: depBefore.departureId }, select: { bookedSeats: true } });

  await cancelBookingByUser({ bookingId, userId: (await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).userId, reason: "테스트 취소" });

  const depSeatAfter = await db.departure.findUniqueOrThrow({ where: { id: depBefore.departureId }, select: { bookedSeats: true } });
  const expectedSeats = depBefore.adultCount + depBefore.childCount;
  console.log("시나리오 T2 좌석 환원:", depSeatAfter.bookedSeats === depSeatBefore.bookedSeats - expectedSeats ? "PASS" : "FAIL");

  const events = await db.bookingEvent.findMany({ where: { bookingId }, orderBy: { createdAt: "asc" } });
  console.log("BookingEvent timeline:");
  events.forEach(e => console.log(`  ${e.fromState ?? "null"} → ${e.toState} by ${e.actor}`));

  // 시나리오 3: terminal 상태에서 전이 거부
  try {
    await transitionStatus({ bookingId, to: "CANCELED_BY_USER", actor: "test" });
    console.log("시나리오 T3: FAIL");
  } catch (e) {
    console.log("시나리오 T3 (COMPLETED terminal 거부):", e instanceof InvalidTransitionError ? "PASS" : "FAIL: " + (e as Error).name);
  }
}

async function runCancelAuth() {
  console.log("\n=== cancelBookingByUser 권한 시나리오 ===");
  const { user, departure } = await getTestData();
  if (!user || !departure) { console.log("SKIP"); return; }

  const priceAdult = departure.priceAdult;
  const booking = await createBooking({
    departureId: departure.id,
    userId: user.id,
    adultCount: 1,
    childCount: 0,
    infantCount: 0,
    expectedTotalPrice: priceAdult,
    travelers: [traveler],
    termKeys: ["standard_overseas_v1"],
  });

  // 타인 취소 시도
  try {
    await cancelBookingByUser({ bookingId: booking.id, userId: "other-user-id" });
    console.log("권한 시나리오: FAIL");
  } catch (e) {
    console.log("권한 시나리오 (ForbiddenError):", e instanceof ForbiddenError ? "PASS" : "FAIL: " + (e as Error).name);
  }

  // 정상 취소
  await cancelBookingByUser({ bookingId: booking.id, userId: user.id, reason: "권한 테스트" });
  const canceled = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
  console.log("정상 취소 status:", canceled.status === "CANCELED_BY_USER" ? "PASS" : "FAIL: " + canceled.status);
}

async function main() {
  try {
    if (scenario === "createBooking" || scenario === "all") {
      const booking = await runCreateBooking();
      if (booking && (scenario === "transitionStatus" || scenario === "all")) {
        await runTransitionStatus(booking.id);
      }
    }
    if (scenario === "transitionStatus") {
      // transitionStatus만 단독 실행 시 booking 먼저 생성
      const booking = await runCreateBooking();
      if (booking) await runTransitionStatus(booking.id);
    }
    if (scenario === "cancelAuth" || scenario === "all") {
      await runCancelAuth();
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
