/**
 * types.ts — 임베딩 provider 추상화 인터페이스 (M-AI-SEARCH spec §3.1).
 *
 * 도메인 무지: 텍스트 → 고정 차원 벡터 변환 계약만 정의한다.
 * 구현체(dev 폴백 / 운영)는 이 인터페이스를 통해서만 교체된다.
 */

/**
 * 임베딩 차원. OpenAI `text-embedding-3-small` 기준이며
 * `ProductEmbedding.vector vector(1536)` 스키마와 일치해야 한다.
 * 모든 provider 구현은 이 길이를 단언(assert)한다 (spec R4 — 차원 불일치 차단).
 */
export const EMBEDDING_DIM = 1536;

export interface EmbeddingProvider {
  /**
   * "{provider}:{model}:{dim}" 식별자 (예: "dev-deterministic:v1:1536").
   * `ProductEmbedding.modelVersion`에 기록되며, 쿼리 시 불일치하면 해당 행을
   * 검색에서 제외한다 (spec §3.3 / D4 스테일 임베딩 게이트).
   */
  readonly modelVersion: string;

  /** 입력 텍스트를 길이 `EMBEDDING_DIM`의 벡터로 변환한다. */
  embed(text: string): Promise<number[]>;
}
