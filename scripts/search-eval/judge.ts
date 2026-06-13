/**
 * judge.ts — LLM-as-judge 라벨 생성 CLI (run-eval과 분리, 무심코 동시 실행 방지).
 *
 *   npm run search:judge              → QUERY_CATALOG 전건을 Haiku로 채점 → judge-labels.fixture.json
 *   npm run search:judge -- --agreement → 기존 10 수작업 라벨 ↔ judge 라벨 일치도 리포트(LLM 미호출)
 *
 * 입력: corpus.fixture.json(속성만, 임베딩 무시) + QUERY_CATALOG. **DB 미사용**.
 * 생성 모드만 ANTHROPIC_API_KEY 필요(비용 발생). --agreement는 스냅샷만 읽어 키 불요.
 *
 * 🛑 반순환: judge는 임베딩/코사인을 보지 않는다(judge-rubric.ts 참조). 스코어 공식과
 *    독립인 라벨이라야 nDCG가 가중치 우열을 정직하게 측정한다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { z } from "zod";
import { env } from "@/shared/lib/env";
import { QUERY_CATALOG } from "./query-catalog";
import { GOLDEN_QUERIES } from "./golden-queries";
import {
  JUDGE_SYSTEM_PROMPT,
  RUBRIC_VERSION,
  buildJudgeUserPayload,
  type JudgeProductView,
} from "./judge-rubric";
import type { CorpusProduct, JudgeLabelSnapshot } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const JUDGE_MODEL = "claude-haiku-4-5-20251001";
const JUDGE_TIMEOUT_MS = 20000;
const LABELS_FILE = "judge-labels.fixture.json";

function load<T>(file: string): T {
  return JSON.parse(readFileSync(join(here, file), "utf8")) as T;
}

/** 코퍼스 title 집합의 결정론적 해시(정렬 후) — 코퍼스 변경 감지용. */
function corpusTitlesHash(titles: string[]): string {
  const sorted = [...titles].sort();
  return createHash("sha256").update(sorted.join("\n")).digest("hex").slice(0, 16);
}

/** Haiku 응답에서 JSON 본문만 추출(코드펜스·잡설 방어 — rerank.ts와 동일 전략). */
function extractJsonObject(text: string): string {
  let s = text.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) s = s.slice(first, last + 1);
  return s;
}

const JudgeResponseSchema = z.object({ labels: z.record(z.string(), z.number()) });

/** 0~3 정수로 정규화 + 0(무관)은 생략(수작업 라벨 컨벤션과 동일, diff 최소화). */
function normalizeLabels(
  raw: Record<string, number>,
  validTitles: Set<string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [title, v] of Object.entries(raw)) {
    if (!validTitles.has(title)) continue; // 환각 title 무시
    const clamped = Math.max(0, Math.min(3, Math.round(v)));
    if (clamped > 0) out[title] = clamped;
  }
  return out;
}

/** 단일 쿼리 채점(1 LLM 호출). 실패 시 throw — 부분 스냅샷 박제 방지. */
async function judgeQuery(
  apiKey: string,
  query: string,
  intent: string,
  products: JudgeProductView[],
): Promise<Record<string, number>> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      max_tokens: 1024,
      temperature: 0,
      system: JUDGE_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: buildJudgeUserPayload(query, intent, products) },
      ],
    }),
    signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`judge HTTP ${res.status} — query="${query}"`);
  }
  const data: unknown = await res.json();
  const text =
    (data as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? "";
  const parsed = JudgeResponseSchema.safeParse(JSON.parse(extractJsonObject(text)));
  if (!parsed.success) {
    throw new Error(`judge JSON 파싱 실패 — query="${query}": ${parsed.error.message}`);
  }
  const validTitles = new Set(products.map((p) => p.title));
  return normalizeLabels(parsed.data.labels, validTitles);
}

/** 생성 모드: 전 카탈로그 채점 → judge-labels.fixture.json 박제. */
async function generate(): Promise<void> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY 미설정 — judge 라벨 생성은 판정 LLM 키가 필요합니다.",
    );
  }
  const corpus = load<CorpusProduct[]>("corpus.fixture.json");
  const productViews: JudgeProductView[] = corpus.map((p) => ({
    title: p.title,
    destination: p.destination,
    tags: p.tags,
    summary: p.summary,
    durationNights: p.durationNights,
    basePriceAdult: p.basePriceAdult,
  }));

  console.log(
    `judge: ${QUERY_CATALOG.length} 쿼리 × ${corpus.length} 상품 채점 (model=${JUDGE_MODEL}, rubric=${RUBRIC_VERSION})\n`,
  );
  const labels: Record<string, Record<string, number>> = {};
  for (const spec of QUERY_CATALOG) {
    const result = await judgeQuery(
      env.ANTHROPIC_API_KEY,
      spec.query,
      spec.intent,
      productViews,
    );
    labels[spec.query] = result;
    const top = Object.entries(result)
      .filter(([, v]) => v === 3)
      .map(([t]) => t);
    console.log(`  ✓ [${spec.archetype}] ${spec.query}  3점:${top.length}건`);
  }

  const snapshot: JudgeLabelSnapshot = {
    meta: {
      model: JUDGE_MODEL,
      rubricVersion: RUBRIC_VERSION,
      generatedAt: new Date().toISOString(),
      corpusTitlesHash: corpusTitlesHash(corpus.map((p) => p.title)),
      queryCount: QUERY_CATALOG.length,
    },
    labels,
  };
  writeFileSync(join(here, LABELS_FILE), JSON.stringify(snapshot, null, 2));
  console.log(`\n박제 완료: ${LABELS_FILE} (${QUERY_CATALOG.length} 쿼리)`);
}

/** 두 라벨맵의 비-0 title 합집합 위에서 일치도 산출. */
function agreementCells(
  hand: Record<string, number>,
  judge: Record<string, number>,
): { exact: number; within1: number; total: number; sumAbs: number } {
  const titles = new Set([...Object.keys(hand), ...Object.keys(judge)]);
  let exact = 0;
  let within1 = 0;
  let sumAbs = 0;
  for (const t of titles) {
    const h = hand[t] ?? 0;
    const j = judge[t] ?? 0;
    const d = Math.abs(h - j);
    if (d === 0) exact++;
    if (d <= 1) within1++;
    sumAbs += d;
  }
  return { exact, within1, total: titles.size, sumAbs };
}

/** --agreement: 기존 수작업 라벨 ↔ judge 라벨 일치도 리포트(LLM 미호출). */
function agreement(): void {
  const snapshot = load<JudgeLabelSnapshot>(LABELS_FILE);
  console.log("=== judge ↔ 수작업 라벨 일치도 (기존 golden 10건) ===");
  console.log(
    `model=${snapshot.meta.model} rubric=${snapshot.meta.rubricVersion} generatedAt=${snapshot.meta.generatedAt}\n`,
  );
  console.log("쿼리".padEnd(28), "cells", "exact", "within1", "meanAbs");

  let tExact = 0;
  let tWithin1 = 0;
  let tTotal = 0;
  let tSumAbs = 0;
  const bigDiffs: { query: string; title: string; hand: number; judge: number }[] = [];
  for (const g of GOLDEN_QUERIES) {
    const judge = snapshot.labels[g.query];
    if (!judge) {
      throw new Error(
        `judge 라벨에 "${g.query}" 없음 — QUERY_CATALOG가 golden 쿼리를 포함하는지 확인(generate 재실행).`,
      );
    }
    const { exact, within1, total, sumAbs } = agreementCells(g.labels, judge);
    tExact += exact;
    tWithin1 += within1;
    tTotal += total;
    tSumAbs += sumAbs;
    // 큰 불일치(|hand-judge| ≥ 2) 셀 수집 — 비-0 합집합 기준.
    const titles = new Set([...Object.keys(g.labels), ...Object.keys(judge)]);
    for (const t of titles) {
      const h = g.labels[t] ?? 0;
      const j = judge[t] ?? 0;
      if (Math.abs(h - j) >= 2) bigDiffs.push({ query: g.query, title: t, hand: h, judge: j });
    }
    console.log(
      g.query.padEnd(28),
      String(total).padStart(5),
      `${((exact / total) * 100).toFixed(0)}%`.padStart(6),
      `${((within1 / total) * 100).toFixed(0)}%`.padStart(7),
      (sumAbs / total).toFixed(2).padStart(7),
    );
  }
  console.log(
    `\n전체  cells:${tTotal}  exact:${((tExact / tTotal) * 100).toFixed(1)}%` +
      `  within1:${((tWithin1 / tTotal) * 100).toFixed(1)}%  meanAbs:${(tSumAbs / tTotal).toFixed(3)}`,
  );

  console.log(`\n=== 큰 불일치 (|수작업-judge| ≥ 2): ${bigDiffs.length}건 ===`);
  if (bigDiffs.length === 0) {
    console.log("  없음 — 모든 셀이 ±1 이내.");
  } else {
    for (const d of bigDiffs) {
      console.log(`  [${d.hand}→${d.judge}] ${d.query}  ·  ${d.title}`);
    }
  }
  console.log(
    "\n해석: within1 80%+ 면 judge가 수작업 의도를 충실히 재현. exact 낮고 within1 높으면",
    "등급 척도 차이(보수성)만 있는 것. 통일 여부는 이 리포트를 보고 사용자가 결정.",
  );
}

function main(): void {
  if (process.argv.includes("--agreement")) {
    agreement();
    return;
  }
  void generate();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export { agreementCells, normalizeLabels, corpusTitlesHash };
