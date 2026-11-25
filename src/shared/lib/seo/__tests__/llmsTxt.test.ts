import { describe, it, expect, vi } from "vitest";

vi.mock("@/shared/lib/env", () => ({ env: { VERCEL_ENV: undefined } }));

import { buildLlmsTxt } from "../llmsTxt";

const BASE = "https://travel-agency-sooty-mu.vercel.app";

describe("buildLlmsTxt", () => {
  const text = buildLlmsTxt({
    products: [
      { path: "/products/p1", label: "오사카 3박 4일 — 오사카, 일본" },
      { path: "/products/p2", label: "다낭 4박 5일 — 다낭, 베트남" },
    ],
  });

  it("# Nextour 로 시작하고 두 번째 블록이 > 요약이다", () => {
    expect(text.startsWith("# Nextour\n")).toBe(true);
    const blocks = text.split("\n\n");
    expect(blocks[0]).toBe("# Nextour");
    expect(blocks[1].startsWith("> ")).toBe(true);
  });

  it("주요 페이지 절에 상품 목록과 검색 링크가 절대 주소로 있다", () => {
    const section = text.split("## 주요 페이지")[1].split("\n## ")[0];
    expect(section).toContain(`- [여행 상품](${BASE}/products)`);
    expect(section).toContain(`- [여행 검색](${BASE}/search)`);
  });

  it("상품 절에 라벨 · 절대 주소 한 줄씩 나온다", () => {
    const section = text.split("## 상품")[1].split("\n## ")[0];
    expect(section).toContain(`- [오사카 3박 4일 — 오사카, 일본](${BASE}/products/p1)`);
    expect(section).toContain(`- [다낭 4박 5일 — 다낭, 베트남](${BASE}/products/p2)`);
  });

  it("만든 사람 링크와 저장소, 실결제 없음 문구, 사이트맵 링크를 포함한다", () => {
    expect(text).toContain("https://sejunb.com");
    expect(text).toContain("https://github.com/byeonsejun/travel_agency");
    expect(text).toContain("실제 결제는 일어나지 않");
    expect(text).toContain(`${BASE}/sitemap.xml`);
  });

  it("상품이 0개면 ## 상품 절 자체가 없다", () => {
    const empty = buildLlmsTxt({ products: [] });
    expect(empty).not.toContain("## 상품");
    expect(empty).toContain("## 주요 페이지");
  });
});
