/**
 * extract-fixtures.ts — 1회용 실 임베딩 추출기 (opt-in, dev/test 경로 밖).
 *
 * 현 DB의 PUBLISHED 상품 전체(코퍼스) + golden 쿼리를 OpenAI로 임베딩해
 * corpus.fixture.json / queries.fixture.json 으로 박제 → git 커밋.
 * 이후 eval(run-eval.ts)은 이 JSON만 읽어 키·DB·네트워크 0으로 실행.
 *
 * 코퍼스는 시드 9개가 아니라 *현 DB의 실제 PUBLISHED 전체*다(의도당 3~4개
 * 경쟁 상품이 있어야 랭킹 변별력이 생긴다). status='PUBLISHED' 필터만 적용 —
 * Draft/Closed 제외. modelVersion 게이트는 임베딩을 여기서 직접 생성하므로 무관.
 *
 * 가드: OPENAI_API_KEY 미설정 시 즉시 중단(가짜 벡터 오염 방지).
 * 실행: set -a; . ./.env; set +a; npx tsx scripts/search-eval/extract-fixtures.ts
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "@/shared/lib/db";
import { env } from "@/shared/lib/env";
import { OpenAIEmbeddingProvider } from "@/shared/lib/embedding";
import { buildEmbeddingText } from "@/entities/product";
import { toStorageTag } from "@/shared/lib/tags";
import { routeQuery } from "@/features/search";
import { GOLDEN_QUERIES } from "./golden-queries";
import { rankCandidates } from "./scoreReplica";
import { requestRerankLive, type RerankDoc } from "@/features/search/server/rerank";
import { HARD_QUERIES } from "./hard-queries";
import type { CorpusProduct, GoldenQuery, RerankSnapshot } from "./types";

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  if (!env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY 미설정 — fixture 추출은 실 임베딩 키가 필요합니다.",
    );
  }
  const provider = new OpenAIEmbeddingProvider(env.OPENAI_API_KEY);

  // 1) 코퍼스: 현 DB의 PUBLISHED 상품 전체 → buildEmbeddingText → 임베딩.
  const products = await db.product.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { createdAt: "asc" },
    include: {
      tags: true,
      inclusions: true,
      itineraryDays: { include: { stops: true } },
    },
  });
  console.log(`코퍼스 PUBLISHED ${products.length}건 추출 시작…`);

  const corpus: CorpusProduct[] = [];
  for (const p of products) {
    // buildEmbeddingText는 ProductDetail 형태를 요구 — include로 충족.
    const { text } = buildEmbeddingText(
      p as Parameters<typeof buildEmbeddingText>[0],
    );
    const embedding = await provider.embed(text);
    corpus.push({
      title: p.title,
      destination: p.destination,
      summary: p.summary,
      tags: p.tags.map((t) => t.tag),
      basePriceAdult: p.basePriceAdult,
      durationNights: p.durationNights,
      embedding,
    });
    console.log(`  corpus ✓ ${p.title}  [${p.tags.map((t) => t.tag).join(", ")}]`);
  }

  // 2) 쿼리: routeQuery(dev 규칙 추출, 결정론) → cleanedQuery 임베딩.
  const queries: GoldenQuery[] = [];
  for (const c of GOLDEN_QUERIES) {
    const routed = await routeQuery(c.query);
    const embedding = await provider.embed(routed.cleanedQuery);
    queries.push({
      query: c.query,
      cleanedQuery: routed.cleanedQuery,
      themeTags: (routed.themeTags ?? []).map(toStorageTag),
      geoTerms: routed.geoTerms ?? [],
      priceMax: routed.priceMax,
      durationNights: routed.durationNights,
      embedding,
    });
    console.log(
      `  query  ✓ ${c.query}  → clean:"${routed.cleanedQuery}" theme:[${(routed.themeTags ?? []).join(",")}] geo:[${(routed.geoTerms ?? []).join(",")}]`,
    );
  }

  writeFileSync(
    join(here, "corpus.fixture.json"),
    JSON.stringify(corpus, null, 2),
  );
  writeFileSync(
    join(here, "queries.fixture.json"),
    JSON.stringify(queries, null, 2),
  );

  // 3) hard 쿼리: routeQuery → geo·theme 무신호 가드 → 임베딩 박제.
  const hardQueries: GoldenQuery[] = [];
  for (const h of HARD_QUERIES) {
    const routed = await routeQuery(h.query);
    const geo = (routed.geoTerms ?? []).map((t) => t);
    const theme = (routed.themeTags ?? []).map(toStorageTag);
    if (geo.length > 0 || theme.length > 0) {
      throw new Error(
        `hard 쿼리 "${h.query}"가 geo/theme 신호를 가짐 (geo=${geo}, theme=${theme}) — ` +
          "shouldRerank=false가 되어 재정렬 경로를 못 탄다. 쿼리를 재선정하라.",
      );
    }
    const embedding = await provider.embed(routed.cleanedQuery);
    hardQueries.push({
      query: h.query,
      cleanedQuery: routed.cleanedQuery,
      themeTags: theme,
      geoTerms: geo,
      priceMax: routed.priceMax,
      durationNights: routed.durationNights,
      embedding,
    });
    console.log(`  hard   ✓ ${h.query}`);
  }

  // 4) 재정렬 스냅샷: 각 hard 쿼리의 하이브리드 top-8을 실 Haiku로 재정렬.
  const corpusByTitle = new Map(corpus.map((p) => [p.title, p]));
  const rerankSnapshots: RerankSnapshot[] = [];
  for (const hq of hardQueries) {
    const ranked = rankCandidates(corpus, hq); // 운영 가중치 하이브리드
    const head = ranked.slice(0, 8);
    const docs: RerankDoc[] = head.map((r) => {
      const p = corpusByTitle.get(r.title)!;
      return {
        key: p.title, // corpus는 title이 키
        title: p.title,
        destination: p.destination,
        summary: p.summary,
        tags: p.tags,
        price: p.basePriceAdult,
        nights: p.durationNights,
      };
    });
    const rerankedTitles = await requestRerankLive(
      hq.query,
      docs,
      env.ANTHROPIC_API_KEY ?? "",
    );
    rerankSnapshots.push({ query: hq.query, rerankedTitles });
    console.log(`  rerank ✓ ${hq.query}`);
  }

  writeFileSync(
    join(here, "hard-queries.fixture.json"),
    JSON.stringify(hardQueries, null, 2),
  );
  writeFileSync(
    join(here, "rerank.fixture.json"),
    JSON.stringify(rerankSnapshots, null, 2),
  );
  console.log(`\n박제 완료: corpus ${corpus.length} · queries ${queries.length}`);
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e);
    db.$disconnect();
    process.exit(1);
  });
