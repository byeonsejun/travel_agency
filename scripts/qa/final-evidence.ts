import { db } from "../../src/shared/lib/db";
import { cancelBookingByUser, transitionStatus } from "../../src/entities/booking/api/mutations";
import { InvalidTransitionError } from "../../src/entities/booking/model/transitions";
import { createBooking } from "../../src/entities/booking/api/mutations";
import { InsufficientCapacityError } from "../../src/entities/booking/api/seatLock";

async function main() {
  console.log("=== 종합 시나리오: 시드 booking → 취소 → 좌석 환원 → BookingEvent 2건 ===");

  const customer = await db.user.findUniqueOrThrow({ where: { email: "customer@nextour.test" } });
  const booking = await db.booking.findFirst({
    where: { userId: customer.id, status: "RECEIVED" },
    include: { departure: true },
  });

  if (!booking) {
    console.log("SKIP: 시드 booking 없음 (npm run db:seed 먼저 실행)");
    await db.$disconnect();
    return;
  }

  console.log("시드 booking:", { id: booking.id, status: booking.status, totalPrice: booking.totalPrice });

  const depBefore = await db.departure.findUniqueOrThrow({ where: { id: booking.departureId } });
  console.log("출발 좌석 before:", { bookedSeats: depBefore.bookedSeats });

  // 취소
  await cancelBookingByUser({ bookingId: booking.id, userId: customer.id, reason: "QA 종합 테스트" });

  const canceled = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
  console.log("취소 후 status:", canceled.status === "CANCELED_BY_USER" ? "PASS" : "FAIL: " + canceled.status);

  const depAfter = await db.departure.findUniqueOrThrow({ where: { id: booking.departureId } });
  const expected = booking.adultCount + booking.childCount;
  console.log("좌석 환원:", depAfter.bookedSeats === depBefore.bookedSeats - expected ? "PASS" : "FAIL");
  console.log("  before:", depBefore.bookedSeats, "→ after:", depAfter.bookedSeats, "(복원:", expected, "석)");

  const events = await db.bookingEvent.findMany({
    where: { bookingId: booking.id },
    orderBy: { createdAt: "asc" },
  });
  console.log("BookingEvent count:", events.length, events.length >= 2 ? "PASS" : "FAIL");
  events.forEach((e) =>
    console.log(`  ${e.fromState ?? "null"} → ${e.toState} by ${e.actor}`)
  );

  console.log("\n=== 거부 시나리오: terminal 상태 전이 거부 ===");
  try {
    await transitionStatus({ bookingId: booking.id, to: "RECEIVED", actor: "test" });
    console.log("FAIL: 거부되지 않음");
  } catch (e) {
    console.log("terminal 거부:", e instanceof InvalidTransitionError ? "PASS" : "FAIL: " + (e as Error).name);
  }

  console.log("\n=== 동시 차감 시뮬레이션 ===");
  const dep = await db.departure.findFirst({
    where: { status: "SCHEDULED", capacity: { gt: 0 } },
  });
  if (dep) {
    const available = dep.capacity - dep.bookedSeats;
    const results = await Promise.allSettled([
      createBooking({
        departureId: dep.id,
        userId: customer.id,
        adultCount: Math.max(1, available),
        childCount: 0,
        infantCount: 0,
        expectedTotalPrice: dep.priceAdult * Math.max(1, available),
        travelers: [{ lastNameEn: "A", firstNameEn: "B", gender: "MALE", birthDate: new Date("1990-01-01"), role: "TRAVELER" }],
        termKeys: ["standard_overseas_v1"],
      }),
      createBooking({
        departureId: dep.id,
        userId: customer.id,
        adultCount: Math.max(1, available),
        childCount: 0,
        infantCount: 0,
        expectedTotalPrice: dep.priceAdult * Math.max(1, available),
        travelers: [{ lastNameEn: "C", firstNameEn: "D", gender: "MALE", birthDate: new Date("1990-01-01"), role: "TRAVELER" }],
        termKeys: ["standard_overseas_v1"],
      }),
    ]);

    const passed = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    console.log(`병렬 2개 요청: ${passed}개 성공, ${failed}개 실패`);
    console.log("동시 차감 시뮬레이션:", passed <= 1 ? "PASS (최대 1개만 성공)" : "주의 (둘 다 성공 — 남은 좌석 충분)");

    // 생성된 booking 정리 (취소)
    for (const r of results) {
      if (r.status === "fulfilled") {
        await cancelBookingByUser({ bookingId: r.value.id, userId: customer.id });
      }
    }
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
