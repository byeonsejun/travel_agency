/**
 * buildEmbeddingText — 상품 데이터를 벡터 임베딩용 텍스트로 직렬화 + SHA-256 해시 산출.
 *
 * 왜 SHA-256인가: 충돌 확률이 무시할 수준으로 낮고, node:crypto 표준 모듈이라
 * 외부 의존성 0. worker가 기존 hash와 비교해 변경된 상품만 재임베딩할 수 있다.
 *
 * 왜 내부 정렬인가: DB/ORM이 배열 반환 순서를 보장하지 않으므로,
 * 순서 차이로 인한 spurious hash 변경을 방지하기 위해 항상 정렬 후 직렬화한다.
 */

import { createHash } from "node:crypto";
import type { ProductDetail } from "../model/types";

// ──────────────────────────────────────────────
// 내부 헬퍼: 공백 정규화
// ──────────────────────────────────────────────

/** 앞뒤 공백 제거 + 내부 연속 공백을 단일 공백으로 축소. */
function normalizeWhitespace(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

// ──────────────────────────────────────────────
// 내부 헬퍼: 각 컬렉션을 정렬된 텍스트 청크로 변환
// ──────────────────────────────────────────────

function sortedTagLines(tags: ProductDetail["tags"]): string[] {
  return [...tags]
    .toSorted((a, b) => a.tag.localeCompare(b.tag))
    .map((t) => normalizeWhitespace(t.tag));
}

function includedInclusionLines(
  inclusions: ProductDetail["inclusions"]
): string[] {
  return [...inclusions]
    .filter((inc) => inc.kind === "INCLUDED")
    .toSorted((a, b) => a.label.localeCompare(b.label))
    .flatMap((inc) => {
      const parts: string[] = [normalizeWhitespace(inc.label)];
      if (inc.note) parts.push(normalizeWhitespace(inc.note));
      return parts;
    });
}

function itineraryLines(
  itineraryDays: ProductDetail["itineraryDays"]
): string[] {
  return [...itineraryDays]
    .toSorted((a, b) => a.dayNumber - b.dayNumber)
    .flatMap((day) =>
      [...day.stops]
        .toSorted((a, b) => a.order - b.order)
        .flatMap((stop) => {
          const parts: string[] = [normalizeWhitespace(stop.place)];
          if (stop.description) {
            parts.push(normalizeWhitespace(stop.description));
          }
          return parts;
        })
    );
}

// ──────────────────────────────────────────────
// 공개 API
// ──────────────────────────────────────────────

export interface EmbeddingTextResult {
  /** 임베딩 모델에 전달할 합성 텍스트. */
  text: string;
  /** text의 SHA-256 hex digest (소문자 64자). worker의 변경 감지 키. */
  contentHash: string;
}

/**
 * 상품의 전체 관계(태그·포함사항·일정)를 결합해 임베딩용 텍스트와
 * 결정론적 contentHash를 반환한다. 순수 함수 — 부수효과·I/O 없음.
 */
export function buildEmbeddingText(
  product: ProductDetail
): EmbeddingTextResult {
  const chunks: string[] = [
    normalizeWhitespace(product.title),
    normalizeWhitespace(product.summary),
    normalizeWhitespace(product.destination),
    ...sortedTagLines(product.tags),
    ...includedInclusionLines(product.inclusions),
    ...itineraryLines(product.itineraryDays),
  ].filter(Boolean);

  const text = chunks.join(" ");
  const contentHash = createHash("sha256").update(text, "utf8").digest("hex");

  return { text, contentHash };
}
