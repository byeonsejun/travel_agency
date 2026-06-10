/**
 * tags.ts — 태그 어휘(TAG_VOCABULARY) SSOT + canonical/storage 변환 유틸.
 *
 * 표기 형태 정의:
 *  - canonical : '#' 없는 순수 태그명. 예) "가족"
 *                (THEME_KEYWORDS 값, 라우터 로직, 내부 비교에서 사용)
 *  - storage   : DB ProductTag.tag 컬럼 표기. 접두 '#' 1개. 예) "#가족"
 *                (Prisma 쿼리, seed 데이터에서 사용)
 *  - display   : UI 렌더링용. formatTagLabel(shared/lib/format.ts)이 담당.
 *                이 모듈에서는 display 변환을 제공하지 않는다.
 *
 * 제약:
 *  - THEME_KEYWORDS 값(features/search/server/router.ts)은 반드시
 *    TAG_VOCABULARY 내 항목이어야 한다 (tags.test.ts Guard A 검증).
 *  - seed/themeProducts의 tags 배열(canonical)도 TAG_VOCABULARY 내
 *    항목이어야 한다 (tags.test.ts Guard B 검증).
 */

/** 전체 태그 어휘 — canonical(#없는) 형태로 선언. */
export const TAG_VOCABULARY = [
  "가족", "허니문", "나홀로", "온천", "료칸", "부모님", "휴양", "리조트", "풀빌라",
  "유럽", "가성비", "미식", "라멘", "해변", "설경", "노쇼핑", "자유시간", "프리미엄",
  "역사", "문화", "스노클링", "근거리", "도심", "알프스", "하카타", "해양스포츠", "화이트비치",
] as const;

/** 어휘에 속하는 태그의 타입(좁히기). */
export type CanonicalTag = (typeof TAG_VOCABULARY)[number];

/**
 * canonical/storage 무관 태그 → storage 표기('#' 1개 접두).
 * "가족" → "#가족", "#가족" → "#가족", "##가족" → "#가족".
 */
export function toStorageTag(tag: string): string {
  return `#${tag.replace(/^#+/, "")}`;
}

/**
 * storage/display 표기 → canonical 표기(선행 '#' 모두 제거).
 * "#가족" → "가족", "가족" → "가족".
 */
export function toCanonicalTag(tag: string): string {
  return tag.replace(/^#+/, "");
}
