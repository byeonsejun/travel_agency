import { db } from "../../src/shared/lib/db";
import { listMyBookings, getBookingById, getBookingDetail } from "../../src/entities/booking/api/queries";

async function main() {
  const customer = await db.user.findFirst({ where: { role: "CUSTOMER" } });
  if (!customer) {
    console.log("SKIP: customer 사용자 없음");
    await db.$disconnect();
    return;
  }
  console.log("customer:", customer.email);

  const list = await listMyBookings(customer.id);
  console.log("listMyBookings count:", list.length);
  if (list.length > 0) {
    console.log("첫 번째 항목:", JSON.stringify(list[0], null, 2));

    const detail = await getBookingDetail(list[0].id, customer.id);
    console.log("getBookingDetail events count:", detail?.events.length ?? 0);

    const safe = await getBookingById(list[0].id, customer.id);
    console.log("getBookingById status:", safe?.status);

    // 타인 접근 거부 확인
    const other = await getBookingById(list[0].id, "nonexistent-user-id");
    console.log("타인 접근:", other === null ? "PASS (null)" : "FAIL");
  } else {
    console.log("booking 없음 — 빈 배열 반환: PASS");
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
