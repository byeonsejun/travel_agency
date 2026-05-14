import { db } from "@/shared/lib/db";

async function main() {
  // partial unique index 생성 (IF NOT EXISTS로 멱등)
  await db.$executeRaw`
    CREATE UNIQUE INDEX IF NOT EXISTS "payment_one_paid_per_booking"
      ON "Payment" ("bookingId")
      WHERE status = 'PAID'
  `;
  console.log("✅ partial unique index 적용 완료");

  // 1. PaymentEvent 테이블 존재 확인
  const paymentEventCols = await db.$queryRaw<{ column_name: string; data_type: string }[]>`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'PaymentEvent'
    ORDER BY ordinal_position
  `;
  console.log("\n📋 PaymentEvent 컬럼:");
  paymentEventCols.forEach((c) => console.log(`  ${c.column_name}: ${c.data_type}`));

  // 2. RefundJob 테이블 존재 확인
  const refundJobCols = await db.$queryRaw<{ column_name: string; data_type: string }[]>`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'RefundJob'
    ORDER BY ordinal_position
  `;
  console.log("\n📋 RefundJob 컬럼:");
  refundJobCols.forEach((c) => console.log(`  ${c.column_name}: ${c.data_type}`));

  // 3. Booking.paymentDueAt 컬럼 확인
  const bookingDueAt = await db.$queryRaw<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'Booking' AND column_name = 'paymentDueAt'
  `;
  console.log(
    `\n📋 Booking.paymentDueAt: ${bookingDueAt.length > 0 ? "✅ 존재" : "❌ 없음"}`
  );

  // 4. partial unique index 확인
  const idxResult = await db.$queryRaw<{ indexname: string; indexdef: string }[]>`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'Payment'
      AND indexname = 'payment_one_paid_per_booking'
  `;
  if (idxResult.length > 0) {
    console.log("\n📋 Partial unique index:");
    console.log(`  이름: ${idxResult[0].indexname}`);
    console.log(`  정의: ${idxResult[0].indexdef}`);
  } else {
    console.log("\n❌ partial unique index 없음");
  }

  // 5. enum 타입 확인
  const enumTypes = await db.$queryRaw<{ typname: string }[]>`
    SELECT typname FROM pg_type
    WHERE typname IN ('PaymentEventResult', 'RefundJobStatus')
    ORDER BY typname
  `;
  console.log("\n📋 Enum 타입:");
  enumTypes.forEach((e) => console.log(`  ✅ ${e.typname}`));

  // 6. PaymentEvent UNIQUE 인덱스 확인
  const peIdx = await db.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'PaymentEvent'
    ORDER BY indexname
  `;
  console.log("\n📋 PaymentEvent 인덱스:");
  peIdx.forEach((i) => console.log(`  ${i.indexname}`));

  // 7. RefundJob 인덱스 확인
  const rjIdx = await db.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'RefundJob'
    ORDER BY indexname
  `;
  console.log("\n📋 RefundJob 인덱스:");
  rjIdx.forEach((i) => console.log(`  ${i.indexname}`));

  await db.$disconnect();
}

main().catch(console.error);
