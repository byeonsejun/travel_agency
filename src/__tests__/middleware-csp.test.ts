import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * `auth()` wrapper 는 NextAuth 가 주입하는 verifyAuth/sessionMerge 로직.
 * 본 테스트는 *CSP 박제 동작* 만 검증하므로 wrapper 를 패스스루로 mock.
 *
 * ADR-0025 (경로별 CSP 분기): dynamic 경로(`/login`, `/checkout`, `/admin` 등) 만
 * nonce + 'strict-dynamic' 적용, 정적/ISR 경로(`/`, `/products/*`) 는 `script-src 'self'`
 * 로 완화. ISR 캐시-nonce 미스매치 차단이 동기.
 */
vi.mock("@/features/auth/server/auth", () => ({
  auth: (handler: unknown) => handler,
}));

type MiddlewareFn = (req: NextRequest) => Promise<Response> | Response;

function buildReq(url: string): NextRequest {
  const req = new NextRequest(url);
  Object.defineProperty(req, "auth", { value: null, configurable: true });
  Object.defineProperty(req, "nextUrl", { value: new URL(url), configurable: true });
  return req;
}

async function loadMiddleware(): Promise<MiddlewareFn> {
  vi.resetModules();
  return (await import("../middleware")).default as MiddlewareFn;
}

describe("middleware — CSP 경로별 분기 (ADR-0025)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  describe("dynamic 경로 — nonce + 'strict-dynamic' 적용", () => {
    it("`/login` 응답에 Content-Security-Policy-Report-Only + nonce + strict-dynamic", async () => {
      vi.stubEnv("CSP_MODE", "");
      const middleware = await loadMiddleware();
      const res = await middleware(buildReq("http://localhost:3000/login"));
      const csp = res.headers.get("content-security-policy-report-only");
      expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    });

    it("`CSP_MODE=enforce` + `/checkout` → enforce 헤더로 전환", async () => {
      vi.stubEnv("CSP_MODE", "enforce");
      const middleware = await loadMiddleware();
      const res = await middleware(buildReq("http://localhost:3000/checkout"));
      expect(res.headers.get("content-security-policy")).toMatch(/'strict-dynamic'/);
      expect(res.headers.get("content-security-policy-report-only")).toBeNull();
    });

    it("매 요청마다 서로 다른 nonce 가 박힌다 (`/login` 100회 → unique 100)", async () => {
      vi.stubEnv("CSP_MODE", "");
      const middleware = await loadMiddleware();
      const nonces = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const res = await middleware(buildReq("http://localhost:3000/login"));
        const csp = res.headers.get("content-security-policy-report-only") ?? "";
        const match = csp.match(/'nonce-([^']+)'/);
        expect(match, "dynamic 경로에서는 nonce 가 추출 가능해야 한다").not.toBeNull();
        nonces.add(match![1]);
      }
      expect(nonces.size).toBe(100);
    });
  });

  describe("static/ISR 경로 — nonce 미발급, 'script-src self' 만", () => {
    it("`/` 응답에 CSP 헤더는 존재하되 nonce/strict-dynamic 모두 부재", async () => {
      vi.stubEnv("CSP_MODE", "");
      const middleware = await loadMiddleware();
      const res = await middleware(buildReq("http://localhost:3000/"));
      const csp = res.headers.get("content-security-policy-report-only") ?? "";
      expect(csp, "CSP 헤더 자체는 박혀야 함").not.toBe("");
      expect(csp).toMatch(/script-src 'self'\s*;/);
      expect(csp).not.toContain("nonce-");
      expect(csp).not.toContain("strict-dynamic");
    });

    it("`/products/123` (ISR) 도 동일하게 완화된 CSP 가 적용", async () => {
      vi.stubEnv("CSP_MODE", "");
      const middleware = await loadMiddleware();
      const res = await middleware(buildReq("http://localhost:3000/products/123"));
      const csp = res.headers.get("content-security-policy-report-only") ?? "";
      expect(csp).toMatch(/script-src 'self'\s*;/);
      expect(csp).not.toContain("nonce-");
    });

    it("`CSP_MODE=enforce` + 정적 경로 → enforce 헤더 + 완화 정책", async () => {
      vi.stubEnv("CSP_MODE", "enforce");
      const middleware = await loadMiddleware();
      const res = await middleware(buildReq("http://localhost:3000/"));
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp).toMatch(/script-src 'self'\s*;/);
      expect(csp).not.toContain("strict-dynamic");
      expect(res.headers.get("content-security-policy-report-only")).toBeNull();
    });
  });
});
