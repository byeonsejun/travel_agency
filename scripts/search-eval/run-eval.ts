/**
 * run-eval.ts — 검색 가중치 nDCG 평가 러너 (오프라인 결정론).
 *
 *   npm run search:eval            → baseline(운영 가중치) 쿼리별 nDCG@3/@5 + 평균
 *   npm run search:eval -- --sweep → simplex 격자 전수 평가 리더보드 + baseline 순위
 *
 * fixture(corpus/queries) + golden 라벨만 읽음. 네트워크·DB·키 0.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SEARCH_WEIGHTS, type SearchWeights } from "@/entities/product";
import { rankCandidates } from "./scoreReplica";
import { ndcgAtK } from "./ndcg";
import { GOLDEN_QUERIES, type GoldenCase } from "./golden-queries";
import type { CorpusProduct, GoldenQuery } from "./types";

const here = dirname(fileURLToPath(import.meta.url));

function load<T>(file: string): T {
  return JSON.parse(readFileSync(join(here, file), "utf8")) as T;
}

/** 합 1.0인 4-tuple 가중치 격자(simplex). step 0.1 → 286개. */
export function* simplexGrid(step = 0.1): Generator<SearchWeights> {
  const n = Math.round(1 / step);
  for (let v = 0; v <= n; v++) {
    for (let k = 0; k <= n - v; k++) {
      for (let g = 0; g <= n - v - k; g++) {
        const t = n - v - k - g;
        yield {
          vector: +(v * step).toFixed(4),
          keyword: +(k * step).toFixed(4),
          geo: +(g * step).toFixed(4),
          theme: +(t * step).toFixed(4),
        };
      }
    }
  }
}

function relevancesFor(
  corpus: CorpusProduct[],
  q: GoldenQuery,
  labels: Record<string, number>,
  w: SearchWeights,
): number[] {
  return rankCandidates(corpus, q, w).map((r) => labels[r.title] ?? 0);
}

function meanNdcg(
  corpus: CorpusProduct[],
  byText: Map<string, GoldenQuery>,
  cases: GoldenCase[],
  w: SearchWeights,
  k: number,
): number {
  let sum = 0;
  for (const c of cases) {
    const q = byText.get(c.query);
    if (!q) throw new Error(`fixture 누락: "${c.query}" — extract-fixtures 재실행 필요`);
    sum += ndcgAtK(relevancesFor(corpus, q, c.labels, w), k);
  }
  return sum / cases.length;
}

function fmt(w: SearchWeights): string {
  return `v${w.vector} k${w.keyword} g${w.geo} t${w.theme}`;
}

function main(): void {
  const corpus = load<CorpusProduct[]>("corpus.fixture.json");
  const queries = load<GoldenQuery[]>("queries.fixture.json");
  const byText = new Map(queries.map((q) => [q.query, q]));
  const sweep = process.argv.includes("--sweep");

  if (!sweep) {
    console.log("=== baseline (운영 가중치", fmt(SEARCH_WEIGHTS), ") ===\n");
    console.log("쿼리".padEnd(28), "nDCG@3", "nDCG@5");
    for (const c of GOLDEN_QUERIES) {
      const q = byText.get(c.query);
      if (!q) throw new Error(`fixture 누락: "${c.query}"`);
      const n3 = ndcgAtK(relevancesFor(corpus, q, c.labels, SEARCH_WEIGHTS), 3);
      const n5 = ndcgAtK(relevancesFor(corpus, q, c.labels, SEARCH_WEIGHTS), 5);
      console.log(c.query.padEnd(28), n3.toFixed(3), " ", n5.toFixed(3));
    }
    const m3 = meanNdcg(corpus, byText, GOLDEN_QUERIES, SEARCH_WEIGHTS, 3);
    const m5 = meanNdcg(corpus, byText, GOLDEN_QUERIES, SEARCH_WEIGHTS, 5);
    console.log("\nmean nDCG@3:", m3.toFixed(4), " mean nDCG@5:", m5.toFixed(4));
    return;
  }

  // sweep: mean nDCG@5 기준 전수 평가 → 리더보드.
  const scored = [...simplexGrid(0.1)].map((w) => ({
    w,
    m5: meanNdcg(corpus, byText, GOLDEN_QUERIES, w, 5),
  }));
  scored.sort((a, b) => b.m5 - a.m5);

  const baseline = meanNdcg(corpus, byText, GOLDEN_QUERIES, SEARCH_WEIGHTS, 5);
  const rank =
    scored.findIndex(
      (s) =>
        s.w.vector === SEARCH_WEIGHTS.vector &&
        s.w.keyword === SEARCH_WEIGHTS.keyword &&
        s.w.geo === SEARCH_WEIGHTS.geo &&
        s.w.theme === SEARCH_WEIGHTS.theme,
    ) + 1;

  console.log("=== sweep 리더보드 (mean nDCG@5, top 15 / 286) ===\n");
  for (const s of scored.slice(0, 15)) {
    console.log(s.m5.toFixed(4), fmt(s.w));
  }
  console.log(`\n현 운영 가중치 ${fmt(SEARCH_WEIGHTS)} → ${baseline.toFixed(4)} (순위 ${rank}/286)`);
}

main();
