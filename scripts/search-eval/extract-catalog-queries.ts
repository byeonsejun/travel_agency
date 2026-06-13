/**
 * extract-catalog-queries.ts — 확장 카탈로그 쿼리의 실 임베딩 추출 (opt-in).
 *
 * QUERY_CATALOG 전건을 routeQuery(dev 규칙, 결정론)로 필터 추출 → cleanedQuery를
 * OpenAI로 임베딩해 queries.catalog.fixture.json(GoldenQuery[])으로 박제 → git 커밋.
 * 코퍼스(corpus.fixture.json)는 손대지 않는다 — 재임베딩 비용 회피, 동일 임베딩
 * 공간 유지(코퍼스와 같은 OpenAI 모델이라야 코사인이 의미를 가진다).
 *
 * 이후 run-eval(--catalog)은 이 JSON + judge-labels.fixture.json만 읽어
 * 키·DB·네트워크 0으로 실행한다.
 *
 * 가드: OPENAI_API_KEY 미설정 시 즉시 중단(dev 가짜 벡터 오염 방지).
 * 실행: set -a; . ./.env; set +a; npx tsx scripts/search-eval/extract-catalog-queries.ts
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "@/shared/lib/env";
import { OpenAIEmbeddingProvider } from "@/shared/lib/embedding";
import { toStorageTag } from "@/shared/lib/tags";
import { routeQuery } from "@/features/search";
import { QUERY_CATALOG } from "./query-catalog";
import type { GoldenQuery } from "./types";

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  if (!env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY 미설정 — 카탈로그 쿼리 임베딩 추출은 실 임베딩 키가 필요합니다.",
    );
  }
  const provider = new OpenAIEmbeddingProvider(env.OPENAI_API_KEY);

  console.log(`카탈로그 ${QUERY_CATALOG.length} 쿼리 임베딩 추출 시작…`);
  const queries: GoldenQuery[] = [];
  for (const spec of QUERY_CATALOG) {
    const routed = await routeQuery(spec.query);
    const embedding = await provider.embed(routed.cleanedQuery);
    queries.push({
      query: spec.query,
      cleanedQuery: routed.cleanedQuery,
      themeTags: (routed.themeTags ?? []).map(toStorageTag),
      geoTerms: routed.geoTerms ?? [],
      priceMax: routed.priceMax,
      durationNights: routed.durationNights,
      embedding,
    });
    console.log(
      `  ✓ [${spec.archetype}] ${spec.query}  → clean:"${routed.cleanedQuery}" theme:[${(routed.themeTags ?? []).join(",")}] geo:${(routed.geoTerms ?? []).length}`,
    );
  }

  writeFileSync(
    join(here, "queries.catalog.fixture.json"),
    JSON.stringify(queries, null, 2),
  );
  console.log(`\n박제 완료: queries.catalog.fixture.json (${queries.length} 쿼리)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
