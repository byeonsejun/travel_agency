/**
 * queryCatalog.test.ts — 확장 카탈로그 그라운딩 가드 (오프라인, 키·DB·네트워크 0).
 *
 * 1) 각 쿼리를 ruleBasedRoute로 실제 라우팅 → 신호 프로파일로 아키타입을 결정론적
 *    분류 → 선언 archetype과 일치 강제(쿼리가 의도한 차원을 정말 자극하는지).
 * 2) answerability: geo/theme/filter 신호가 코퍼스 속성에 실제 매칭되는지(카탈로그가
 *    답할 수 없는 쿼리 금지). pure-semantic은 의미축이라 judge에 위임.
 * 3) 아키타입 균형 · golden⊆catalog 동기화 · 중복 없음 · 총량.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ruleBasedRoute } from "@/features/search/server/router";
import { toStorageTag } from "@/shared/lib/tags";
import { QUERY_CATALOG, type Archetype } from "../query-catalog";
import { GOLDEN_QUERIES } from "../golden-queries";
import type { CorpusProduct } from "../types";

const here = dirname(fileURLToPath(import.meta.url));
const corpus: CorpusProduct[] = JSON.parse(
  readFileSync(join(here, "..", "corpus.fixture.json"), "utf8"),
);

interface RouteSignals {
  hasGeo: boolean;
  hasTheme: boolean;
  hasFilter: boolean;
  geoTerms: string[];
  themeTags: string[];
  priceMax?: number;
  durationNights?: { min?: number; max?: number };
}

function signalsOf(query: string): RouteSignals {
  const r = ruleBasedRoute(query);
  return {
    hasGeo: (r.geoTerms?.length ?? 0) > 0,
    hasTheme: (r.themeTags?.length ?? 0) > 0,
    hasFilter: r.priceMax !== undefined || r.durationNights !== undefined,
    geoTerms: r.geoTerms ?? [],
    themeTags: r.themeTags ?? [],
    priceMax: r.priceMax,
    durationNights: r.durationNights,
  };
}

/** 신호 프로파일 → 아키타입(query-catalog 설계 분류 규칙). */
function classify(s: RouteSignals): Archetype {
  const count = [s.hasGeo, s.hasTheme, s.hasFilter].filter(Boolean).length;
  if (count === 0) return "pure-semantic";
  if (count >= 2) return "adversarial";
  if (s.hasGeo) return "geo-dominant";
  if (s.hasTheme) return "theme-dominant";
  return "constraint";
}

const geoMatches = (geoTerms: string[]): boolean =>
  corpus.some((p) =>
    geoTerms.some((t) => p.destination.toLowerCase().includes(t.toLowerCase())),
  );

const themeMatches = (themeTags: string[]): boolean => {
  const stored = themeTags.map(toStorageTag);
  return corpus.some((p) => p.tags.some((tag) => stored.includes(tag)));
};

const filterMatches = (s: RouteSignals): boolean =>
  corpus.some((p) => {
    if (s.priceMax !== undefined && p.basePriceAdult > s.priceMax) return false;
    const d = s.durationNights;
    if (d?.min !== undefined && p.durationNights < d.min) return false;
    if (d?.max !== undefined && p.durationNights > d.max + 1) return false;
    return true;
  });

describe("QUERY_CATALOG 그라운딩", () => {
  it.each(QUERY_CATALOG)(
    "[$archetype] $query — 라우팅 분류가 선언 아키타입과 일치",
    (spec) => {
      const s = signalsOf(spec.query);
      expect(classify(s)).toBe(spec.archetype);
    },
  );

  it.each(QUERY_CATALOG)(
    "[$archetype] $query — 활성 신호가 코퍼스에 answerable",
    (spec) => {
      const s = signalsOf(spec.query);
      // 활성 신호 각각이 코퍼스 속성에 실제 매칭(교집합이 비어도 개별 축은 grounded).
      if (s.hasGeo) expect(geoMatches(s.geoTerms)).toBe(true);
      if (s.hasTheme) expect(themeMatches(s.themeTags)).toBe(true);
      if (s.hasFilter) expect(filterMatches(s)).toBe(true);
      // pure-semantic은 구조 신호 0 — answerability는 judge(의미)가 판정.
      if (spec.archetype === "pure-semantic") {
        expect(s.hasGeo || s.hasTheme || s.hasFilter).toBe(false);
      }
    },
  );
});

describe("QUERY_CATALOG 구성", () => {
  it("쿼리 중복 없음", () => {
    const set = new Set(QUERY_CATALOG.map((s) => s.query));
    expect(set.size).toBe(QUERY_CATALOG.length);
  });

  it("총량 40~60건(기존 10 포함)", () => {
    expect(QUERY_CATALOG.length).toBeGreaterThanOrEqual(40);
    expect(QUERY_CATALOG.length).toBeLessThanOrEqual(60);
  });

  it("기존 golden 10건이 모두 카탈로그에 포함(after ⊇ before)", () => {
    const cat = new Set(QUERY_CATALOG.map((s) => s.query));
    for (const g of GOLDEN_QUERIES) expect(cat.has(g.query)).toBe(true);
  });

  it("아키타입별 최소 6건 — 균형 분배", () => {
    const archetypes: Archetype[] = [
      "pure-semantic",
      "geo-dominant",
      "theme-dominant",
      "constraint",
      "adversarial",
    ];
    for (const a of archetypes) {
      const n = QUERY_CATALOG.filter((s) => s.archetype === a).length;
      expect(n, `archetype ${a}`).toBeGreaterThanOrEqual(6);
    }
  });
});
