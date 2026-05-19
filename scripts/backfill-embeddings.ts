/**
 * backfill-embeddings.ts — PUBLISHED 상품 임베딩 멱등 백필 (M-AI-SEARCH Task 5).
 *
 * 멱등성 보장:
 *  - 스키마 적용: CREATE EXTENSION/INDEX IF NOT EXISTS — 재실행 무해.
 *  - 임베딩 upsert: PK("productId") 기준 ON CONFLICT DO UPDATE — 중복 행
 *    생성 불가. dev provider는 결정론적이라 재실행 시 동일 벡터로 수렴.
 *  - 여러 번 실행해도 행 수는 PUBLISHED 상품 수에 고정된다.
 *
 * provider는 getEmbeddingProvider()로 선택 — 비-프로덕션은 외부 비용 0의
 * DeterministicDevProvider (NO-REAL-MONEY / feedback_dev_external_io).
 *
 * 실행: `set -a; . ./.env; set +a; npx tsx scripts/backfill-embeddings.ts`
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { getEmbeddingProvider } from "../src/shared/lib/embedding";

const db = new PrismaClient({ log: ["error"] });

/** 런타임에 필요한 pgvector 스키마를 멱등 적용 (상수 SQL — 인젝션 무관). */
async function ensurePgvectorSchema(): Promise<void> {
  await db.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS product_embedding_vector_idx ` +
      `ON "ProductEmbedding" USING ivfflat (vector vector_cosine_ops) ` +
      `WITH (lists = 100)`
  );
}

/** 임베딩 입력 텍스트: 제목·요약·목적지·태그를 결합. */
function buildEmbeddingText(p: {
  title: string;
  summary: string;
  destination: string;
  tags: { tag: string }[];
}): string {
  return [p.title, p.summary, p.destination, ...p.tags.map((t) => t.tag)]
    .join(" ")
    .trim();
}

async function main(): Promise<void> {
  await ensurePgvectorSchema();

  const provider = getEmbeddingProvider();
  const products = await db.product.findMany({
    where: { status: "PUBLISHED" },
    select: {
      id: true,
      title: true,
      summary: true,
      destination: true,
      tags: { select: { tag: true } },
    },
  });

  let processed = 0;
  for (const p of products) {
    const vec = await provider.embed(buildEmbeddingText(p));
    if (vec.length !== 1536) {
      throw new Error(
        `embedding 차원 불일치: ${p.id} → ${vec.length} (기대 1536)`
      );
    }
    const vecLiteral = `[${vec.join(",")}]`;
    // 멱등 upsert: 벡터는 텍스트 바인딩 후 ::vector 캐스트(인젝션 안전).
    await db.$executeRaw(Prisma.sql`
      INSERT INTO "ProductEmbedding" ("productId", "vector", "modelVersion", "updatedAt")
      VALUES (${p.id}, ${vecLiteral}::vector, ${provider.modelVersion}, now())
      ON CONFLICT ("productId") DO UPDATE
        SET "vector" = EXCLUDED."vector",
            "modelVersion" = EXCLUDED."modelVersion",
            "updatedAt" = now()
    `);
    processed += 1;
  }

  const [{ n }] = await db.$queryRaw<{ n: number }[]>(
    Prisma.sql`SELECT count(*)::int AS n FROM "ProductEmbedding"`
  );
  console.log(
    `[backfill] provider=${provider.modelVersion} processed=${processed} ` +
      `published=${products.length} ProductEmbedding.count=${n}`
  );
  if (n !== products.length) {
    throw new Error(
      `검증 실패: ProductEmbedding.count(${n}) != PUBLISHED(${products.length})`
    );
  }
}

main()
  .catch((e) => {
    console.error("[backfill] FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
