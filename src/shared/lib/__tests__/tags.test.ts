/**
 * tags.test.ts — TAG_VOCABULARY SSOT + '#' 변환기 단위 테스트.
 *
 * Task 1: toStorageTag / toCanonicalTag 계약 + 어휘 무결성.
 * Task 4: drift guards (vocab ⊇ keywords + seed tags) + theme card 회귀.
 */

import { describe, it, expect, vi } from "vitest";
import {
  TAG_VOCABULARY,
  toStorageTag,
  toCanonicalTag,
  type CanonicalTag,
} from "../tags";

// router가 env를 모듈 로드 시점에 파싱하므로 mock을 hoist(vi.mock은 자동 hoisted).
vi.mock("@/shared/lib/env", () => ({
  env: { NODE_ENV: "test", ANTHROPIC_API_KEY: undefined },
}));

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

  it("빈 문자열 → '#'", () => expect(toStorageTag("")).toBe("#"));
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

// ── Task 4: drift guards ─────────────────────────────────────────

import { THEME_KEYWORDS, routeQuery } from "@/features/search/server/router";
import { buildThemeProducts } from "../../../../prisma/themeProducts";

describe("Guard A — THEME_KEYWORDS 값 ⊆ TAG_VOCABULARY", () => {
  it("모든 THEME_KEYWORDS 값이 TAG_VOCABULARY에 존재한다", () => {
    for (const canonicalTag of Object.values(THEME_KEYWORDS)) {
      expect(TAG_VOCABULARY).toContain(canonicalTag);
    }
  });
});

describe("Guard B — seed(buildThemeProducts) 태그 ⊆ TAG_VOCABULARY", () => {
  it("buildThemeProducts가 사용하는 모든 태그가 TAG_VOCABULARY에 존재한다", () => {
    const today = new Date();
    const products = buildThemeProducts(today);

    for (const product of products) {
      // tags 는 Prisma nested create: { create: [{ tag: "#가족" }, ...] }
      const tagsInput = (product as { tags?: { create?: Array<{ tag: string }> } }).tags;
      const tagList = tagsInput?.create ?? [];
      for (const { tag } of tagList) {
        const canonical = toCanonicalTag(tag);
        expect(TAG_VOCABULARY).toContain(canonical);
      }
    }
  });
});

describe("theme card 회귀 — routeQuery themeTags 추출", () => {
  it.each(["가족여행", "허니문", "나홀로 여행", "주말 근거리"])(
    "'%s' 쿼리에서 themeTags가 비어있지 않다",
    async (q) => {
      const result = await routeQuery(q);
      expect(result.themeTags).toBeTruthy();
      expect(result.themeTags!.length).toBeGreaterThan(0);
    }
  );
});
