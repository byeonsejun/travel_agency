/**
 * devProvider.ts — 비-프로덕션 결정론적 임베딩 폴백 (spec §3.2).
 *
 * 외부 호출·비용 0. 입력 텍스트를 해시 시드로 의사난수 1536-dim 벡터를
 * 생성하고 L2 정규화한다. 동일 입력 → 항상 동일 벡터이므로 테스트·로컬에서
 * 코사인 검색 파이프라인을 결정론적으로 재현할 수 있다.
 *
 * NO-REAL-MONEY / feedback_dev_external_io 정신: 비-프로덕션은 외부
 * 부작용·비용이 0이어야 한다. 운영 임베딩 의미와는 무관한 "가짜" 벡터지만,
 * 차원·정규화·결정론 계약은 운영 provider와 동일하다.
 */

import { EMBEDDING_DIM, type EmbeddingProvider } from "./types";

/** FNV-1a 32-bit 해시 — 텍스트를 PRNG 시드로 변환 (결정론적). */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — 시드 기반 결정론적 [0,1) 의사난수 생성기. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** L2 정규화 — 단위 벡터로 변환(코사인 거리 전제). norm 0이면 원본 반환. */
function l2normalize(v: number[]): number[] {
  let sumSq = 0;
  for (const x of v) sumSq += x * x;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

export class DeterministicDevProvider implements EmbeddingProvider {
  readonly modelVersion = "dev-deterministic:v1:1536";

  async embed(text: string): Promise<number[]> {
    const rnd = mulberry32(fnv1a(text));
    const vec = new Array<number>(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      vec[i] = rnd() * 2 - 1; // [-1, 1)
    }
    return l2normalize(vec);
  }
}
