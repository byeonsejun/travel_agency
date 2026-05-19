/**
 * embedding barrel — provider 선택 진입점 (spec §3.2).
 *
 * 분기 규칙: **`env.NODE_ENV !== "production"` 한 줄**로만 분기한다.
 * API 키 존재 여부로 분기하지 않는다 (과거 Resend 사고 재발 방지 —
 * feedback_dev_external_io). 비-프로덕션은 외부 비용 0의 결정론 폴백.
 *
 * 운영 임베딩 provider 실연동은 본 spec 비범위(운영 키 필요 — no-prod
 * 범위 밖). 운영 경로는 인스턴스화는 안전하되, 호출 시 미구성임을 명시적
 * 에러로 알린다(조용한 오작동 금지). 키 placeholder는 `?? "DEV_ONLY"`로
 * 인스턴스화 단계를 방어한다.
 */

import { env } from "@/shared/lib/env";
import type { EmbeddingProvider } from "./types";
import { DeterministicDevProvider } from "./devProvider";

export { EMBEDDING_DIM } from "./types";
export type { EmbeddingProvider } from "./types";
export { DeterministicDevProvider } from "./devProvider";

/**
 * 운영 provider 자리표시자. 실연동(OpenAI 등)은 spec 비범위이므로
 * 호출 시 명시적으로 미구성을 알린다 — 잘못된 벡터로 조용히 검색을
 * 오염시키지 않는다 (Backend Expert R3-2 정신).
 */
class UnconfiguredRemoteProvider implements EmbeddingProvider {
  readonly modelVersion = "unconfigured:none:1536";

  constructor(private readonly apiKey: string) {}

  async embed(_text: string): Promise<number[]> {
    throw new Error(
      `운영 임베딩 provider 미구성(key=${this.apiKey.slice(0, 3)}…): ` +
        "실연동은 현재 spec 비범위입니다(no-prod). " +
        "비-프로덕션에서는 DeterministicDevProvider가 동작합니다."
    );
  }
}

export function getEmbeddingProvider(): EmbeddingProvider {
  if (env.NODE_ENV !== "production") return new DeterministicDevProvider();
  return new UnconfiguredRemoteProvider(env.ANTHROPIC_API_KEY ?? "DEV_ONLY");
}
