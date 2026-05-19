/**
 * ai-search-evidence.ts — M-AI-SEARCH 종합 QA 자동 증거 (plan Task 9).
 *
 * 검증 축:
 *  1. M3 공식 DoD 쿼리 "가족이랑 갈만한 동남아 휴양지 5박" — hybrid +
 *     gazetteer geo + soft-boost 가 의미 있는 결과를 반환하는가
 *  2. 대표 쿼리 매트릭스 — 일본(국가)/효도(추상 의도)/동남아 휴양(권역+테마)
 *  3. degradation(D5) 실증 — 벡터 연산 실패 시 500 없이 키워드 폴백
 *  4. DB 정합 — ProductEmbedding count·modelVersion 게이트(D4)
 *
 * 실행: `set -a; . ./.env; set +a; npx tsx scripts/qa/ai-search-evidence.ts`
 *  (USE_REAL_EMBEDDING/OPENAI_API_KEY 가 .env에 반영되어야 실 임베딩 경로)
 */

import { Prisma } from "@prisma/client";
import { db } from "../../src/shared/lib/db";
import {
  searchProducts,
  __resetSearchCacheForTest,
} from "../../src/features/search/server/search";
import { ruleBasedRoute } from "../../src/features/search/server/router";
import {
  searchProductsByVector,
  expandGeoTerms,
} from "../../src/entities/product";
import { getEmbeddingProvider } from "../../src/shared/lib/embedding";

function fmt(rows: { score?: number; destination: string; title: string }[]) {
  return rows
    .map((p) => `${p.score?.toFixed(3) ?? "n/a"} ${p.destination} (${p.title})`)
    .join("\n     ");
}

async function main(): Promise<void> {
  const provider = getEmbeddingProvider();
  console.log(`provider=${provider.modelVersion}`);
  __resetSearchCacheForTest();

  // ── 0. DB 정합 (D4 게이트 전제) ──────────────────────────
  const dist = await db.$queryRaw<{ modelVersion: string; n: number }[]>(
    Prisma.sql`SELECT "modelVersion", count(*)::int AS n
               FROM "ProductEmbedding" GROUP BY "modelVersion"`
  );
  console.log("\n[0] ProductEmbedding modelVersion 분포:", JSON.stringify(dist));
  const gateOk =
    dist.length === 1 && dist[0].modelVersion === provider.modelVersion;
  console.log(`    게이트 정합(provider와 단일 일치): ${gateOk ? "PASS" : "FAIL"}`);

  // ── 1. M3 공식 DoD 쿼리 ─────────────────────────────────
  const dod = "가족이랑 갈만한 동남아 휴양지 5박";
  const rt = ruleBasedRoute(dod);
  console.log(`\n[1] M3 DoD 쿼리: "${dod}"`);
  console.log(
    `    routed → priceMax=${rt.priceMax} durationNights=${JSON.stringify(
      rt.durationNights
    )} themeTags=${JSON.stringify(rt.themeTags)} geoTerms=${
      rt.geoTerms?.length ?? 0
    }개 cleaned="${rt.cleanedQuery}"`
  );
  const dodRes = await searchProducts(dod);
  console.log(`    결과 ${dodRes.length}건:\n     ${fmt(dodRes.slice(0, 6))}`);
  const seaSet = new Set(["베트남", "태국", "인도네시아", "필리핀"]);
  // DoD = "의미 있는 결과 반환". 카탈로그상 SEA·5박+ 상품은 다낭/푸켓
  // 2건뿐(발리·세부는 4박 → durationNights 하드필터로 정상 제외).
  // 따라서 판정 = ① 결과 존재 ② 상위가 SEA ③ 5박 제약 준수(geo+duration).
  const topIsSEA =
    dodRes.length > 0 &&
    [...seaSet].some((c) => dodRes[0].destination.includes(c));
  const durationHonored = dodRes.every((p) => p.durationNights >= 5);
  console.log(
    `    DoD 판정(결과존재·상위 SEA·5박 준수): ${
      dodRes.length >= 1 && topIsSEA && durationHonored ? "PASS" : "FAIL"
    }`
  );

  // ── 2. 대표 쿼리 매트릭스 ───────────────────────────────
  console.log(`\n[2] 대표 쿼리 매트릭스 (hybrid/geo/soft-boost):`);
  for (const q of ["일본", "부모님 모시고 따뜻한 효도 여행", "동남아 휴양"]) {
    const r = await searchProducts(q);
    console.log(`    q="${q}" → ${r.length}건`);
    console.log(`     ${fmt(r.slice(0, 4))}`);
  }

  // ── 3. degradation(D5) 실증 — 벡터 연산 강제 실패 ────────
  // 3차원 벡터를 vector(1536) 컬럼에 캐스트 → Postgres 차원 에러 →
  // catch → keywordFallback. 500 없이 geo-aware 결과를 반환해야 함.
  console.log(`\n[3] degradation(D5) — 벡터 연산 실패 → 키워드 폴백:`);
  const geo = expandGeoTerms("동남아");
  let degraded: Awaited<ReturnType<typeof searchProductsByVector>>;
  try {
    degraded = await searchProductsByVector(
      [0.1, 0.2, 0.3], // 의도적 차원 불일치 → 벡터 경로 throw 유발
      {},
      provider.modelVersion,
      "동남아",
      geo
    );
    console.log(
      `    throw 없음 + ${degraded.length}건 반환 (키워드 폴백 동작):\n     ${fmt(
        degraded.slice(0, 4)
      )}`
    );
    const fallbackSEA =
      degraded.length > 0 &&
      degraded.some((p) =>
        [...seaSet].some((c) => p.destination.includes(c))
      );
    console.log(
      `    degradation 판정(500 없이 geo 폴백 SEA 반환): ${
        fallbackSEA ? "PASS" : "FAIL"
      }`
    );
  } catch (e) {
    console.log(`    FAIL — 폴백이 흡수하지 못하고 throw: ${(e as Error).message}`);
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error("[ai-search-evidence] FAILED:", e);
  process.exit(1);
});
