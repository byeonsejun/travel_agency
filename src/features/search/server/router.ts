/**
 * router.ts — 자연어 쿼리 → 구조화 필터 라우터 (spec §4).
 *
 * 분기: **`env.NODE_ENV !== "production"` 한 줄** (feedback_dev_external_io).
 *  - 비-프로덕션: 규칙 기반 추출기. 외부 호출·비용 0, 결정론.
 *  - 프로덕션: Anthropic(Claude Haiku) 구조화 JSON → parseRoutedQuery 폴백.
 *    타임아웃·Zod 파싱·실패 시 cleanedQuery=q 폴백 (Backend R7 / D7).
 *
 * 서버 전용(LLM 키·호출). features → entities/product barrel만 의존.
 */

import { env } from "@/shared/lib/env";
import {
  parseRoutedQuery,
  type RoutedQuery,
} from "../model/schemas";

/** 키워드 → 정규 태그(ProductTag.tag의 '#' 제외 표기) 매핑. */
const THEME_KEYWORDS: Readonly<Record<string, string>> = {
  온천: "온천",
  료칸: "료칸",
  부모님: "부모님",
  효도: "부모님",
  가족: "가족",
  아이: "가족",
  허니문: "허니문",
  신혼: "허니문",
  휴양: "휴양",
  휴양지: "휴양",
  리조트: "리조트",
  풀빌라: "풀빌라",
  유럽: "유럽",
  가성비: "가성비",
  미식: "미식",
  맛집: "미식",
  라멘: "라멘",
  해변: "해변",
  바닷가: "해변",
  설경: "설경",
  노쇼핑: "노쇼핑",
  자유: "자유시간",
  프리미엄: "프리미엄",
  역사: "역사",
  문화: "문화",
  스노클링: "스노클링",
};

const PRICE_RE = /(\d+)\s*만\s*원(?:\s*(?:이하|이내|미만|under))?/g;
const DURATION_RE = /(\d+)\s*박(?:\s*(\d+)\s*일)?/;

/**
 * 규칙 기반 추출기 (비-프로덕션 경로). 금액·기간 토큰은 cleanedQuery에서
 * 제거하고, 신호가 전혀 없으면 cleanedQuery는 원본 q(trim)로 폴백한다.
 */
export function ruleBasedRoute(q: string): RoutedQuery {
  const query = q.trim();

  let priceMax: number | undefined;
  const priceMatch = query.match(/(\d+)\s*만\s*원/);
  if (priceMatch) priceMax = Number(priceMatch[1]) * 10000;

  let durationNights: RoutedQuery["durationNights"];
  const durMatch = query.match(DURATION_RE);
  if (durMatch) {
    const nights = Number(durMatch[1]);
    durationNights = { min: nights, max: nights };
  }

  const tags: string[] = [];
  for (const [keyword, tag] of Object.entries(THEME_KEYWORDS)) {
    if (query.includes(keyword) && !tags.includes(tag)) tags.push(tag);
  }
  const themeTags = tags.length > 0 ? tags : undefined;

  const stripped = query
    .replace(PRICE_RE, " ")
    .replace(/(\d+)\s*박(?:\s*\d+\s*일)?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cleanedQuery = stripped.length > 0 ? stripped : query;

  return { priceMax, durationNights, themeTags, cleanedQuery };
}

const LLM_SYSTEM_PROMPT =
  "너는 여행 검색 쿼리 분석기다. 사용자 한국어 자연어를 JSON으로만 응답한다. " +
  '형식: {"priceMax"?:number(원),"durationNights"?:{"min"?:number,"max"?:number},' +
  '"themeTags"?:string[],"cleanedQuery":string}. ' +
  "cleanedQuery는 임베딩용 정제 문장. 코드블록·설명 금지, JSON만.";

/** 프로덕션 LLM 경로 — 타임아웃·Zod 파싱·실패 폴백 (Backend R7). */
async function llmRoute(q: string): Promise<RoutedQuery> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY ?? "DEV_ONLY",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        system: LLM_SYSTEM_PROMPT,
        messages: [{ role: "user", content: q }],
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return parseRoutedQuery(null, q);
    const data: unknown = await res.json();
    const text =
      (data as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? "";
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = null;
    }
    return parseRoutedQuery(raw, q);
  } catch {
    // 타임아웃·네트워크 오류 등 — 라우터가 깨져도 검색은 항상 가능 (D7).
    return parseRoutedQuery(null, q);
  }
}

export async function routeQuery(q: string): Promise<RoutedQuery> {
  if (env.NODE_ENV !== "production") return ruleBasedRoute(q);
  return llmRoute(q);
}
