/**
 * add-theme-products.ts — 현재 DB 를 비우지 않고 테마 기획전 상품 12개를 추가(멱등).
 *
 * 실행:  npx tsx prisma/add-theme-products.ts
 * 이후:  dev 서버를 띄운 뒤 cron 워커로 임베딩 생성(검색 활성화):
 *   curl -H "authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/embedding-job
 *   (limit=5 라 신규 12개 → 3회 반복. USE_REAL_EMBEDDING 미설정 시 결정론 dev provider.)
 *
 * 멱등: 동일 title 이 이미 있으면 건너뛴다(재실행 안전). seed.ts 전체 재시드와
 * 동일한 정의(themeProducts.ts)를 공유한다.
 */
import { PrismaClient } from "@prisma/client";
import { buildThemeProducts } from "./themeProducts";

const prisma = new PrismaClient();

async function main() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const all = buildThemeProducts(today);
  const titles = all.map((p) => p.title);

  const existing = await prisma.product.findMany({
    where: { title: { in: titles } },
    select: { title: true },
  });
  const existingTitles = new Set(existing.map((p) => p.title));

  const toCreate = all.filter((p) => !existingTitles.has(p.title));
  if (toCreate.length === 0) {
    console.log("✅ 추가할 신규 테마 상품 없음(이미 모두 존재). 멱등 종료.");
    return;
  }

  const createdIds: string[] = [];
  for (const data of toCreate) {
    const product = await prisma.product.create({ data, select: { id: true, title: true } });
    createdIds.push(product.id);
    console.log(`  + ${product.title}`);
  }

  // 신규 상품에 임베딩 잡 PENDING 큐잉(검색 인덱싱). 워커가 OpenAI/dev provider로 생성.
  await prisma.embeddingJob.createMany({
    data: createdIds.map((productId) => ({
      productId,
      status: "PENDING" as const,
      actor: "system:add-theme-products",
    })),
  });

  console.log(
    `✅ 테마 상품 ${createdIds.length}건 추가 + EmbeddingJob 큐잉 완료. ` +
      `(이미 존재해 건너뜀: ${existingTitles.size}건)`,
  );
  console.log(
    "   검색 활성화: dev 서버 후 cron 워커 호출 — " +
      'curl -H "authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/embedding-job',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
