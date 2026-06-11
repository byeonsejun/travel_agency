/**
 * scoreReplica.ts — searchByVector SQL 하이브리드 공식의 순수 TS 미러.
 *
 * SQL(entities/product/api/searchByVector.ts)의 점수식을 1:1 복제:
 *   score = cosine×W.vector + keyword×W.keyword + geo×W.geo + themeBoost(...,W.theme)
 * 가중치·themeBoost는 entities/product SSOT를 재사용(drift 차단).
 *
 * ⚠️ SQL 공식을 바꾸면 여기도 갱신할 것. drift 가드는 scoreReplica.test.ts.
 */
import { SEARCH_WEIGHTS, themeBoost, type SearchWeights } from "@/entities/product";
import type { CorpusProduct, GoldenQuery } from "./types";

/** 코사인 유사도 = dot / (‖a‖·‖b‖). 정규화 가정하지 않음(SQL 1-(v<=>q) 동치). */
export function cosineSim(a: number[], b: number[]): number {
  // 차원 불일치는 조용한 NaN 전파 대신 즉시 실패 — fixture 손상 조기 발견.
  if (a.length !== b.length) {
    throw new Error(`cosineSim 차원 불일치: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** title|destination|summary 중 하나라도 cleanedQuery 부분일치(ILIKE 복제). */
function matchesKeyword(p: CorpusProduct, cleanedQuery: string): boolean {
  const kw = cleanedQuery.trim().toLowerCase();
  if (kw.length === 0) return false;
  return [p.title, p.destination, p.summary].some((f) =>
    f.toLowerCase().includes(kw),
  );
}

/** geoTerms 중 하나라도 destination 부분일치(ILIKE ANY 복제). */
function matchesGeo(p: CorpusProduct, geoTerms: string[]): boolean {
  const dest = p.destination.toLowerCase();
  return geoTerms.some((t) => dest.includes(t.toLowerCase()));
}

/** price/duration hard filter (SQL WHERE 미러, duration은 max+1박 허용). */
function passesFilters(p: CorpusProduct, q: GoldenQuery): boolean {
  if (q.priceMax !== undefined && p.basePriceAdult > q.priceMax) return false;
  const d = q.durationNights;
  if (d?.min !== undefined && p.durationNights < d.min) return false;
  if (d?.max !== undefined && p.durationNights > d.max + 1) return false;
  return true;
}

/** 단일 후보 하이브리드 점수. */
export function scoreCandidate(
  p: CorpusProduct,
  q: GoldenQuery,
  w: SearchWeights,
): number {
  const vec = cosineSim(q.embedding, p.embedding) * w.vector;
  const kw = matchesKeyword(p, q.cleanedQuery) ? w.keyword : 0;
  const geo = matchesGeo(p, q.geoTerms) ? w.geo : 0;
  const matchCount = q.themeTags.filter((t) => p.tags.includes(t)).length;
  const theme = themeBoost(matchCount, q.themeTags.length, w.theme);
  return vec + kw + geo + theme;
}

export interface RankedItem {
  title: string;
  score: number;
}

/** 필터 통과 후보를 점수 내림차순 랭킹. */
export function rankCandidates(
  corpus: CorpusProduct[],
  q: GoldenQuery,
  w: SearchWeights = SEARCH_WEIGHTS,
): RankedItem[] {
  return corpus
    .filter((p) => passesFilters(p, q))
    .map((p) => ({ title: p.title, score: scoreCandidate(p, q, w) }))
    .sort((a, b) => b.score - a.score);
}
