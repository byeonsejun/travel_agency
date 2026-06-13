/**
 * run-eval.ts — 검색 가중치 nDCG 평가 러너 (오프라인 결정론).
 *
 *   npm run search:eval             → baseline(운영 가중치, golden 10) 쿼리별 nDCG@3/@5 + 평균
 *   npm run search:eval -- --sweep  → golden 10 격자 전수 평가 + 스프레드(변별력) + baseline 순위
 *   npm run search:eval -- --catalog→ 확장 카탈로그(judge 라벨) baseline + sweep + 변별력 델타 + 과적합 체크
 *   npm run search:eval -- --rerank → hard slice 재정렬 nDCG@5(hybrid vs reranked)
 *
 * fixture(corpus/queries/judge-labels) 만 읽음. 네트워크·DB·키 0(LLM 미호출).
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SEARCH_WEIGHTS, type SearchWeights } from "@/entities/product";
import { rankCandidates } from "./scoreReplica";
import type { RankedItem } from "./scoreReplica";
import { ndcgAtK } from "./ndcg";
import { GOLDEN_QUERIES } from "./golden-queries";
import { HARD_QUERIES } from "./hard-queries";
import { QUERY_CATALOG } from "./query-catalog";
import { applyRerankOrder } from "@/features/search/model/rerankOrder";
import type {
  CorpusProduct,
  GoldenQuery,
  JudgeLabelSnapshot,
  RerankSnapshot,
} from "./types";

/** 라벨 달린 평가 케이스(golden 수작업 또는 catalog judge 공통 형태). */
export interface LabeledCase {
  query: string;
  labels: Record<string, number>;
}

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

/** 재정렬 스냅샷 title 순서로 하이브리드 후보를 재배열 → 라벨 배열 산출. */
export function rerankRelevances(
  hybrid: RankedItem[],
  rerankedTitles: string[],
  labels: Record<string, number>,
): number[] {
  const reordered = applyRerankOrder(hybrid, (r) => r.title, rerankedTitles);
  return reordered.map((r) => labels[r.title] ?? 0);
}

function relevancesFor(
  corpus: CorpusProduct[],
  q: GoldenQuery,
  labels: Record<string, number>,
  w: SearchWeights,
): number[] {
  return rankCandidates(corpus, q, w).map((r) => labels[r.title] ?? 0);
}

export function meanNdcg(
  corpus: CorpusProduct[],
  byText: Map<string, GoldenQuery>,
  cases: LabeledCase[],
  w: SearchWeights,
  k: number,
): number {
  let sum = 0;
  for (const c of cases) {
    const q = byText.get(c.query);
    if (!q) throw new Error(`fixture 누락: "${c.query}" — 임베딩 추출 재실행 필요`);
    sum += ndcgAtK(relevancesFor(corpus, q, c.labels, w), k);
  }
  return sum / cases.length;
}

/** 동일 가중치 여부(부동소수 직비교 — simplexGrid가 toFixed로 정규화하므로 안전). */
function sameWeights(a: SearchWeights, b: SearchWeights): boolean {
  return (
    a.vector === b.vector &&
    a.keyword === b.keyword &&
    a.geo === b.geo &&
    a.theme === b.theme
  );
}

export interface SweepStats {
  scored: { w: SearchWeights; m5: number }[]; // m5 내림차순
  baseline: number; // 운영 가중치 mean nDCG@5
  rank: number; // 운영 가중치 순위(1-based)
  max: number;
  min: number;
  spread: number; // max - min (변별력 = 격자가 벌어진 폭)
  vectorStarvedInTop: number; // top 동률 그룹 중 vector ≤ 0.1 설정 수(과적합 신호)
}

/** 286 격자 전수 평가 → 변별력 통계. 순수(부작용 0) — 오프라인 테스트 가능. */
export function sweepStats(
  corpus: CorpusProduct[],
  byText: Map<string, GoldenQuery>,
  cases: LabeledCase[],
): SweepStats {
  const scored = [...simplexGrid(0.1)]
    .map((w) => ({ w, m5: meanNdcg(corpus, byText, cases, w, 5) }))
    .sort((a, b) => b.m5 - a.m5);
  const max = scored[0].m5;
  const min = scored[scored.length - 1].m5;
  const baseline = meanNdcg(corpus, byText, cases, SEARCH_WEIGHTS, 5);
  const rank = scored.findIndex((s) => sameWeights(s.w, SEARCH_WEIGHTS)) + 1;
  // 최고점 동률 그룹에서 vector가 0.1 이하인 "벡터 굶긴" 설정 수 — 변별력이
  // 살아있으면 0에 수렴해야 정상(벡터가 의미를 떠안는 쿼리가 페널티를 줌).
  const topTied = scored.filter((s) => Math.abs(s.m5 - max) < 1e-9);
  const vectorStarvedInTop = topTied.filter((s) => s.w.vector <= 0.1).length;
  return { scored, baseline, rank, max, min, spread: max - min, vectorStarvedInTop };
}

function fmt(w: SearchWeights): string {
  return `v${w.vector} k${w.keyword} g${w.geo} t${w.theme}`;
}

function main(): void {
  const corpus = load<CorpusProduct[]>("corpus.fixture.json");
  const queries = load<GoldenQuery[]>("queries.fixture.json");
  const byText = new Map(queries.map((q) => [q.query, q]));
  const sweep = process.argv.includes("--sweep");

  const rerankMode = process.argv.includes("--rerank");
  if (rerankMode) {
    const hardQueries = load<GoldenQuery[]>("hard-queries.fixture.json");
    const snapshots = load<RerankSnapshot[]>("rerank.fixture.json");
    const hardByText = new Map(hardQueries.map((q) => [q.query, q]));
    const snapByText = new Map(snapshots.map((s) => [s.query, s.rerankedTitles]));

    console.log("=== rerank eval (hard slice, nDCG@5 hybrid vs reranked) ===\n");
    console.log("쿼리".padEnd(26), "hybrid", "rerank", "Δ");
    let sumH = 0;
    let sumR = 0;
    for (const h of HARD_QUERIES) {
      const q = hardByText.get(h.query);
      if (!q) throw new Error(`hard fixture 누락: "${h.query}"`);
      const ranked = rankCandidates(corpus, q);
      const head = ranked.slice(0, 8);
      const tail = ranked.slice(8);
      const relH = [...head, ...tail].map((r) => h.labels[r.title] ?? 0);
      const titles = snapByText.get(h.query) ?? head.map((r) => r.title);
      const relR = [...rerankRelevances(head, titles, h.labels),
                    ...tail.map((r) => h.labels[r.title] ?? 0)];
      const nH = ndcgAtK(relH, 5);
      const nR = ndcgAtK(relR, 5);
      sumH += nH;
      sumR += nR;
      const d = nR - nH;
      console.log(
        h.query.padEnd(26),
        nH.toFixed(3), " ", nR.toFixed(3), " ",
        (d >= 0 ? "+" : "") + d.toFixed(3),
      );
    }
    const n = HARD_QUERIES.length;
    console.log(
      `\nmean nDCG@5  hybrid: ${(sumH / n).toFixed(4)}  rerank: ${(sumR / n).toFixed(4)}` +
        `  Δ: ${(sumR / n - sumH / n >= 0 ? "+" : "")}${(sumR / n - sumH / n).toFixed(4)}`,
    );
    return;
  }

  // ── catalog: 확장 셋(judge 라벨) baseline + sweep + 변별력 델타 + 과적합 체크 ──
  if (process.argv.includes("--catalog")) {
    let catQueries: GoldenQuery[];
    let snapshot: JudgeLabelSnapshot;
    try {
      catQueries = load<GoldenQuery[]>("queries.catalog.fixture.json");
      snapshot = load<JudgeLabelSnapshot>("judge-labels.fixture.json");
    } catch {
      throw new Error(
        "카탈로그 fixture 없음 — 먼저 extract-catalog-queries.ts(임베딩) + judge.ts(라벨)를 실행하세요.",
      );
    }
    const catByText = new Map(catQueries.map((q) => [q.query, q]));
    const labelOf = (query: string): Record<string, number> => {
      const l = snapshot.labels[query];
      if (!l) throw new Error(`judge 라벨 누락: "${query}" — judge.ts 재실행`);
      return l;
    };
    const cases: LabeledCase[] = QUERY_CATALOG.map((s) => ({
      query: s.query,
      labels: labelOf(s.query),
    }));

    console.log(
      "=== 확장 카탈로그 baseline (운영 가중치",
      fmt(SEARCH_WEIGHTS),
      `· ${cases.length}건) ===\n`,
    );
    console.log("아키타입별 mean nDCG@5:");
    const byArch = new Map<string, LabeledCase[]>();
    for (const s of QUERY_CATALOG) {
      const arr = byArch.get(s.archetype) ?? [];
      arr.push({ query: s.query, labels: labelOf(s.query) });
      byArch.set(s.archetype, arr);
    }
    for (const [arch, arr] of byArch) {
      const m = meanNdcg(corpus, catByText, arr, SEARCH_WEIGHTS, 5);
      console.log(`  ${arch.padEnd(16)}(${arr.length}건)  ${m.toFixed(4)}`);
    }

    const before = sweepStats(corpus, byText, GOLDEN_QUERIES);
    const after = sweepStats(corpus, catByText, cases);

    console.log("\n=== sweep 리더보드 (catalog, mean nDCG@5, top 10 / 286) ===\n");
    for (const s of after.scored.slice(0, 10)) console.log(s.m5.toFixed(4), fmt(s.w));
    console.log(
      `\n현 운영 가중치 ${fmt(SEARCH_WEIGHTS)} → ${after.baseline.toFixed(4)} (순위 ${after.rank}/286)`,
    );

    console.log("\n=== 변별력 델타 (before: golden10 수작업 → after: catalog judge) ===");
    console.log(
      `  격자 스프레드(max-min):  ${before.spread.toFixed(4)} → ${after.spread.toFixed(4)}` +
        `  (×${(after.spread / (before.spread || 1)).toFixed(1)})`,
    );
    console.log(
      `  max/min:                 ${before.max.toFixed(4)}/${before.min.toFixed(4)}` +
        ` → ${after.max.toFixed(4)}/${after.min.toFixed(4)}`,
    );
    console.log(`  baseline 순위:           ${before.rank}/286 → ${after.rank}/286`);
    console.log(
      `  top 동률 중 vector≤0.1:  ${before.vectorStarvedInTop} → ${after.vectorStarvedInTop}` +
        `  (0 수렴이면 벡터 과적합 해소)`,
    );
    return;
  }

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

  // sweep: mean nDCG@5 기준 전수 평가 → 리더보드 + 변별력(스프레드).
  const stats = sweepStats(corpus, byText, GOLDEN_QUERIES);

  console.log("=== sweep 리더보드 (mean nDCG@5, top 15 / 286) ===\n");
  for (const s of stats.scored.slice(0, 15)) {
    console.log(s.m5.toFixed(4), fmt(s.w));
  }
  console.log(
    `\n현 운영 가중치 ${fmt(SEARCH_WEIGHTS)} → ${stats.baseline.toFixed(4)} (순위 ${stats.rank}/286)`,
  );
  console.log(
    `변별력: 스프레드(max-min) ${stats.spread.toFixed(4)}` +
      `  [max ${stats.max.toFixed(4)} / min ${stats.min.toFixed(4)}]` +
      `  top 동률 vector≤0.1: ${stats.vectorStarvedInTop}`,
  );
}

// 직접 실행(tsx run-eval.ts)일 때만 구동 — import(테스트) 시 stdout 오염 방지.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
