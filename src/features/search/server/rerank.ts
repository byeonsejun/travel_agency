/**
 * rerank.ts — 조건부 LLM 재정렬 (설계 §4, D2·D3·D4·D5·D7·D10).
 *
 * shouldRerank: geo·theme 모두 빈 순수 추상 의도에만 발동(eval 약점 구간).
 * requestRerankLive: 항상 Haiku 호출(키 주입). 실패 시 원본 key 순서(throw 금지).
 * requestRerank: NODE_ENV≠production은 identity → dev/test 오프라인 결정론.
 * rerankCandidates: top-8만 재정렬, 꼬리 원본 보존. router.ts 강등 철학 동일.
 */
import { z } from "zod";
import { env } from "@/shared/lib/env";
import type { SearchResultCard } from "@/entities/product";
import type { RoutedQuery } from "../model/schemas";
import { applyRerankOrder } from "../model/rerankOrder";

export interface RerankDoc {
  key: string;
  title: string;
  destination: string;
  summary: string;
  tags: string[];
  price: number;
  nights: number;
}

const RERANK_TOP_K = 8;
const RERANK_MODEL = "claude-haiku-4-5-20251001";
const RERANK_TIMEOUT_MS = 3000;

const RerankResponseSchema = z.object({ ids: z.array(z.string()) });

const SYSTEM_PROMPT =
  "너는 여행 검색 결과 재정렬기다. 후보 상품을 사용자 의도에 대한 관련성 순으로 " +
  '재정렬한다. 응답은 JSON만: {"ids":[순서대로 후보 key 배열]}. 모든 입력 key를 ' +
  "정확히 한 번씩 포함하고, 설명·코드블록 금지.";

/** 순수 트리거 — 순수 추상 의도(벡터가 랭킹을 혼자 떠안는 zone)에만 발동. */
export function shouldRerank(routed: RoutedQuery): boolean {
  return !(routed.geoTerms?.length) && !(routed.themeTags?.length);
}

/** 항상 Anthropic 호출(게이트 없음). 실패 시 원본 key 순서(throw 금지, D10). */
export async function requestRerankLive(
  query: string,
  docs: RerankDoc[],
  apiKey: string,
): Promise<string[]> {
  const original = docs.map((d) => d.key);
  if (docs.length === 0) return original;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: RERANK_MODEL,
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: JSON.stringify({ query, candidates: docs }) },
        ],
      }),
      signal: AbortSignal.timeout(RERANK_TIMEOUT_MS),
    });
    if (!res.ok) return original;
    const data: unknown = await res.json();
    const text =
      (data as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? "";
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return original;
    }
    const parsed = RerankResponseSchema.safeParse(raw);
    return parsed.success ? parsed.data.ids : original;
  } catch {
    return original;
  }
}

/** NODE_ENV 게이트: 비-prod는 identity(원본 순서) — 오프라인 결정론(D7). */
export async function requestRerank(
  query: string,
  docs: RerankDoc[],
): Promise<string[]> {
  if (env.NODE_ENV !== "production") return docs.map((d) => d.key);
  return requestRerankLive(query, docs, env.ANTHROPIC_API_KEY ?? "");
}

function toDoc(card: SearchResultCard): RerankDoc {
  return {
    key: card.id,
    title: card.title,
    destination: card.destination,
    summary: card.aiSummary ?? "",
    tags: card.tags.map((t) => t.tag),
    price: card.basePriceAdult,
    nights: card.durationNights,
  };
}

/** top-8을 재정렬, 꼬리(9위~) 원본 순서 보존. 실패 시 전체 원본 순서. */
export async function rerankCandidates(
  query: string,
  candidates: SearchResultCard[],
  topK: number = RERANK_TOP_K,
): Promise<SearchResultCard[]> {
  if (candidates.length <= 1) return candidates;
  const head = candidates.slice(0, topK);
  const tail = candidates.slice(topK);
  const orderedKeys = await requestRerank(query, head.map(toDoc));
  const reorderedHead = applyRerankOrder(head, (c) => c.id, orderedKeys);
  return [...reorderedHead, ...tail];
}
