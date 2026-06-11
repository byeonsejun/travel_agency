import { describe, it, expect, vi, afterEach } from "vitest";

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

  it("```json 코드펜스로 감싼 응답도 파싱한다(Haiku 실측 동작)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        content: [{ text: '```json\n{"ids":["b","a"]}\n```' }],
      }),
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
