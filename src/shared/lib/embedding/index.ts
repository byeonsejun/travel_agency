/**
 * embedding barrel — provider 선택 진입점 (spec §3.2, M-AI-SEARCH 하이브리드).
 *
 * 분기 규칙: **`env.NODE_ENV === "production"` 또는 `env.USE_REAL_EMBEDDING`**.
 * 둘 중 하나라도 참이면 실 임베딩(OpenAI)을 쓴다. 그 외(기본 dev)는 외부
 * 비용 0의 결정론 폴백(DeterministicDevProvider) — feedback_dev_external_io.
 *
 * USE_REAL_EMBEDDING은 로컬에서도 진짜 임베딩을 검증할 수 있는 런타임
 * opt-in 스위치다. 키 미설정 시 embed()가 명시적으로 실패한다(잘못된
 * 벡터로 검색을 조용히 오염시키지 않음 — Backend Expert R3 정신).
 */

import { env } from "@/shared/lib/env";
import { EMBEDDING_DIM, type EmbeddingProvider } from "./types";
import { DeterministicDevProvider } from "./devProvider";

export { EMBEDDING_DIM } from "./types";
export type { EmbeddingProvider } from "./types";
export { DeterministicDevProvider } from "./devProvider";

const OPENAI_EMBEDDING_URL = "https://api.openai.com/v1/embeddings";
const OPENAI_MODEL = "text-embedding-3-small"; // 1536-dim

/**
 * OpenAI 실 임베딩 provider. text-embedding-3-small(1536-dim).
 * 키 미설정이면 호출 즉시 명시적 에러 — 가짜/0 벡터로 검색을 오염시키지
 * 않는다. 타임아웃·차원 단언으로 운영 안전성 확보(R4 차원 게이트).
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly modelVersion = "openai:text-embedding-3-small:1536";

  constructor(private readonly apiKey: string | undefined) {}

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error(
        "OPENAI_API_KEY 미설정: USE_REAL_EMBEDDING/production에서 실 임베딩을 " +
          "쓰려면 키가 필요합니다. (dev 기본은 DeterministicDevProvider)"
      );
    }

    const res = await fetch(OPENAI_EMBEDDING_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: OPENAI_MODEL, input: text }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      throw new Error(
        `OpenAI 임베딩 실패: ${res.status} ${res.statusText}`
      );
    }

    const data: unknown = await res.json();
    const vec = (data as { data?: Array<{ embedding?: number[] }> }).data?.[0]
      ?.embedding;

    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
      throw new Error(
        `OpenAI 임베딩 차원 불일치: ${vec?.length ?? "none"} (기대 ${EMBEDDING_DIM})`
      );
    }
    return vec;
  }
}

export function getEmbeddingProvider(): EmbeddingProvider {
  if (env.NODE_ENV === "production" || env.USE_REAL_EMBEDDING) {
    return new OpenAIEmbeddingProvider(env.OPENAI_API_KEY);
  }
  return new DeterministicDevProvider();
}
