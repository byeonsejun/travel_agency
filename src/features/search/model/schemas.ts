/**
 * schemas.ts — 검색 입력·라우팅 결과 Zod 스키마 (spec §4.1 / D7).
 *
 * 외부 입력(searchParams)과 LLM 출력(라우팅 결과)을 경계에서 파싱한다.
 * LLM은 비결정적이고 악성 입력이 섞일 수 있으므로, 필드 단위 `.catch`로
 * 손상 필터는 버리고(무필터), 전체 파싱 실패 시에는 cleanedQuery=q로
 * 폴백해 **항상 검색이 가능**하도록 한다.
 */

import { z } from "zod";

export const SearchParamsSchema = z.object({
  q: z
    .string()
    .trim()
    .min(1, "검색어를 입력하세요")
    .max(200, "검색어가 너무 깁니다"),
});
export type SearchParams = z.infer<typeof SearchParamsSchema>;

export const RoutedQuerySchema = z.object({
  // "20만원 이하" → 200000. 잘못된 값은 필터 미적용으로 강등(.catch).
  priceMax: z.number().int().positive().optional().catch(undefined),
  durationNights: z
    .object({
      min: z.number().int().nonnegative().optional(),
      max: z.number().int().nonnegative().optional(),
    })
    .optional()
    .catch(undefined),
  themeTags: z.array(z.string().min(1)).optional().catch(undefined),
  // 지리어를 destination 매칭용 하위 토큰으로 펼친 집합(gazetteer 확장).
  // 손상 시 무필터 강등(.catch) — geo 부스트만 비활성, 검색은 계속.
  geoTerms: z.array(z.string().min(1)).optional().catch(undefined),
  cleanedQuery: z.string().trim().min(1),
});
export type RoutedQuery = z.infer<typeof RoutedQuerySchema>;

/**
 * 라우팅 결과(raw, 보통 LLM JSON)를 파싱한다.
 * 전체 파싱 실패 시 필터 없이 `cleanedQuery = q.trim()`로 폴백 —
 * 라우터가 깨져도 임베딩 검색 자체는 항상 수행 가능 (D7).
 */
export function parseRoutedQuery(raw: unknown, q: string): RoutedQuery {
  const parsed = RoutedQuerySchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return { cleanedQuery: q.trim() };
}
