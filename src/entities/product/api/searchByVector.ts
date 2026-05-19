/**
 * searchByVector.ts — 상품 코사인 벡터 검색 (M-AI-SEARCH spec §5, D2·D3·D4·D5).
 *
 * 상품 데이터 접근은 product 엔티티가 소유한다(Architect D2). features/search는
 * 오케스트레이션만. 코사인 거리는 Prisma 미지원이므로 `$queryRaw`+`Prisma.sql`
 * (getProductList와 동일 패턴, 전 구간 바인딩 파라미터 → 인젝션 차단 R6).
 *
 * 하이브리드 스코어링: 순수 코사인만으로는 dev 가짜 벡터에서 의미 분리가
 * 안 되고(노이즈 ±0.05), 운영에서도 명시적 키워드("일본")가 약하게 묻힌다.
 * → `코사인 유사도 * VECTOR_WEIGHT + ILIKE 일치 * KEYWORD_WEIGHT`로 결합해
 * 정확한 단어 일치는 키워드 점수가, 추상 의도는 벡터 점수가 잡도록 한다.
 *
 * Graceful degradation (D5): pgvector 확장 부재/쿼리 실패 시 ILIKE 키워드
 * 검색으로 폴백한다. 어떤 경우에도 throw하지 않는다(500 금지) — 항상
 * 결과 배열을 반환해 검색 페이지가 렌더되도록 한다.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/shared/lib/db";
import { pickLowestPrice } from "./mapping";
import type { SearchResultCard } from "../model/types";

export interface VectorSearchFilters {
  priceMax?: number;
  durationNights?: { min?: number; max?: number };
  themeTags?: string[];
}

const RESULT_LIMIT = 20;

// 하이브리드 가중치 (합 1.0). 튜닝 용이하도록 상수화.
//  - VECTOR_WEIGHT : 의미적 유사도(추상 의도, 예 "효도 여행") 기여분
//  - KEYWORD_WEIGHT: 명시적 단어 일치(title/destination/summary) 부스트
//  - GEO_WEIGHT    : gazetteer 확장 지리어가 destination에 적중한 부스트
//                    (권역어 "동남아" → 다낭/발리/세부… 정밀 가산)
const VECTOR_WEIGHT = 0.6;
const KEYWORD_WEIGHT = 0.2;
const GEO_WEIGHT = 0.2;

// 부팅 1회 가용성 캐시 (spec §5.1). null = 미확인.
let pgvectorAvailable: boolean | null = null;

/** 테스트 전용 — 가용성 캐시 초기화. */
export function __resetPgvectorCacheForTest(): void {
  pgvectorAvailable = null;
}

async function isPgvectorAvailable(): Promise<boolean> {
  if (pgvectorAvailable !== null) return pgvectorAvailable;
  try {
    const rows = await db.$queryRaw<{ one: number }[]>(
      Prisma.sql`SELECT 1 AS one FROM pg_extension WHERE extname = 'vector'`
    );
    pgvectorAvailable = rows.length > 0;
  } catch {
    pgvectorAvailable = false;
  }
  return pgvectorAvailable;
}

/** 동적 필터를 바인딩 파라미터 Sql 조각으로 조립(인젝션 안전). */
function buildFilterClauses(filters: VectorSearchFilters): Prisma.Sql[] {
  const clauses: Prisma.Sql[] = [];
  if (filters.priceMax !== undefined) {
    clauses.push(Prisma.sql`AND p."basePriceAdult" <= ${filters.priceMax}`);
  }
  const d = filters.durationNights;
  if (d?.min !== undefined) {
    clauses.push(Prisma.sql`AND p."durationNights" >= ${d.min}`);
  }
  if (d?.max !== undefined) {
    // ±1박 허용 — "3박" 단독 쿼리가 4박 상품도 매칭하도록 완화.
    clauses.push(Prisma.sql`AND p."durationNights" <= ${d.max + 1}`);
  }
  if (filters.themeTags && filters.themeTags.length > 0) {
    const tags = filters.themeTags.map((t) =>
      t.startsWith("#") ? t : `#${t}`
    );
    clauses.push(
      Prisma.sql`AND EXISTS (SELECT 1 FROM "ProductTag" t WHERE t."productId" = p.id AND t.tag = ANY(${tags}))`
    );
  }
  return clauses;
}

function joinFilters(clauses: Prisma.Sql[]): Prisma.Sql {
  return clauses.length > 0 ? Prisma.join(clauses, " ") : Prisma.empty;
}

/** gazetteer 확장 지리어 → destination ILIKE ANY 부스트 조각(없으면 0). */
function buildGeoScore(geoTerms: string[]): Prisma.Sql {
  if (geoTerms.length === 0) return Prisma.sql`0`;
  const patterns = geoTerms.map((t) => `%${t}%`);
  return Prisma.sql`(CASE WHEN p.destination ILIKE ANY(${patterns}::text[])
                          THEN ${GEO_WEIGHT} ELSE 0 END)`;
}

type ScoredRow = { id: string; score: number };

/** 검색으로 얻은 id·score를 카드로 보강(순서 보존, lowestPrice 조인). */
async function attachCards(scored: ScoredRow[]): Promise<SearchResultCard[]> {
  if (scored.length === 0) return [];
  const ids = scored.map((r) => r.id);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const products = await db.product.findMany({
    where: { id: { in: ids } },
    include: {
      tags: { select: { tag: true } },
      departures: {
        where: {
          departureDate: { gte: today },
          status: { not: "CANCELED" },
        },
        orderBy: { priceAdult: "asc" },
        take: 1,
        select: { priceAdult: true },
      },
    },
  });

  const scoreById = new Map(scored.map((r) => [r.id, r.score]));
  return ids
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => p != null)
    .map((p) => ({
      id: p.id,
      title: p.title,
      destination: p.destination,
      durationNights: p.durationNights,
      durationDays: p.durationDays,
      heroImageUrl: p.heroImageUrl,
      basePriceAdult: p.basePriceAdult,
      aiSummary: p.aiSummary,
      tags: p.tags,
      lowestPrice: pickLowestPrice(p.departures) ?? undefined,
      score: scoreById.get(p.id),
    }));
}

/**
 * ILIKE 키워드 폴백 (D5). 필터는 동일하게 적용.
 * 권역 쿼리("동남아")는 cleanedQuery로는 0건이므로, gazetteer 확장
 * 지리어를 destination에 OR-매칭해 강등 경로에서도 의미를 유지한다.
 */
async function keywordFallback(
  keywordText: string,
  filters: VectorSearchFilters,
  geoTerms: string[]
): Promise<SearchResultCard[]> {
  const like = `%${keywordText.trim()}%`;
  const geoPredicate =
    geoTerms.length > 0
      ? Prisma.sql`OR p.destination ILIKE ANY(${geoTerms.map(
          (t) => `%${t}%`
        )}::text[])`
      : Prisma.empty;
  const rows = await db.$queryRaw<ScoredRow[]>(Prisma.sql`
    SELECT p.id AS id, 0::float AS score
    FROM "Product" p
    WHERE p.status = 'PUBLISHED'
      AND (p.title ILIKE ${like} OR p.destination ILIKE ${like}
           OR p.summary ILIKE ${like} ${geoPredicate})
      ${joinFilters(buildFilterClauses(filters))}
    ORDER BY p."createdAt" DESC
    LIMIT ${RESULT_LIMIT}
  `);
  return attachCards(rows);
}

/**
 * 코사인 유사도 벡터 검색. modelVersion 불일치 행은 게이트로 제외(D4).
 * 벡터 경로 실패 시 키워드 폴백 → 폴백도 실패 시 빈 배열(절대 throw 안 함).
 */
export async function searchProductsByVector(
  qVec: number[],
  filters: VectorSearchFilters,
  modelVersion: string,
  keywordText: string,
  geoTerms: string[] = []
): Promise<SearchResultCard[]> {
  try {
    if (!(await isPgvectorAvailable())) {
      return await keywordFallback(keywordText, filters, geoTerms);
    }

    const vecLiteral = `[${qVec.join(",")}]`;
    const filterSql = joinFilters(buildFilterClauses(filters));
    const like = `%${keywordText.trim()}%`;
    const geoScore = buildGeoScore(geoTerms);

    // 하이브리드 점수 = 코사인*0.6 + 키워드 일치*0.2 + geo 적중*0.2.
    // 전 구간 바인딩 파라미터(::vector 캐스트 포함) → 인젝션 차단 (R6).
    const rows = await db.$queryRaw<ScoredRow[]>(Prisma.sql`
      SELECT p.id AS id,
        (1 - (e.vector <=> ${vecLiteral}::vector)) * ${VECTOR_WEIGHT}
        + (CASE WHEN p.title ILIKE ${like}
                  OR p.destination ILIKE ${like}
                  OR p.summary ILIKE ${like}
                THEN ${KEYWORD_WEIGHT} ELSE 0 END)
        + ${geoScore} AS score
      FROM "Product" p
      JOIN "ProductEmbedding" e ON e."productId" = p.id
      WHERE p.status = 'PUBLISHED'
        AND e."modelVersion" = ${modelVersion}
        ${filterSql}
      ORDER BY score DESC
      LIMIT ${RESULT_LIMIT}
    `);
    return await attachCards(rows);
  } catch {
    // D5: 사유 불문 벡터 검색 실패 → 500 금지, 키워드 폴백.
    try {
      return await keywordFallback(keywordText, filters, geoTerms);
    } catch {
      return [];
    }
  }
}
