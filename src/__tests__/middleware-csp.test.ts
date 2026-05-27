import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * `auth()` wrapper 는 NextAuth 가 주입하는 verifyAuth/sessionMerge 로직.
 * 본 테스트는 *CSP 박제 동작* 만 검증하므로 wrapper 를 패스스루로 mock.
 */
vi.mock("@/features/auth/server/auth", () => ({
  auth: (handler: unknown) => handler,
}));

describe("middleware — CSP nonce 주입 + 헤더 박제", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("응답 헤더에 Content-Security-Policy-Report-Only 가 박힌다 (CSP_MODE 미설정 기본값)", async () => {
    vi.stubEnv("CSP_MODE", "");
    const middleware = (await import("../middleware")).default as (
      req: NextRequest,
    ) => Promise<Response> | Response;

    const req = new NextRequest("http://localhost:3000/products");
    Object.defineProperty(req, "auth", { value: null, configurable: true });
    Object.defineProperty(req, "nextUrl", {
      value: new URL("http://localhost:3000/products"),
      configurable: true,
    });

    const res = await middleware(req);
    const headerName = "content-security-policy-report-only";
    expect(res.headers.get(headerName)).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  });

  it("CSP_MODE=enforce 일 때 enforce 헤더로 전환", async () => {
    vi.stubEnv("CSP_MODE", "enforce");
    vi.resetModules();
    const middleware = (await import("../middleware")).default as (
      req: NextRequest,
    ) => Promise<Response> | Response;

    const req = new NextRequest("http://localhost:3000/products");
    Object.defineProperty(req, "auth", { value: null, configurable: true });
    Object.defineProperty(req, "nextUrl", {
      value: new URL("http://localhost:3000/products"),
      configurable: true,
    });

    const res = await middleware(req);
    expect(res.headers.get("content-security-policy")).toMatch(/'strict-dynamic'/);
    expect(res.headers.get("content-security-policy-report-only")).toBeNull();
  });

  it("매 요청마다 서로 다른 nonce 가 박힌다 (100회 호출 → unique 100)", async () => {
    vi.stubEnv("CSP_MODE", "");
    vi.resetModules();
    const middleware = (await import("../middleware")).default as (
      req: NextRequest,
    ) => Promise<Response> | Response;

    const nonces = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const req = new NextRequest("http://localhost:3000/products");
      Object.defineProperty(req, "auth", { value: null, configurable: true });
      Object.defineProperty(req, "nextUrl", {
        value: new URL("http://localhost:3000/products"),
        configurable: true,
      });
      const res = await middleware(req);
      const csp = res.headers.get("content-security-policy-report-only") ?? "";
      const match = csp.match(/'nonce-([^']+)'/);
      expect(match, "nonce 가 추출 가능해야 한다").not.toBeNull();
      nonces.add(match![1]);
    }
    expect(nonces.size).toBe(100);
  });
});
