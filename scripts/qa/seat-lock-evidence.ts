import { db } from "../../src/shared/lib/db";
import {
  reserveSeats,
  releaseSeats,
  InsufficientCapacityError,
} from "../../src/entities/booking/api/seatLock";

async function main() {
  const dep = await db.departure.findFirst({ where: { capacity: { gt: 0 } } });
  if (!dep) {
    console.log("SKIP: 출발 데이터 없음 (seed 먼저 실행)");
    await db.$disconnect();
    return;
  }

  console.log(
    "BEFORE:",
    JSON.stringify({
      id: dep.id,
      capacity: dep.capacity,
      bookedSeats: dep.bookedSeats,
      version: dep.version,
    })
  );

  // 시나리오 A: 정상 차감
  await db.$transaction(async (tx) => {
    await reserveSeats(tx, dep.id, 1);
  });
  const after1 = await db.departure.findUniqueOrThrow({ where: { id: dep.id } });
  console.log(
    "AFTER reserve 1:",
    JSON.stringify({ bookedSeats: after1.bookedSeats, version: after1.version })
  );
  const passA =
    after1.bookedSeats === dep.bookedSeats + 1 &&
    after1.version === dep.version + 1;
  console.log("시나리오 A (bookedSeats+1, version+1):", passA ? "PASS" : "FAIL");

  // 시나리오 B: 용량 초과 거부
  try {
    await db.$transaction(async (tx) => {
      await reserveSeats(tx, dep.id, 99999);
    });
    console.log("시나리오 B: FAIL (거부되지 않음)");
  } catch (e) {
    const isCap = e instanceof InsufficientCapacityError;
    console.log(
      "시나리오 B (InsufficientCapacityError):",
      isCap ? "PASS" : `FAIL: ${(e as Error).name}`
    );
  }

  // 원복: releaseSeats
  await db.$transaction(async (tx) => {
    await releaseSeats(tx, dep.id, 1);
  });
  const restored = await db.departure.findUniqueOrThrow({ where: { id: dep.id } });
  console.log("RESTORED:", JSON.stringify({ bookedSeats: restored.bookedSeats }));
  console.log(
    "원복:",
    restored.bookedSeats === dep.bookedSeats ? "PASS" : "FAIL"
  );

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
