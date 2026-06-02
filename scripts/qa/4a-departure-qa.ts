/**
 * Phase 4-A Task 6 종합 QA 스크립트 — Departure CMS 가드 런타임 증거 수집.
 *
 * 검증 시나리오 (실제 DB 연동):
 *  S1) createDeparture → status SCHEDULED, bookedSeats 0
 *  S2) reserveSeats(18) → bookedSeats 18 (소비자 좌석 차감)
 *  S3) updateDeparture(capacity 10) → CapacityBelowBookedError (18 > 10, D3 축소 거부)
 *  S4) updateDeparture(capacity 25) → 성공 (증가는 통과)
 *  S5) transitionDepartureStatus(CANCELED) → DepartureHasBookingsError (D1 취소 거부)
 *  S6) releaseSeats(18) → bookedSeats 0
 *  S7) transitionDepartureStatus(CANCELED) → 성공 (좌석 0이면 취소 가능)
 *  S8) reopen: 새 dep SCHEDULED→CLOSED→SCHEDULED 성공 (D5)
 *  S9) CLOSED 신규예약 차단(reserveSeats InsufficientCapacity) → reopen 후 재판매 성공
 *
 * 실행: npx tsx scripts/qa/4a-departure-qa.ts
 */

import { PrismaClient } from "@prisma/client";
import {
  createDeparture,
  updateDeparture,
  transitionDepartureStatus,
  getAdminDepartureById,
  CapacityBelowBookedError,
  DepartureHasBookingsError,
} from "@/entities/departure";
import { reserveSeats, releaseSeats, InsufficientCapacityError } from "@/entities/booking";

const db = new PrismaClient();

const SEPARATOR = "═".repeat(62);
const PASS = "\x1b[32m✅ PASS\x1b[0m";
const FAIL = "\x1b[31m❌ FAIL\x1b[0m";
let totalPass = 0;
let totalFail = 0;

function section(title: string) {
  console.log(`\n${SEPARATOR}\n  ${title}\n${SEPARATOR}`);
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
    assert(false, `${msg} — 예외가 발생하지 않음`);
  } catch (e) {
    const ok = e instanceof ErrCls;
    assert(ok, `${msg}${ok ? "" : ` — 다른 예외(${(e as Error).name})`}`);
  }
}

// DepartureFormData 헬퍼 (날짜만 바꿔가며 unique 충돌 회피)
function form(month: number, capacity: number, minPax = 4) {
  return {
    departureDate: new Date(`2027-${String(month).padStart(2, "0")}-01`),
    returnDate: new Date(`2027-${String(month).padStart(2, "0")}-05`),
    priceAdult: 1_000_000,
    priceChild: 700_000,
    priceInfant: 0,
    capacity,
    minPax,
  };
}

async function main() {
  const product = await db.product.findFirst({ select: { id: true, title: true } });
  if (!product) throw new Error("검증용 product가 없습니다 — seed를 먼저 실행하세요");
  console.log(`\n  대상 상품: ${product.title} (${product.id})`);

  const created: string[] = [];
  try {
    // ── S1 ──────────────────────────────────────────────────────────
    section("S1: createDeparture → SCHEDULED, bookedSeats 0");
    const dep1 = await createDeparture(product.id, form(6, 20));
    created.push(dep1);
    const d1 = await getAdminDepartureById(dep1);
    console.log(`  [DB raw] status=${d1?.status} bookedSeats=${d1?.bookedSeats} capacity=${d1?.capacity}`);
    assert(d1?.status === "SCHEDULED", "신규 출발일 status = SCHEDULED");
    assert(d1?.bookedSeats === 0, "신규 출발일 bookedSeats = 0");

    // ── S2 ──────────────────────────────────────────────────────────
    section("S2: reserveSeats(18) → bookedSeats 18");
    await reserveSeats(db, dep1, 18);
    const d2 = await getAdminDepartureById(dep1);
    console.log(`  [DB raw] bookedSeats=${d2?.bookedSeats}`);
    assert(d2?.bookedSeats === 18, "좌석 18석 차감 → bookedSeats = 18");

    // ── S3 ──────────────────────────────────────────────────────────
    section("S3: updateDeparture(capacity 10) → CapacityBelowBookedError (D3)");
    await assertThrows(
      () => updateDeparture(dep1, form(6, 10)),
      CapacityBelowBookedError,
      "예약 18석 > 새 정원 10 → 축소 거부",
    );
    const d3 = await getAdminDepartureById(dep1);
    assert(d3?.capacity === 20, "거부 후 capacity 원복 유지 = 20 (변경 안 됨)");

    // ── S4 ──────────────────────────────────────────────────────────
    section("S4: updateDeparture(capacity 25) → 성공 (증가는 통과)");
    await updateDeparture(dep1, form(6, 25));
    const d4 = await getAdminDepartureById(dep1);
    console.log(`  [DB raw] capacity=${d4?.capacity}`);
    assert(d4?.capacity === 25, "정원 증가 25 → 성공");

    // ── S5 ──────────────────────────────────────────────────────────
    section("S5: transitionDepartureStatus(CANCELED) bookedSeats>0 → DepartureHasBookingsError (D1)");
    await assertThrows(
      () => transitionDepartureStatus(dep1, "CANCELED"),
      DepartureHasBookingsError,
      "예약 18석 존재 → 취소 거부",
    );
    const d5 = await getAdminDepartureById(dep1);
    assert(d5?.status === "SCHEDULED", "거부 후 status 유지 = SCHEDULED");

    // ── S6 ──────────────────────────────────────────────────────────
    section("S6: releaseSeats(18) → bookedSeats 0");
    await releaseSeats(db, dep1, 18);
    const d6 = await getAdminDepartureById(dep1);
    console.log(`  [DB raw] bookedSeats=${d6?.bookedSeats}`);
    assert(d6?.bookedSeats === 0, "좌석 18석 반환 → bookedSeats = 0");

    // ── S7 ──────────────────────────────────────────────────────────
    section("S7: transitionDepartureStatus(CANCELED) bookedSeats=0 → 성공");
    await transitionDepartureStatus(dep1, "CANCELED");
    const d7 = await getAdminDepartureById(dep1);
    console.log(`  [DB raw] status=${d7?.status}`);
    assert(d7?.status === "CANCELED", "좌석 0 → 취소 전이 성공");

    // ── S8 ──────────────────────────────────────────────────────────
    section("S8: reopen SCHEDULED→CLOSED→SCHEDULED (D5)");
    const dep2 = await createDeparture(product.id, form(7, 10));
    created.push(dep2);
    await transitionDepartureStatus(dep2, "CLOSED");
    const d8a = await getAdminDepartureById(dep2);
    console.log(`  [DB raw] after CLOSED: status=${d8a?.status}`);
    assert(d8a?.status === "CLOSED", "SCHEDULED → CLOSED 성공");
    await transitionDepartureStatus(dep2, "SCHEDULED");
    const d8b = await getAdminDepartureById(dep2);
    console.log(`  [DB raw] after reopen: status=${d8b?.status}`);
    assert(d8b?.status === "SCHEDULED", "CLOSED → SCHEDULED reopen 성공");

    // ── S9 ──────────────────────────────────────────────────────────
    section("S9: CLOSED 신규예약 차단 → reopen 후 재판매");
    await transitionDepartureStatus(dep2, "CLOSED");
    await assertThrows(
      () => reserveSeats(db, dep2, 1),
      InsufficientCapacityError,
      "CLOSED 상태 → reserveSeats 신규 예약 차단",
    );
    const d9a = await getAdminDepartureById(dep2);
    assert(d9a?.bookedSeats === 0, "차단 후 bookedSeats 변동 없음 = 0");
    await transitionDepartureStatus(dep2, "SCHEDULED"); // reopen
    await reserveSeats(db, dep2, 1); // 재판매
    const d9b = await getAdminDepartureById(dep2);
    console.log(`  [DB raw] reopen 후 재판매: status=${d9b?.status} bookedSeats=${d9b?.bookedSeats}`);
    assert(d9b?.bookedSeats === 1, "reopen 후 재판매 성공 → bookedSeats = 1");
  } finally {
    // 정리 — 테스트 출발일 삭제 (실제 Booking row는 생성하지 않았으므로 안전)
    for (const id of created) {
      await db.departure.delete({ where: { id } }).catch(() => {});
    }
    console.log(`\n  정리 완료 — 테스트 출발일 ${created.length}건 삭제`);
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
