/**
 * embedding.test.ts — 임베딩 provider 추상화 단위 테스트 (M-AI-SEARCH Task 2)
 *
 * 검증 축 (spec §3):
 *  1. DeterministicDevProvider — 동일 입력 = 동일 벡터(결정론, 외부호출 0)
 *  2. 서로 다른 입력 = 다른 벡터 (해시 시드 분산)
 *  3. 차원 1536 단언 (R4 — provider 교체 시 차원 불일치 차단)
 *  4. L2 정규화 — ||v|| ≈ 1 (코사인 거리 전제)
 *  5. modelVersion 포맷 "{provider}:{model}:{dim}" (spec §3.3, D4 게이트 키)
 *  6. getEmbeddingProvider() — 비-프로덕션(NODE_ENV=test)은 dev 폴백 반환
 *     (외부 비용 0 — feedback_dev_external_io / NO-REAL-MONEY 정신)
 */

import { describe, it, expect, vi } from "vitest";

// env.ts는 import 시점에 process.env를 파싱하므로(부팅 fail-fast),
// 테스트에서는 비-프로덕션 환경만 모킹한다 (webhook.test.ts와 동일 패턴).
vi.mock("@/shared/lib/env", () => ({
  env: { NODE_ENV: "test", ANTHROPIC_API_KEY: undefined },
}));

import { EMBEDDING_DIM } from "../types";
import { DeterministicDevProvider } from "../devProvider";
import { getEmbeddingProvider } from "../index";

function l2norm(v: number[]): number {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

describe("DeterministicDevProvider — 결정론", () => {
  it("동일 입력은 항상 동일 벡터를 만든다", async () => {
    const p = new DeterministicDevProvider();
    const a = await p.embed("부모님 온천 3박 여행");
    const b = await p.embed("부모님 온천 3박 여행");
    expect(a).toEqual(b);
  });

  it("서로 다른 입력은 다른 벡터를 만든다", async () => {
    const p = new DeterministicDevProvider();
    const a = await p.embed("오사카 가족 여행");
    const b = await p.embed("방콕 자유여행");
    expect(a).not.toEqual(b);
  });

  it("빈 문자열도 결정론적으로 처리한다", async () => {
    const p = new DeterministicDevProvider();
    const a = await p.embed("");
    const b = await p.embed("");
    expect(a).toEqual(b);
    expect(a).toHaveLength(EMBEDDING_DIM);
  });
});

describe("DeterministicDevProvider — 차원 & 정규화", () => {
  it("벡터 길이는 정확히 1536이다", async () => {
    const p = new DeterministicDevProvider();
    const v = await p.embed("test");
    expect(v).toHaveLength(EMBEDDING_DIM);
    expect(EMBEDDING_DIM).toBe(1536);
  });

  it("L2 정규화되어 단위 벡터(norm ≈ 1)이다", async () => {
    const p = new DeterministicDevProvider();
    const v = await p.embed("크리스마스 유럽 일주");
    expect(l2norm(v)).toBeCloseTo(1, 9);
  });

  it("모든 성분이 유한수(NaN/Infinity 없음)이다", async () => {
    const p = new DeterministicDevProvider();
    const v = await p.embed("セブ島 ダイビング");
    expect(v.every((x) => Number.isFinite(x))).toBe(true);
  });
});

describe("DeterministicDevProvider — modelVersion", () => {
  it("'{provider}:{model}:{dim}' 포맷이며 dim이 1536이다", () => {
    const p = new DeterministicDevProvider();
    const parts = p.modelVersion.split(":");
    expect(parts).toHaveLength(3);
    expect(parts[2]).toBe(String(EMBEDDING_DIM));
  });
});

describe("getEmbeddingProvider — NODE_ENV 분기", () => {
  it("비-프로덕션(테스트 환경)에서는 결정론적 dev 폴백을 반환한다", async () => {
    const provider = getEmbeddingProvider();
    expect(provider).toBeInstanceOf(DeterministicDevProvider);
    const v = await provider.embed("hello");
    expect(v).toHaveLength(EMBEDDING_DIM);
  });
});
