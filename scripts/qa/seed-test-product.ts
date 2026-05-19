// 100원 결제 테스트 전용 상품 시드 스크립트.
// 실행: npx tsx scripts/qa/seed-test-product.ts
// prisma/seed.ts 와 독립 — 재시드해도 이 상품은 보존된다(upsert).
import { PrismaClient, ProductStatus, DepartureStatus, InclusionKind } from "@prisma/client";

const prisma = new PrismaClient();

const PRODUCT_ID = "cqatestpayment000000000001";

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

async function main() {
  const today = new Date();
  const departureDate = addDays(today, 30);
  const returnDate = addDays(today, 32);

  // 기존 자식 레코드 정리 후 재생성 (멱등)
  await prisma.product.deleteMany({ where: { id: PRODUCT_ID } });

  const product = await prisma.product.create({
    data: {
      id: PRODUCT_ID,
      title: "[QA] 100원 결제 테스트 상품",
      summary: "결제 플로우 검증 전용. 실제 여행 상품 아님.",
      aiSummary: "토스 테스트 결제 검증용 100원 상품입니다.",
      destination: "테스트, QA",
      destinationCode: "QA-TEST",
      durationNights: 2,
      durationDays: 3,
      status: ProductStatus.PUBLISHED,
      basePriceAdult: 100,
      tags: { create: [{ tag: "#QA테스트" }] },
      inclusions: {
        create: [
          { kind: InclusionKind.INCLUDED, label: "테스트 결제 검증" },
          { kind: InclusionKind.EXCLUDED, label: "실제 여행 (제공 안 함)" },
        ],
      },
      itineraryDays: {
        create: [
          { dayNumber: 1, title: "QA Day 1", meals: { breakfast: "X", lunch: "X", dinner: "X" } },
          { dayNumber: 2, title: "QA Day 2", meals: { breakfast: "X", lunch: "X", dinner: "X" } },
          { dayNumber: 3, title: "QA Day 3", meals: { breakfast: "X", lunch: "X", dinner: "X" } },
        ],
      },
      departures: {
        create: [
          {
            departureDate,
            returnDate,
            priceAdult: 100,
            priceChild: 100,
            priceInfant: 0,
            capacity: 20,
            bookedSeats: 0,
            minPax: 1,
            status: DepartureStatus.SCHEDULED,
          },
        ],
      },
    },
    include: { departures: true },
  });

  console.log("\n✅ 100원 테스트 상품 생성 완료");
  console.log(`   productId  = ${product.id}`);
  console.log(`   departureId = ${product.departures[0].id}`);
  console.log(`   PDP URL    = /products/${product.id}`);
  console.log(`   checkout   = /products/${product.id}/checkout?departureId=${product.departures[0].id}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
