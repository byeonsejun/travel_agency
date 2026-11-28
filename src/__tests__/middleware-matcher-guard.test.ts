import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { describe, it, expect, vi } from "vitest";

// Next 가 빌드 때 matcher 를 컴파일하는 함수와, 런타임에 요청을 매칭하는 함수를 그대로 쓴다.
// (설정 객체 모양만 보는 테스트는 `missing` 의 실제 의미를 놓친다.)
// 둘 다 Next 내부 모듈이라 타입 선언에 export 가 없어서, 필요한 시그니처만 적어 require 한다.
type RouteMatcher = (
  pathname: string,
  req: { headers: Record<string, string> },
  query: Record<string, string>,
) => boolean;
const nodeRequire = createRequire(import.meta.url);
const { getMiddlewareMatchers } = nodeRequire(
  "next/dist/build/analysis/get-page-static-info",
) as { getMiddlewareMatchers: (matcher: unknown, conf: { basePath: string; i18n: null }) => unknown };
const { getMiddlewareRouteMatcher } = nodeRequire(
  "next/dist/shared/lib/router/utils/middleware-route-matcher",
) as { getMiddlewareRouteMatcher: (matchers: unknown) => RouteMatcher };

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

const { config } = await import("@/middleware");

const match = getMiddlewareRouteMatcher(
  getMiddlewareMatchers(config.matcher, { basePath: "", i18n: null }),
);
const runs = (path: string, headers: Record<string, string> = {}) =>
  match(path, { headers }, {});

// 클라이언트가 마음대로 붙일 수 있는 prefetch 헤더들.
const PREFETCH_HEADERS: Record<string, string>[] = [
  { purpose: "prefetch" },
  { "next-router-prefetch": "1" },
  { purpose: "prefetch", rsc: "1" },
];

describe("middleware matcher — prefetch 헤더로 인증·요청 제한을 건너뛸 수 없다", () => {
  const guarded = [
    "/admin",
    "/admin/bookings",
    "/admin/bookings/ckabcdefghijklmnopqrstuvw",
    "/mypage",
    "/booking/abc",
    "/bookings/abc/success",
    "/api/products/ckabcdefghijklmnopqrstuvw/departures",
    "/api/auth/signin/resend",
  ];

  for (const path of guarded) {
    it(`${path} 는 헤더가 없어도 있어도 middleware 를 탄다`, () => {
      expect(runs(path)).toBe(true);
      for (const h of PREFETCH_HEADERS) {
        expect(runs(path, h)).toBe(true);
      }
    });
  }

  it("공개 페이지는 기존처럼 prefetch 때 middleware 를 건너뛴다 (CSP nonce 재생성 방지)", () => {
    expect(runs("/products/abc")).toBe(true);
    expect(runs("/products/abc", { purpose: "prefetch" })).toBe(false);
  });

  it("/api/csp-report 는 계속 middleware 밖이다", () => {
    expect(runs("/api/csp-report")).toBe(false);
  });
});

describe("admin page 는 데이터 조회 전에 스스로 ADMIN 을 확인한다", () => {
  const root = join(process.cwd(), "src/app/(admin)/admin");
  const pages: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "page.tsx") pages.push(p);
    }
  };
  walk(root);

  it("admin page 파일을 찾았다", () => {
    expect(pages.length).toBeGreaterThan(10);
  });

  for (const p of pages) {
    const rel = p.slice(root.length) || "/page.tsx";
    const src = readFileSync(p, "utf8");
    // /admin 인덱스처럼 데이터 없이 redirect 만 하는 page 는 제외.
    if (!/export default async function/.test(src)) continue;
    it(`${rel} 의 첫 실행 문장이 requireAdmin() 이다`, () => {
      // 시그니처(매개변수 구조분해 포함)가 끝나는 `) {` 다음부터가 본문이다.
      const start = src.indexOf("export default async function");
      const sig = /\)\s*(?::[^{]+)?\{\n/.exec(src.slice(start));
      const body = sig ? src.slice(start + sig.index + sig[0].length) : "";
      expect(body.trimStart().startsWith("await requireAdmin();")).toBe(true);
    });
  }
});
