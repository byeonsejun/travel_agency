# Agentic Search + LLM Re-ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 단일 쇼트 검색을 (1) 빈 차원을 좁히는 Clarifying Chips, (2) 추상 쿼리에만 발동하는 조건부 LLM Re-ranking으로 확장하고, (3) nDCG eval 하네스로 재정렬 전/후 품질을 정량 입증한다.

**Architecture:** 기존 stateless·RSC 파이프라인(`features/search/server/search.ts`)을 보존하고 그 안에 두 단계를 끼운다 — `shouldRerank`(순수 트리거)가 참이면 Haiku로 top-8 재정렬, 항상 `buildClarifyingChips`(순수)로 빈 차원 칩 생성. 재정렬은 비-prod에서 identity(오프라인 결정론), 실 재정렬 순서는 `rerank.fixture.json`으로 박제해 eval은 키 없이 결정론 유지. 모든 외부 호출은 실패 시 원본 순서로 강등(throw 금지).

**Tech Stack:** TypeScript, Next.js 15 RSC, Zod, Claude Haiku(`claude-haiku-4-5-20251001`, raw fetch), Vitest, tsx(eval 스크립트), OpenAI 임베딩(fixture 추출 1회).

**참조 스펙:** `docs/superpowers/specs/2026-06-11-agentic-search-rerank-design.md`

---

## File Structure

```
src/features/search/
  model/clarifyingChips.ts            # 신규 순수 — buildClarifyingChips + ClarifyingChip — Task 1
  model/__tests__/clarifyingChips.test.ts                                   — Task 1
  model/rerankOrder.ts                # 신규 순수 — applyRerankOrder<T> 순열 가드 — Task 2
  model/__tests__/rerankOrder.test.ts                                       — Task 2
  server/rerank.ts                    # 신규 서버 — shouldRerank/requestRerank(Live)/rerankCandidates — Task 3
  server/__tests__/rerank.test.ts                                           — Task 3
  ui/ClarifyingChips.tsx              # 신규 'use client' — 칩 렌더 + router.push — Task 4
  index.ts                            # 수정 — 배럴 re-export — Task 4
  server/search.ts                    # 수정 — {results,chips} + 조건부 rerank + cache v2 — Task 5
  server/__tests__/search.test.ts     # 수정 — 새 반환 shape — Task 5

src/app/(site)/search/page.tsx        # 수정 — 칩 렌더 + 구조분해 — Task 5

scripts/search-eval/
  types.ts                            # 수정 — RerankSnapshot — Task 6
  hard-queries.ts                     # 신규 — 추상 15쿼리 + 라벨 — Task 6
  extract-fixtures.ts                 # 수정 — hard + rerank fixture 추출 — Task 7
  hard-queries.fixture.json           # 신규 박제(추출 산출) — Task 7
  rerank.fixture.json                 # 신규 박제(재정렬 순서) — Task 7
  run-eval.ts                         # 수정 — --rerank 모드 — Task 8
  __tests__/rerankEval.test.ts        # 신규 — apply+nDCG 델타 — Task 8
```

---

## Task 1: Clarifying Chips 순수 모듈

빈 차원(price/duration/theme)을 감지해 좁히기 칩을 만드는 순수 함수. dev/prod 무관 결정론(`nextSortUrl` 선례).

**Files:**
- Create: `src/features/search/model/clarifyingChips.ts`
- Create: `src/features/search/model/__tests__/clarifyingChips.test.ts`

- [x] **Step 1: 실패 테스트 작성**

```ts
// src/features/search/model/__tests__/clarifyingChips.test.ts
import { describe, it, expect } from "vitest";
import { buildClarifyingChips } from "../clarifyingChips";
import type { RoutedQuery } from "../schemas";

const base: RoutedQuery = { cleanedQuery: "x" };

describe("buildClarifyingChips", () => {
  it("price·duration 미지정이면 예산·기간 칩을 제안한다", () => {
    const routed: RoutedQuery = { ...base, geoTerms: ["오사카"], themeTags: ["가족"] };
    const chips = buildClarifyingChips(routed, "오사카 가족여행");
    const texts = chips.map((c) => c.appendText);
    expect(texts).toContain("100만원");
    expect(texts).toContain("3박4일");
    expect(chips.length).toBeLessThanOrEqual(4);
  });

  it("이미 themeTags에 있는 테마는 칩으로 다시 제안하지 않는다", () => {
    const routed: RoutedQuery = { ...base, themeTags: ["온천"] };
    const chips = buildClarifyingChips(routed, "도쿄 여행 온천");
    expect(chips.map((c) => c.appendText)).not.toContain("온천");
  });

  it("쿼리에 이미 들어있는 토큰은 중복 제외한다", () => {
    const routed: RoutedQuery = { ...base };
    const chips = buildClarifyingChips(routed, "여행 100만원");
    expect(chips.map((c) => c.appendText)).not.toContain("100만원");
  });

  it("price·duration·theme가 모두 특정되면 빈 배열(완전 특정)", () => {
    const routed: RoutedQuery = {
      ...base,
      priceMax: 1000000,
      durationNights: { min: 3, max: 3 },
      themeTags: ["온천"],
    };
    expect(buildClarifyingChips(routed, "도쿄 온천 100만원 3박4일")).toEqual([]);
  });

  it("ClarifyingChip는 label과 appendText를 가진다", () => {
    const chips = buildClarifyingChips(base, "여행");
    for (const c of chips) {
      expect(typeof c.label).toBe("string");
      expect(typeof c.appendText).toBe("string");
    }
  });
});
```

- [x] **Step 2: 테스트 FAIL 확인**

Run: `npx vitest run src/features/search/model/__tests__/clarifyingChips.test.ts`
Expected: FAIL — `Cannot find module '../clarifyingChips'`.

- [x] **Step 3: clarifyingChips.ts 구현**

```ts
// src/features/search/model/clarifyingChips.ts
/**
 * clarifyingChips.ts — 라우터가 추출한 빈 차원(price/duration/theme)에서
 * "좁히기" 칩을 파생하는 순수 함수 (설계 §3, D9). dev/prod 무관 결정론.
 *
 * 칩 클릭 = appendText를 쿼리에 덧붙여 재검색 → ?q= 누적(대화 상태=URL).
 */
import type { RoutedQuery } from "./schemas";

export interface ClarifyingChip {
  label: string;       // 표시 텍스트
  appendText: string;  // 쿼리에 덧붙일 토큰(라우터가 재파싱)
}

const PRICE_CHIP: ClarifyingChip = { label: "100만원 이하", appendText: "100만원" };
const DURATION_CHIPS: ClarifyingChip[] = [
  { label: "3박4일", appendText: "3박4일" },
  { label: "4박5일", appendText: "4박5일" },
];
// 인기 세부테마 풀(라우터 THEME_KEYWORDS의 정규 태그와 동일 표기).
const THEME_CHIPS: ClarifyingChip[] = [
  { label: "온천", appendText: "온천" },
  { label: "가족", appendText: "가족" },
  { label: "미식", appendText: "미식" },
  { label: "휴양", appendText: "휴양" },
  { label: "가성비", appendText: "가성비" },
];
const MAX_CHIPS = 4;

export function buildClarifyingChips(
  routed: RoutedQuery,
  query: string,
): ClarifyingChip[] {
  const fullySpecified =
    routed.priceMax !== undefined &&
    routed.durationNights !== undefined &&
    (routed.themeTags?.length ?? 0) > 0;
  if (fullySpecified) return [];

  const candidates: ClarifyingChip[] = [];
  if (routed.priceMax === undefined) candidates.push(PRICE_CHIP);
  if (routed.durationNights === undefined) candidates.push(...DURATION_CHIPS);
  const present = new Set(routed.themeTags ?? []);
  for (const chip of THEME_CHIPS) {
    if (!present.has(chip.appendText)) candidates.push(chip);
  }

  // 쿼리에 이미 있는 토큰 제외 + 중복 제거 + 상한.
  const seen = new Set<string>();
  const result: ClarifyingChip[] = [];
  for (const chip of candidates) {
    if (query.includes(chip.appendText) || seen.has(chip.appendText)) continue;
    seen.add(chip.appendText);
    result.push(chip);
    if (result.length >= MAX_CHIPS) break;
  }
  return result;
}
```

- [x] **Step 4: 테스트 PASS 확인**

Run: `npx vitest run src/features/search/model/__tests__/clarifyingChips.test.ts`
Expected: PASS (5 케이스).

- [x] **Step 5: 커밋**

```bash
git add src/features/search/model/clarifyingChips.ts src/features/search/model/__tests__/clarifyingChips.test.ts
git commit -m "feat(search): clarifying chips from unfilled query dimensions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 재정렬 순열 가드 순수 모듈

LLM이 반환한 key 순서로 항목을 재배열하되 환각 key는 폐기, 누락 key는 원래 순서로 보존하는 제네릭 순수 함수. 운영 재정렬과 eval 양쪽이 재사용(DRY).

**Files:**
- Create: `src/features/search/model/rerankOrder.ts`
- Create: `src/features/search/model/__tests__/rerankOrder.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/features/search/model/__tests__/rerankOrder.test.ts
import { describe, it, expect } from "vitest";
import { applyRerankOrder } from "../rerankOrder";

const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
const keyOf = (x: { id: string }) => x.id;

describe("applyRerankOrder", () => {
  it("주어진 순서대로 재배열한다", () => {
    const r = applyRerankOrder(items, keyOf, ["c", "a", "b"]);
    expect(r.map(keyOf)).toEqual(["c", "a", "b"]);
  });

  it("환각 key(입력에 없는)는 폐기한다", () => {
    const r = applyRerankOrder(items, keyOf, ["c", "zzz", "a", "b"]);
    expect(r.map(keyOf)).toEqual(["c", "a", "b"]);
  });

  it("누락된 key는 원래 순서로 뒤에 append한다", () => {
    const r = applyRerankOrder(items, keyOf, ["c"]);
    expect(r.map(keyOf)).toEqual(["c", "a", "b"]);
  });

  it("중복 key는 한 번만 사용한다", () => {
    const r = applyRerankOrder(items, keyOf, ["a", "a", "b"]);
    expect(r.map(keyOf)).toEqual(["a", "b", "c"]);
  });

  it("항상 입력과 동일한 길이를 유지한다(보존성)", () => {
    expect(applyRerankOrder(items, keyOf, []).length).toBe(3);
    expect(applyRerankOrder(items, keyOf, ["x", "y"]).length).toBe(3);
  });
});
```

- [ ] **Step 2: 테스트 FAIL 확인**

Run: `npx vitest run src/features/search/model/__tests__/rerankOrder.test.ts`
Expected: FAIL — `Cannot find module '../rerankOrder'`.

- [ ] **Step 3: rerankOrder.ts 구현**

```ts
// src/features/search/model/rerankOrder.ts
/**
 * rerankOrder.ts — 재정렬 순열 가드 (순수, 설계 §4.1).
 *
 * LLM이 반환한 key 순서로 items를 재배열한다:
 *  - 환각 key(입력에 없음) → 폐기
 *  - 누락 key(LLM이 빠뜨림) → 원래 순서로 뒤에 append
 *  - 중복 key → 첫 등장만
 * 결과 길이는 항상 입력과 동일(정보 손실 0). 운영 rerank·eval 양쪽 재사용.
 */
export function applyRerankOrder<T>(
  items: T[],
  keyOf: (item: T) => string,
  orderedKeys: string[],
): T[] {
  const byKey = new Map(items.map((it) => [keyOf(it), it]));
  const seen = new Set<string>();
  const ordered: T[] = [];
  for (const key of orderedKeys) {
    const it = byKey.get(key);
    if (it !== undefined && !seen.has(key)) {
      ordered.push(it);
      seen.add(key);
    }
  }
  for (const it of items) {
    if (!seen.has(keyOf(it))) ordered.push(it);
  }
  return ordered;
}
```

- [ ] **Step 4: 테스트 PASS 확인**

Run: `npx vitest run src/features/search/model/__tests__/rerankOrder.test.ts`
Expected: PASS (5 케이스).

- [ ] **Step 5: 커밋**

```bash
git add src/features/search/model/rerankOrder.ts src/features/search/model/__tests__/rerankOrder.test.ts
git commit -m "feat(search): pure rerank permutation guard (applyRerankOrder)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 재정렬 서버 모듈 (트리거 + LLM)

`shouldRerank`(순수 트리거), `requestRerankLive`(항상 Haiku 호출, 실패 시 원본 순서), `requestRerank`(NODE_ENV 게이트), `rerankCandidates`(top-8 재정렬 + 꼬리 보존).

**Files:**
- Create: `src/features/search/server/rerank.ts`
- Create: `src/features/search/server/__tests__/rerank.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/features/search/server/__tests__/rerank.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/shared/lib/env", () => ({
  env: { NODE_ENV: "test", ANTHROPIC_API_KEY: undefined },
}));

import {
  shouldRerank,
  requestRerankLive,
  rerankCandidates,
  type RerankDoc,
} from "../rerank";
import type { RoutedQuery } from "../../model/schemas";
import type { SearchResultCard } from "@/entities/product";

const abstractRouted: RoutedQuery = { cleanedQuery: "조용히 쉬고 싶어" };

function card(id: string): SearchResultCard {
  return {
    id, title: `t-${id}`, destination: "d", durationNights: 3, durationDays: 4,
    heroImageUrl: "h", basePriceAdult: 100, aiSummary: "s", tags: [],
  };
}
const docs: RerankDoc[] = [
  { key: "a", title: "A", destination: "d", summary: "", tags: [], price: 1, nights: 1 },
  { key: "b", title: "B", destination: "d", summary: "", tags: [], price: 1, nights: 1 },
];

describe("shouldRerank", () => {
  it("geo·theme 모두 비면 true(순수 추상 의도)", () => {
    expect(shouldRerank(abstractRouted)).toBe(true);
  });
  it("geoTerms가 있으면 false", () => {
    expect(shouldRerank({ ...abstractRouted, geoTerms: ["오사카"] })).toBe(false);
  });
  it("themeTags가 있으면 false", () => {
    expect(shouldRerank({ ...abstractRouted, themeTags: ["가족"] })).toBe(false);
  });
});

describe("requestRerankLive (fetch mock)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("정상 JSON {ids:[...]} 응답을 그대로 반환", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ content: [{ text: '{"ids":["b","a"]}' }] }),
    })));
    expect(await requestRerankLive("q", docs, "key")).toEqual(["b", "a"]);
  });

  it("non-ok 응답이면 원본 key 순서로 강등", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await requestRerankLive("q", docs, "key")).toEqual(["a", "b"]);
  });

  it("JSON 파싱 실패면 원본 순서", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, json: async () => ({ content: [{ text: "not json" }] }),
    })));
    expect(await requestRerankLive("q", docs, "key")).toEqual(["a", "b"]);
  });

  it("fetch가 throw(타임아웃)하면 원본 순서", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    expect(await requestRerankLive("q", docs, "key")).toEqual(["a", "b"]);
  });
});

describe("rerankCandidates — 비-prod identity", () => {
  it("NODE_ENV≠production이면 원본 순서를 보존한다(오프라인 결정론)", async () => {
    const cards = [card("1"), card("2"), card("3")];
    const r = await rerankCandidates("조용히 쉬고 싶어", cards);
    expect(r.map((c) => c.id)).toEqual(["1", "2", "3"]);
  });

  it("후보 0·1개면 그대로 반환", async () => {
    expect(await rerankCandidates("q", [])).toEqual([]);
    const one = [card("1")];
    expect(await rerankCandidates("q", one)).toEqual(one);
  });
});
```

- [ ] **Step 2: 테스트 FAIL 확인**

Run: `npx vitest run src/features/search/server/__tests__/rerank.test.ts`
Expected: FAIL — `Cannot find module '../rerank'`.

- [ ] **Step 3: rerank.ts 구현**

```ts
// src/features/search/server/rerank.ts
/**
 * rerank.ts — 조건부 LLM 재정렬 (설계 §4, D2·D3·D4·D5·D7·D10).
 *
 * shouldRerank: geo·theme 모두 빈 순수 추상 의도에만 발동(eval 약점 구간).
 * requestRerankLive: 항상 Haiku 호출(키 주입). 실패 시 원본 key 순서(throw 금지).
 * requestRerank: NODE_ENV≠production은 identity → dev/test 오프라인 결정론.
 * rerankCandidates: top-8만 재정렬, 꼬리 원본 보존. router.ts 강등 철학 동일.
 */
import { z } from "zod";
import { env } from "@/shared/lib/env";
import type { SearchResultCard } from "@/entities/product";
import type { RoutedQuery } from "../model/schemas";
import { applyRerankOrder } from "../model/rerankOrder";

export interface RerankDoc {
  key: string;
  title: string;
  destination: string;
  summary: string;
  tags: string[];
  price: number;
  nights: number;
}

const RERANK_TOP_K = 8;
const RERANK_MODEL = "claude-haiku-4-5-20251001";
const RERANK_TIMEOUT_MS = 3000;

const RerankResponseSchema = z.object({ ids: z.array(z.string()) });

const SYSTEM_PROMPT =
  "너는 여행 검색 결과 재정렬기다. 후보 상품을 사용자 의도에 대한 관련성 순으로 " +
  '재정렬한다. 응답은 JSON만: {"ids":[순서대로 후보 key 배열]}. 모든 입력 key를 ' +
  "정확히 한 번씩 포함하고, 설명·코드블록 금지.";

/** 순수 트리거 — 순수 추상 의도(벡터가 랭킹을 혼자 떠안는 zone)에만 발동. */
export function shouldRerank(routed: RoutedQuery): boolean {
  return !(routed.geoTerms?.length) && !(routed.themeTags?.length);
}

/** 항상 Anthropic 호출(게이트 없음). 실패 시 원본 key 순서(throw 금지, D10). */
export async function requestRerankLive(
  query: string,
  docs: RerankDoc[],
  apiKey: string,
): Promise<string[]> {
  const original = docs.map((d) => d.key);
  if (docs.length === 0) return original;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: RERANK_MODEL,
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: JSON.stringify({ query, candidates: docs }) },
        ],
      }),
      signal: AbortSignal.timeout(RERANK_TIMEOUT_MS),
    });
    if (!res.ok) return original;
    const data: unknown = await res.json();
    const text =
      (data as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? "";
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return original;
    }
    const parsed = RerankResponseSchema.safeParse(raw);
    return parsed.success ? parsed.data.ids : original;
  } catch {
    return original;
  }
}

/** NODE_ENV 게이트: 비-prod는 identity(원본 순서) — 오프라인 결정론(D7). */
export async function requestRerank(
  query: string,
  docs: RerankDoc[],
): Promise<string[]> {
  if (env.NODE_ENV !== "production") return docs.map((d) => d.key);
  return requestRerankLive(query, docs, env.ANTHROPIC_API_KEY ?? "");
}

function toDoc(card: SearchResultCard): RerankDoc {
  return {
    key: card.id,
    title: card.title,
    destination: card.destination,
    summary: card.aiSummary ?? "",
    tags: card.tags.map((t) => t.tag),
    price: card.basePriceAdult,
    nights: card.durationNights,
  };
}

/** top-8을 재정렬, 꼬리(9위~) 원본 순서 보존. 실패 시 전체 원본 순서. */
export async function rerankCandidates(
  query: string,
  candidates: SearchResultCard[],
  topK: number = RERANK_TOP_K,
): Promise<SearchResultCard[]> {
  if (candidates.length <= 1) return candidates;
  const head = candidates.slice(0, topK);
  const tail = candidates.slice(topK);
  const orderedKeys = await requestRerank(query, head.map(toDoc));
  const reorderedHead = applyRerankOrder(head, (c) => c.id, orderedKeys);
  return [...reorderedHead, ...tail];
}
```

- [ ] **Step 4: 테스트 PASS 확인**

Run: `npx vitest run src/features/search/server/__tests__/rerank.test.ts`
Expected: PASS (shouldRerank 3 + requestRerankLive 4 + rerankCandidates 2).

- [ ] **Step 5: 커밋**

```bash
git add src/features/search/server/rerank.ts src/features/search/server/__tests__/rerank.test.ts
git commit -m "feat(search): conditional Haiku re-ranking with graceful fallback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: ClarifyingChips UI + 배럴 노출

칩 렌더 client island(plain props만, entities 배럴 미import) + 배럴 re-export.

**Files:**
- Create: `src/features/search/ui/ClarifyingChips.tsx`
- Modify: `src/features/search/index.ts`

- [ ] **Step 1: ClarifyingChips.tsx 작성**

```tsx
// src/features/search/ui/ClarifyingChips.tsx
"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { ClarifyingChip } from "../model/clarifyingChips";

/**
 * 좁히기 칩. 클릭 시 appendText를 쿼리에 덧붙여 /search?q= 로 재검색.
 * 대화 상태는 URL에만(stateless). useTransition isPending으로 펜딩 표시.
 * 이벤트 리스너·타이머 없음(cleanup 불요). entities/product 배럴 import 금지.
 */
export function ClarifyingChips({
  chips,
  query,
}: {
  chips: ClarifyingChip[];
  query: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (chips.length === 0) return null;

  function refine(appendText: string) {
    const next = `${query} ${appendText}`.trim();
    startTransition(() => {
      router.push(`/search?q=${encodeURIComponent(next)}`);
    });
  }

  return (
    <div className="mb-6">
      <p className="mb-2 text-sm text-muted-foreground">
        💡 더 정확히 찾아드릴게요
      </p>
      <div className="flex flex-wrap gap-2" aria-busy={isPending}>
        {chips.map((chip) => (
          <button
            key={chip.appendText}
            type="button"
            onClick={() => refine(chip.appendText)}
            disabled={isPending}
            className="rounded-full border border-border bg-card px-4 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-secondary disabled:opacity-60"
          >
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 배럴 re-export 추가**

`src/features/search/index.ts` 끝에 추가:
```ts
export { ClarifyingChips } from "./ui/ClarifyingChips";
export { buildClarifyingChips } from "./model/clarifyingChips";
export type { ClarifyingChip } from "./model/clarifyingChips";
```

- [ ] **Step 3: 타입체크 통과 확인**

Run: `npm run typecheck`
Expected: PASS (ClarifyingChips·배럴 타입 에러 0).

- [ ] **Step 4: 커밋**

```bash
git add src/features/search/ui/ClarifyingChips.tsx src/features/search/index.ts
git commit -m "feat(search): ClarifyingChips client island + barrel exports

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 오케스트레이션 배선 (search.ts + page.tsx)

`searchProductsImpl` 반환을 `{results,chips}`로 확장, 조건부 rerank 삽입, 캐시 키 v2 bump. 페이지는 칩 렌더 + 구조분해. 기존 테스트 갱신.

**Files:**
- Modify: `src/features/search/server/search.ts`
- Modify: `src/features/search/server/__tests__/search.test.ts`
- Modify: `src/app/(site)/search/page.tsx`

- [ ] **Step 1: search.test.ts를 새 shape로 갱신 (실패 예정)**

`src/features/search/server/__tests__/search.test.ts`에서 — `CARDS` 아래에 기대 응답을 추가하고, 세 테스트의 단언을 `r.results`/응답 객체로 교체한다.

`const CARDS` 줄(60) 다음에 추가:
```ts
const RESPONSE = { results: CARDS, chips: [] as unknown[] };
```

"Cache HIT" 테스트 본문(73-82) 교체:
```ts
    mocks.cacheGet.mockResolvedValueOnce(RESPONSE);
    const r = await searchProducts("동남아 휴양");
    expect(r).toEqual(RESPONSE);
    expect(mocks.routeQuery).not.toHaveBeenCalled();
    expect(mocks.searchProductsByVector).not.toHaveBeenCalled();
    expect(mocks.cacheSet).not.toHaveBeenCalled();
```

"Cache MISS" 테스트 본문(86-100) 교체:
```ts
    mocks.cacheGet.mockResolvedValueOnce(null);
    const r = await searchProducts("  동남아 휴양  ");
    expect(r.results).toEqual(CARDS);
    expect(mocks.routeQuery).toHaveBeenCalledWith("동남아 휴양");
    expect(mocks.searchProductsByVector).toHaveBeenCalledOnce();
    const getKey = mocks.cacheGet.mock.calls[0][0];
    const [setKey, setVal, setTtl] = mocks.cacheSet.mock.calls[0];
    expect(setKey).toBe(getKey);
    expect(setVal.results).toEqual(CARDS);
    expect(setTtl).toBe(3600);
```

"graceful" 테스트 본문(104-112) 교체:
```ts
    mocks.cacheGet.mockResolvedValueOnce(null);
    mocks.cacheSet.mockResolvedValueOnce(undefined);
    const r = await searchProducts("동남아 휴양");
    expect(r.results).toEqual(CARDS);
    expect(mocks.searchProductsByVector).toHaveBeenCalledOnce();
```

> 참고: `ROUTED`는 geoTerms·themeTags가 있어 `shouldRerank=false` → 이 테스트들은 rerank를 타지 않는다(검색 오케스트레이션만 검증). rerank 동작은 Task 3에서 단위 검증됨.

- [ ] **Step 2: 테스트 FAIL 확인**

Run: `npx vitest run src/features/search/server/__tests__/search.test.ts`
Expected: FAIL — `r.results`가 undefined(아직 배열 반환) 또는 cacheSet val shape 불일치.

- [ ] **Step 3: search.ts 구현 (새 shape + 조건부 rerank)**

`src/features/search/server/search.ts` 전체를 아래로 교체:
```ts
/**
 * search.ts — 검색 오케스트레이션 (M-AI-SEARCH, M-CACHE) + Milestone 4.
 *
 * 단일 라운드트립 보존: routeQuery 1회 → embed → 하이브리드 → (조건부) rerank
 * → chips. 반환은 {results, chips}. 캐시는 재정렬 순서·칩까지 저장(키 v2).
 */
import { cacheGet, cacheSet } from "@/shared/lib/cache";
import { getEmbeddingProvider } from "@/shared/lib/embedding";
import { searchProductsByVector } from "@/entities/product";
import type { SearchResultCard } from "@/entities/product";
import { auth } from "@/features/auth/server/auth";
import { withRateLimitAction } from "@/shared/lib/rate-limit";
import { routeQuery } from "./router";
import { shouldRerank, rerankCandidates } from "./rerank";
import { buildClarifyingChips, type ClarifyingChip } from "../model/clarifyingChips";

const CACHE_TTL_SECONDS = 60 * 60;
// v2: 반환 shape이 SearchResultCard[] → {results,chips}로 바뀌어 키를 bump.
const CACHE_KEY_PREFIX = "search:v2:";

export interface SearchResponse {
  results: SearchResultCard[];
  chips: ClarifyingChip[];
}

async function searchProductsImpl(q: string): Promise<SearchResponse> {
  const normalized = q.trim();
  const cacheKey = `${CACHE_KEY_PREFIX}${normalized}`;

  const cached = await cacheGet<SearchResponse>(cacheKey);
  if (cached !== null) return cached;

  const routed = await routeQuery(normalized);
  const provider = getEmbeddingProvider();
  const qVec = await provider.embed(routed.cleanedQuery);

  const filters = {
    priceMax: routed.priceMax,
    durationNights: routed.durationNights,
    themeTags: routed.themeTags,
  };

  const hybrid = await searchProductsByVector(
    qVec,
    filters,
    provider.modelVersion,
    routed.cleanedQuery,
    routed.geoTerms ?? [],
  );

  // 조건부 재정렬: 순수 추상 의도(geo·theme 비어있음)에만. 비-prod identity.
  const results = shouldRerank(routed)
    ? await rerankCandidates(normalized, hybrid)
    : hybrid;
  const chips = buildClarifyingChips(routed, normalized);

  const response: SearchResponse = { results, chips };
  await cacheSet(cacheKey, response, CACHE_TTL_SECONDS);
  return response;
}

/**
 * Phase 3 B2-C: ai-search tier — 20 req / 1min per (user | ip).
 * 차단 시 `/search?error=RATE_LIMITED&retryAfter=N` 로 redirect → UI 가 안내.
 */
export const searchProducts = withRateLimitAction(
  {
    tier: "ai-search",
    resolveUserId: async () => (await auth())?.user?.id ?? null,
    redirectOnBlock: (retry) =>
      `/search?error=RATE_LIMITED&retryAfter=${retry}`,
  },
  searchProductsImpl,
);

export { __resetRedisClientForTest as __resetSearchCacheForTest } from "@/shared/lib/cache";
```

- [ ] **Step 4: 테스트 PASS 확인**

Run: `npx vitest run src/features/search/server/__tests__/search.test.ts`
Expected: PASS (3 케이스).

- [ ] **Step 5: page.tsx에 칩 렌더 + 구조분해**

`src/app/(site)/search/page.tsx`의 import 줄(4)을 교체:
```ts
import { searchProducts, SearchBox, SearchChips, ClarifyingChips } from "@/features/search";
```

`SearchResults` 함수(13-32)를 교체:
```tsx
async function SearchResults({ q }: { q: string }) {
  const { results, chips } = await searchProducts(q);

  return (
    <>
      <ClarifyingChips chips={chips} query={q} />
      {results.length === 0 ? (
        <EmptyState
          title="검색 결과가 없습니다"
          description={`'${q}'에 맞는 여행 상품을 찾지 못했습니다. 다른 키워드로 검색해 보세요.`}
        />
      ) : (
        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {results.map((item) => (
            <ProductCard key={item.id} product={item} />
          ))}
        </div>
      )}
    </>
  );
}
```
(`ClarifyingChips`는 `chips.length===0`이면 자체적으로 `null` 반환 — 조건 분기 불요.)

- [ ] **Step 6: 전체 검증 (배선 무손상 + 서버/클라 경계)**

Run: `npx vitest run src/features/search && npm run typecheck`
Expected: PASS — search/rerank/chips 테스트 전부 통과, 타입 에러 0.

- [ ] **Step 7: 커밋**

```bash
git add src/features/search/server/search.ts src/features/search/server/__tests__/search.test.ts "src/app/(site)/search/page.tsx"
git commit -m "feat(search): wire conditional rerank + clarifying chips into pipeline

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Eval — hard-query slice + RerankSnapshot 타입

추상 15쿼리(전부 `shouldRerank` 만족: geo·theme 무신호) + 수작업 0~3 라벨. 라벨은 **초안**이며 Task 7 추출 후 보정.

**Files:**
- Modify: `scripts/search-eval/types.ts`
- Create: `scripts/search-eval/hard-queries.ts`

- [ ] **Step 1: types.ts에 RerankSnapshot 추가**

`scripts/search-eval/types.ts` 끝에 추가:
```ts
/** 재정렬 순서 스냅샷 1건 — 쿼리 → 재정렬된 코퍼스 title 순서(corpus는 title이 키). */
export interface RerankSnapshot {
  query: string;
  rerankedTitles: string[];
}
```

- [ ] **Step 2: hard-queries.ts 작성**

```ts
// scripts/search-eval/hard-queries.ts
/**
 * hard-queries.ts — 재정렬 측정용 추상·모호 쿼리 슬라이스 (설계 §5.1).
 *
 * 전부 geo·theme 무신호(THEME_KEYWORDS·gazetteer 미포함) → 운영에서
 * shouldRerank=true 경로를 탄다. 라벨은 20상품 코퍼스 title 기준 0~3.
 *
 * ⚠️ 라벨은 초안 — Task 7 추출 후 실제 임베딩 근접도/태그를 보고 보정.
 *    각 쿼리가 정말 geo·theme 무신호인지 추출 시 가드로 검증.
 */
export interface HardCase {
  query: string;
  intent: string;
  labels: Record<string, number>; // title → 0~3 (생략 시 0)
}

export const HARD_QUERIES: HardCase[] = [
  {
    query: "조용히 쉬고 싶어",
    intent: "추상 휴양·힐링",
    labels: {
      "다낭 나홀로 힐링 휴양 3박4일": 3,
      "발리 허니문 풀빌라 4박6일": 2,
      "발리 가성비 4박6일": 2,
      "몰디브 허니문 수상빌라 5박7일": 2,
      "도쿄·하코네 온천 4박5일": 2,
    },
  },
  {
    query: "북적이지 않는 곳",
    intent: "한적·프라이빗",
    labels: {
      "몰디브 허니문 수상빌라 5박7일": 3,
      "다낭 나홀로 힐링 휴양 3박4일": 3,
      "발리 허니문 풀빌라 4박6일": 2,
      "스위스 알프스 9박10일": 2,
    },
  },
  {
    query: "기분 전환이 필요해",
    intent: "전환·새 자극",
    labels: {
      "다낭 나홀로 힐링 휴양 3박4일": 2,
      "방콕 나홀로 미식 자유여행 3박4일": 2,
      "타이베이 주말 근거리 미식 2박3일": 2,
      "오사카·교토 3박4일 자유일정": 1,
    },
  },
  {
    query: "특별한 날 기념하고 싶어",
    intent: "기념일·로맨틱",
    labels: {
      "몰디브 허니문 수상빌라 5박7일": 3,
      "푸켓 허니문 럭셔리 리조트 4박5일": 3,
      "발리 허니문 풀빌라 4박6일": 2,
      "푸켓 풀빌라 허니문 5박7일": 2,
    },
  },
  {
    query: "재충전이 필요해",
    intent: "휴식·리트릿",
    labels: {
      "다낭 나홀로 힐링 휴양 3박4일": 3,
      "발리 가성비 4박6일": 2,
      "몰디브 허니문 수상빌라 5박7일": 2,
      "발리 허니문 풀빌라 4박6일": 2,
    },
  },
  {
    query: "낭만적인 분위기",
    intent: "로맨틱·럭셔리",
    labels: {
      "몰디브 허니문 수상빌라 5박7일": 3,
      "푸켓 허니문 럭셔리 리조트 4박5일": 2,
      "발리 허니문 풀빌라 4박6일": 2,
      "파리·로마 핵심 8박9일": 2,
    },
  },
  {
    query: "느긋하게 보내고 싶어",
    intent: "슬로우·휴양",
    labels: {
      "다낭 나홀로 힐링 휴양 3박4일": 3,
      "발리 가성비 4박6일": 2,
      "오키나와 가족 자유여행 3박4일": 2,
      "발리 허니문 풀빌라 4박6일": 2,
    },
  },
  {
    query: "새로운 경험을 하고 싶어",
    intent: "체험·문화·해양",
    labels: {
      "세부 가족여행 4박5일": 2,
      "파리·로마 핵심 8박9일": 2,
      "방콕 나홀로 미식 자유여행 3박4일": 2,
      "스위스 알프스 9박10일": 2,
    },
  },
  {
    query: "활기차게 즐기고 싶어",
    intent: "액티브·미식",
    labels: {
      "방콕 나홀로 미식 자유여행 3박4일": 2,
      "세부 가족여행 4박5일": 2,
      "타이베이 주말 근거리 미식 2박3일": 2,
      "오사카·교토 3박4일 자유일정": 1,
    },
  },
  {
    query: "스트레스 풀러 가고 싶어",
    intent: "힐링·휴양",
    labels: {
      "다낭 나홀로 힐링 휴양 3박4일": 3,
      "발리 가성비 4박6일": 2,
      "몰디브 허니문 수상빌라 5박7일": 2,
      "발리 허니문 풀빌라 4박6일": 2,
    },
  },
  {
    query: "인생샷 남기고 싶어",
    intent: "절경·포토제닉",
    labels: {
      "스위스 알프스 9박10일": 3,
      "몰디브 허니문 수상빌라 5박7일": 3,
      "파리·로마 핵심 8박9일": 2,
      "푸켓 허니문 럭셔리 리조트 4박5일": 1,
    },
  },
  {
    query: "마음이 편안해지는 여행",
    intent: "힐링·평온",
    labels: {
      "다낭 나홀로 힐링 휴양 3박4일": 3,
      "발리 허니문 풀빌라 4박6일": 2,
      "몰디브 허니문 수상빌라 5박7일": 2,
      "도쿄·하코네 온천 4박5일": 2,
    },
  },
  {
    query: "분위기 좋은 곳에서 쉬고 싶어",
    intent: "럭셔리 휴양",
    labels: {
      "몰디브 허니문 수상빌라 5박7일": 3,
      "발리 허니문 풀빌라 4박6일": 2,
      "푸켓 허니문 럭셔리 리조트 4박5일": 2,
      "다낭 나홀로 힐링 휴양 3박4일": 2,
    },
  },
  {
    query: "오롯이 나를 위한 여행",
    intent: "솔로·자기보상",
    labels: {
      "다낭 나홀로 힐링 휴양 3박4일": 3,
      "방콕 나홀로 미식 자유여행 3박4일": 2,
      "혼자 떠나는 도쿄 나홀로 자유여행 3박4일": 2,
      "타이베이 주말 근거리 미식 2박3일": 1,
    },
  },
  {
    query: "일상에서 벗어나고 싶다",
    intent: "탈출·휴양",
    labels: {
      "몰디브 허니문 수상빌라 5박7일": 3,
      "다낭 나홀로 힐링 휴양 3박4일": 2,
      "스위스 알프스 9박10일": 2,
      "발리 가성비 4박6일": 2,
    },
  },
];
```

- [ ] **Step 3: 타입체크 통과 확인**

Run: `npm run typecheck`
Expected: PASS (hard-queries.ts·types.ts 타입 에러 0).

- [ ] **Step 4: 커밋**

```bash
git add scripts/search-eval/types.ts scripts/search-eval/hard-queries.ts
git commit -m "feat(search-eval): hard-query slice + RerankSnapshot type (draft labels)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Fixture 추출 확장 (hard + rerank) + 라벨 보정

OpenAI로 hard 쿼리 임베딩 + Haiku로 실 재정렬 순서를 1회 추출해 박제. **opt-in** — `OPENAI_API_KEY` + `ANTHROPIC_API_KEY` + 시드 DB 필요. 키 부재 시 이 Task 보류 가능(Task 8 테스트는 합성 fixture로 독립 검증).

**Files:**
- Modify: `scripts/search-eval/extract-fixtures.ts`
- Create: `scripts/search-eval/hard-queries.fixture.json` (산출)
- Create: `scripts/search-eval/rerank.fixture.json` (산출)

- [ ] **Step 1: extract-fixtures.ts 확장**

`scripts/search-eval/extract-fixtures.ts`의 import 블록에 추가:
```ts
import { rankCandidates } from "./scoreReplica";
import { requestRerankLive, type RerankDoc } from "@/features/search/server/rerank";
import { HARD_QUERIES } from "./hard-queries";
import type { RerankSnapshot } from "./types";
```

`main()` 안에서 두 JSON을 쓰는 `writeFileSync(...corpus...)` / `writeFileSync(...queries...)` 직후, `console.log("박제 완료...")` **앞**에 아래 블록을 삽입:
```ts
  // 3) hard 쿼리: routeQuery → geo·theme 무신호 가드 → 임베딩 박제.
  const hardQueries: GoldenQuery[] = [];
  for (const h of HARD_QUERIES) {
    const routed = await routeQuery(h.query);
    const geo = (routed.geoTerms ?? []).map((t) => t);
    const theme = (routed.themeTags ?? []).map(toStorageTag);
    if (geo.length > 0 || theme.length > 0) {
      throw new Error(
        `hard 쿼리 "${h.query}"가 geo/theme 신호를 가짐 (geo=${geo}, theme=${theme}) — ` +
          "shouldRerank=false가 되어 재정렬 경로를 못 탄다. 쿼리를 재선정하라.",
      );
    }
    const embedding = await provider.embed(routed.cleanedQuery);
    hardQueries.push({
      query: h.query,
      cleanedQuery: routed.cleanedQuery,
      themeTags: theme,
      geoTerms: geo,
      priceMax: routed.priceMax,
      durationNights: routed.durationNights,
      embedding,
    });
    console.log(`  hard   ✓ ${h.query}`);
  }

  // 4) 재정렬 스냅샷: 각 hard 쿼리의 하이브리드 top-8을 실 Haiku로 재정렬.
  const corpusByTitle = new Map(corpus.map((p) => [p.title, p]));
  const rerankSnapshots: RerankSnapshot[] = [];
  for (const hq of hardQueries) {
    const ranked = rankCandidates(corpus, hq); // 운영 가중치 하이브리드
    const head = ranked.slice(0, 8);
    const docs: RerankDoc[] = head.map((r) => {
      const p = corpusByTitle.get(r.title)!;
      return {
        key: p.title, // corpus는 title이 키
        title: p.title,
        destination: p.destination,
        summary: p.summary,
        tags: p.tags,
        price: p.basePriceAdult,
        nights: p.durationNights,
      };
    });
    const rerankedTitles = await requestRerankLive(
      hq.query,
      docs,
      env.ANTHROPIC_API_KEY ?? "",
    );
    rerankSnapshots.push({ query: hq.query, rerankedTitles });
    console.log(`  rerank ✓ ${hq.query}`);
  }

  writeFileSync(
    join(here, "hard-queries.fixture.json"),
    JSON.stringify(hardQueries, null, 2),
  );
  writeFileSync(
    join(here, "rerank.fixture.json"),
    JSON.stringify(rerankSnapshots, null, 2),
  );
```

> 주의: `requestRerankLive`는 게이트 없는 라이브 경로라 NODE_ENV와 무관하게 Haiku를
> 호출한다(임베딩 추출이 `OpenAIEmbeddingProvider`를 직접 쓰는 것과 동형). `env`는
> 이미 extract-fixtures 상단에서 import됨.

- [ ] **Step 2: 타입체크 통과 확인**

Run: `npm run typecheck`
Expected: PASS (`requestRerankLive`/`RerankDoc`/`RerankSnapshot` 타입 정합).

- [ ] **Step 3: 시드 + 추출 실행 (opt-in, 키 필요)**

Run:
```bash
npm run db:seed
set -a; . ./.env; set +a; npx tsx scripts/search-eval/extract-fixtures.ts
```
Expected: 기존 `corpus ✓`/`query ✓` 출력에 더해 `hard ✓` 15줄 + `rerank ✓` 15줄.
`hard-queries.fixture.json`(15) + `rerank.fixture.json`(15) 생성. geo/theme 가드에서
throw하면 해당 쿼리를 `hard-queries.ts`에서 재선정(추상어로 교체) 후 재실행.

- [ ] **Step 4: 라벨 보정**

Run:
```bash
npx tsx -e "for (const s of require('./scripts/search-eval/rerank.fixture.json')) console.log(s.query, '→', s.rerankedTitles.slice(0,3).join(' | '))"
```
Expected: 각 hard 쿼리의 재정렬 상위 3개 title 출력.

출력의 재정렬 상위와 `hard-queries.ts`의 라벨을 대조해, 명백히 어긋나는 라벨만
현실화(예: 재정렬이 1위로 올린 상품이 라벨 0이면 코퍼스를 재검토). 추상 의도라
주관적이므로 **상위/하위 구분이 합리적이면 유지**(과적합 라벨링 금지).

- [ ] **Step 5: 커밋 (fixture + 보정 라벨)**

```bash
git add scripts/search-eval/extract-fixtures.ts scripts/search-eval/hard-queries.fixture.json scripts/search-eval/rerank.fixture.json scripts/search-eval/hard-queries.ts
git commit -m "feat(search-eval): extract hard-query + rerank fixtures (real Haiku snapshot)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: 평가 러너 --rerank 모드

hard 슬라이스에서 nDCG@5(하이브리드) vs nDCG@5(재정렬)을 per-query + mean으로 리포트. apply 로직은 `applyRerankOrder`(Task 2) 재사용 → 결정론.

**Files:**
- Modify: `scripts/search-eval/run-eval.ts`
- Create: `scripts/search-eval/__tests__/rerankEval.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (합성 fixture, 키 독립)**

```ts
// scripts/search-eval/__tests__/rerankEval.test.ts
import { describe, it, expect } from "vitest";
import { rerankRelevances } from "../run-eval";
import { ndcgAtK } from "../ndcg";

// 하이브리드 순서: [B(label0), A(label3)] — 좋은 답이 2위(약한 랭킹).
const hybrid = [
  { title: "A", score: 0.5 },
  { title: "B", score: 0.9 },
];
const labels: Record<string, number> = { A: 3, B: 0 };

describe("rerankRelevances", () => {
  it("재정렬이 라벨 높은 항목을 1위로 올리면 relevance 순서가 개선된다", () => {
    // 하이브리드 점수 순서는 B,A → relevances [0,3]
    // 재정렬 스냅샷이 A를 1위로 → relevances [3,0]
    const reranked = rerankRelevances(hybrid, ["A", "B"], labels);
    expect(reranked).toEqual([3, 0]);
    expect(ndcgAtK(reranked, 5)).toBeGreaterThan(
      ndcgAtK([0, 3], 5), // 하이브리드 원순서
    );
  });

  it("환각/누락 title은 applyRerankOrder가 흡수(길이 보존)", () => {
    const r = rerankRelevances(hybrid, ["A", "ZZZ"], labels);
    expect(r).toHaveLength(2);
    expect(r[0]).toBe(3); // A 먼저, B는 누락분 append
  });
});
```

- [ ] **Step 2: 테스트 FAIL 확인**

Run: `npx vitest run scripts/search-eval/__tests__/rerankEval.test.ts`
Expected: FAIL — `rerankRelevances` export 없음.

- [ ] **Step 3: run-eval.ts에 --rerank 모드 추가**

`scripts/search-eval/run-eval.ts`의 import 블록에 추가:
```ts
import { applyRerankOrder } from "@/features/search/model/rerankOrder";
import { HARD_QUERIES } from "./hard-queries";
import type { RerankSnapshot } from "./types";
import type { RankedItem } from "./scoreReplica";
```

`simplexGrid` 함수 정의 **뒤**에 추가(export):
```ts
/** 재정렬 스냅샷 title 순서로 하이브리드 후보를 재배열 → 라벨 배열 산출. */
export function rerankRelevances(
  hybrid: RankedItem[],
  rerankedTitles: string[],
  labels: Record<string, number>,
): number[] {
  const reordered = applyRerankOrder(hybrid, (r) => r.title, rerankedTitles);
  return reordered.map((r) => labels[r.title] ?? 0);
}
```

`main()` 함수에서 `const sweep = process.argv.includes("--sweep");` 줄 **다음**에 추가:
```ts
  const rerankMode = process.argv.includes("--rerank");
  if (rerankMode) {
    const hardQueries = load<GoldenQuery[]>("hard-queries.fixture.json");
    const snapshots = load<RerankSnapshot[]>("rerank.fixture.json");
    const hardByText = new Map(hardQueries.map((q) => [q.query, q]));
    const snapByText = new Map(snapshots.map((s) => [s.query, s.rerankedTitles]));

    console.log("=== rerank eval (hard slice, nDCG@5 hybrid vs reranked) ===\n");
    console.log("쿼리".padEnd(26), "hybrid", "rerank", "Δ");
    let sumH = 0;
    let sumR = 0;
    for (const h of HARD_QUERIES) {
      const q = hardByText.get(h.query);
      if (!q) throw new Error(`hard fixture 누락: "${h.query}"`);
      const ranked = rankCandidates(corpus, q);
      const head = ranked.slice(0, 8);
      const tail = ranked.slice(8);
      const relH = [...head, ...tail].map((r) => h.labels[r.title] ?? 0);
      const titles = snapByText.get(h.query) ?? head.map((r) => r.title);
      const relR = [...rerankRelevances(head, titles, h.labels),
                    ...tail.map((r) => h.labels[r.title] ?? 0)];
      const nH = ndcgAtK(relH, 5);
      const nR = ndcgAtK(relR, 5);
      sumH += nH;
      sumR += nR;
      const d = nR - nH;
      console.log(
        h.query.padEnd(26),
        nH.toFixed(3), " ", nR.toFixed(3), " ",
        (d >= 0 ? "+" : "") + d.toFixed(3),
      );
    }
    const n = HARD_QUERIES.length;
    console.log(
      `\nmean nDCG@5  hybrid: ${(sumH / n).toFixed(4)}  rerank: ${(sumR / n).toFixed(4)}` +
        `  Δ: ${(sumR / n - sumH / n >= 0 ? "+" : "")}${(sumR / n - sumH / n).toFixed(4)}`,
    );
    return;
  }
```

> `rankCandidates`·`ndcgAtK`·`load`·`GoldenQuery`는 run-eval.ts에 이미 import/정의됨.

- [ ] **Step 4: 테스트 PASS 확인**

Run: `npx vitest run scripts/search-eval/__tests__/rerankEval.test.ts`
Expected: PASS (2 케이스).

- [ ] **Step 5: rerank eval 실행 (Task 7 fixture 있을 때 — 증거 수집)**

Run: `npx tsx scripts/search-eval/run-eval.ts --rerank`
Expected: hard 쿼리별 hybrid/rerank/Δ 테이블 + mean nDCG@5 비교. **출력을 보고서·ADR에 인용.**
(Task 7 미실행 시 fixture 부재로 실패 — 그 경우 Task 7 선완료 또는 보류 명시.)

- [ ] **Step 6: 기존 eval 회귀 확인**

Run: `npx tsx scripts/search-eval/run-eval.ts && npx vitest run scripts/search-eval`
Expected: 기존 baseline 출력 무손상 + eval 테스트 전부 PASS.

- [ ] **Step 7: 커밋**

```bash
git add scripts/search-eval/run-eval.ts scripts/search-eval/__tests__/rerankEval.test.ts
git commit -m "feat(search-eval): --rerank mode (hybrid vs reranked nDCG@5 on hard slice)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: 종합 검증 + 보고 + ADR 후보

**Files:**
- Modify: `docs/superpowers/plans/2026-06-11-agentic-search-rerank.md` (체크박스 최종 갱신)

- [ ] **Step 1: 전체 QA 증거 수집**

Run: `npm run typecheck && npx vitest run && npm run lint`
Expected: typecheck PASS, 전체 테스트 PASS(신규 chips/rerankOrder/rerank/search/rerankEval 포함), lint 통과(기존 경고 외 신규 0).

- [ ] **Step 2: 서버/클라 경계 + 빌드 검증**

Run: `rm -rf .next && npm run build`
Expected: PASS — `ClarifyingChips`(client) 번들에 entities/product 서버 그래프 누출 없음(`UnhandledSchemeError` 0), 검색 페이지 정상 빌드.
(dev 서버 가동 중이면 build 금지 — 먼저 dev 중단. feedback_no_build_during_dev.)

- [ ] **Step 3: 미체크 항목 점검**

Run: `grep -n "\- \[ \]" docs/superpowers/plans/2026-06-11-agentic-search-rerank.md`
Expected: (Task 7을 키 부재로 보류한 경우 외엔) 출력 없음.

- [ ] **Step 4: 보고 (CLAUDE.md §7.1 양식)**

- 🏗️ Core Architecture: 조건부 rerank(추상 의도만)·URL 칩(stateless)·fixture 스냅샷 eval 3줄 브리핑.
- 🧠 Concept Insight: "재정렬 = 1차 추천(하이브리드) 위에 사람 감별사(LLM)를 얹어 상위 8개만 다시 줄세우기" 비유 1문단.
- **ADR 후보 한 줄**: `--rerank` mean Δ가 노이즈 위로 유의미하면 "재정렬 도입(또는 트리거 조정) 결정을 ADR-NNNN으로 박제할까요?" 제안. Δ가 미미하면 "현 트리거 유지 + 향후 데이터" 결론도 ADR 가치.

---

## Self-Review 메모 (작성자 점검 완료)

- **스펙 커버리지**: §3 칩→Task 1·4·5 · §4.1 순열가드→Task 2 · §4 rerank→Task 3 · §4.2 배선→Task 5 · §4.3 페이지→Task 5 · §5 eval(hard/fixture/runner)→Task 6·7·8 · §9 ADR→Task 9. 전 항목 매핑.
- **타입 일관성**: `ClarifyingChip`/`RerankDoc`/`SearchResponse`/`RerankSnapshot`/`applyRerankOrder`/`shouldRerank`/`rerankCandidates`/`requestRerankLive`/`rerankRelevances` 시그니처가 정의 Task와 사용 Task에서 일치.
- **강등 무손상**: rerank 실패→원본 순서, 비-prod→identity, cache v2 bump(shape 변경 안전). 전부 throw 금지 보존.
- **키 의존성**: Task 7만 OPENAI+ANTHROPIC 키 필요. Task 1~6·8은 키 없이 완성·테스트(순수/mock/합성 fixture). Task 8 실 수치 리포트는 Task 7 선행 필요.
- **FSD 경계**: `ClarifyingChips`(client)는 `../model/clarifyingChips` 타입만 import(entities 배럴 미접촉). scripts→`@/features/search` import는 스크립트 예외(기존 extract-fixtures 선례).
```
