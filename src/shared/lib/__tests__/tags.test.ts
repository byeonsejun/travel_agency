/**
 * tags.test.ts — TAG_VOCABULARY SSOT + '#' 변환기 단위 테스트.
 *
 * Task 1: toStorageTag / toCanonicalTag 계약 + 어휘 무결성.
 * Task 4: drift guards (vocab ⊇ keywords + seed tags) + theme card 회귀.
 */

import { describe, it, expect } from "vitest";
import {
  TAG_VOCABULARY,
  toStorageTag,
  toCanonicalTag,
  type CanonicalTag,
} from "../tags";

// ── Task 1: 변환기 계약 ─────────────────────────────────────────

describe("toStorageTag — '#' 정규화 (storage 표기)", () => {
  it("선행 '#' 없는 태그에 '#'를 붙인다", () => {
    expect(toStorageTag("가족")).toBe("#가족");
  });

  it("이미 '#'가 1개면 그대로 반환한다", () => {
    expect(toStorageTag("#가족")).toBe("#가족");
  });

  it("'##'처럼 중복 '#'도 정확히 1개로 정규화한다", () => {
    expect(toStorageTag("##가족")).toBe("#가족");
  });
});

describe("toCanonicalTag — '#' 제거 (canonical 표기)", () => {
  it("선행 '#'를 제거한다", () => {
    expect(toCanonicalTag("#가족")).toBe("가족");
  });

  it("이미 '#' 없으면 그대로 반환한다", () => {
    expect(toCanonicalTag("가족")).toBe("가족");
  });
});

// ── Task 1: TAG_VOCABULARY 무결성 ────────────────────────────────

describe("TAG_VOCABULARY 무결성", () => {
  it("중복 항목이 없다", () => {
    const deduped = new Set(TAG_VOCABULARY);
    expect(deduped.size).toBe(TAG_VOCABULARY.length);
  });

  it("모든 항목이 선행 '#' 없는 canonical 형태다", () => {
    for (const tag of TAG_VOCABULARY) {
      expect(tag.startsWith("#")).toBe(false);
    }
  });

  it("필수 태그 5종이 포함된다", () => {
    const required: CanonicalTag[] = ["가족", "허니문", "나홀로", "근거리", "도심"];
    for (const tag of required) {
      expect(TAG_VOCABULARY).toContain(tag);
    }
  });
});
