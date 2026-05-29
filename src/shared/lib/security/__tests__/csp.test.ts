import { describe, it, expect } from "vitest";
import { buildCspHeader, CSP_NONCE_HEADER, isDynamicCspPath } from "../csp";

describe("buildCspHeader", () => {
  const NONCE = "AbCdEfGh0123456789==";

  describe("dynamic 모드 — nonce + 'strict-dynamic' (보안 민감 경로)", () => {
    it("reportOnly=true 일 때 headerName 이 -Report-Only 변종", () => {
      const out = buildCspHeader({ mode: "dynamic", nonce: NONCE, reportOnly: true });
      expect(out.headerName).toBe("Content-Security-Policy-Report-Only");
    });

    it("reportOnly=false 일 때 headerName 이 enforce 변종", () => {
      const out = buildCspHeader({ mode: "dynamic", nonce: NONCE, reportOnly: false });
      expect(out.headerName).toBe("Content-Security-Policy");
    });

    it("script-src 에 nonce + 'strict-dynamic' 가 함께 박힌다", () => {
      const out = buildCspHeader({ mode: "dynamic", nonce: NONCE, reportOnly: true });
      expect(out.value).toContain(`script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'`);
    });
  });

  describe("static 모드 — nonce/strict-dynamic 제거 (ISR/캐시 경로)", () => {
    it("reportOnly 토글이 dynamic 과 동일하게 작동", () => {
      expect(buildCspHeader({ mode: "static", reportOnly: true }).headerName).toBe(
        "Content-Security-Policy-Report-Only",
      );
      expect(buildCspHeader({ mode: "static", reportOnly: false }).headerName).toBe(
        "Content-Security-Policy",
      );
    });

    it("script-src 가 'self' + 'unsafe-inline' (Next 15 RSC hydration payload 허용), nonce/strict-dynamic 부재", () => {
      const out = buildCspHeader({ mode: "static", reportOnly: true });
      // ADR-0025 Addendum: Next 15 App Router 가 self.__next_f.push(...) flight chunk 를
      // 정적/ISR 페이지에도 인라인 <script> 로 emit. 'self' 만으로는 모두 차단됨.
      expect(out.value).toContain(`script-src 'self' 'unsafe-inline'`);
      expect(out.value).not.toContain("nonce-");
      expect(out.value).not.toContain("strict-dynamic");
    });
  });

  it("directive 카탈로그 — 13개 directive 가 두 모드 모두에서 존재 (§3.2 SSOT)", () => {
    const required = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.supabase.co https://picsum.photos",
      "font-src 'self' data:",
      "connect-src 'self' https://*.ingest.sentry.io https://api.tosspayments.com https://*.supabase.co",
      "frame-src 'self' https://js.tosspayments.com",
      "frame-ancestors 'none'",
      "form-action 'self' https://api.tosspayments.com",
      "base-uri 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
      "report-uri /api/csp-report",
    ];
    const fixtures = [
      { mode: "dynamic" as const, nonce: NONCE, reportOnly: true },
      { mode: "static" as const, reportOnly: true },
    ];
    for (const fixture of fixtures) {
      const out = buildCspHeader(fixture);
      for (const d of required) {
        expect(out.value, `${fixture.mode} mode missing directive: ${d}`).toContain(d);
      }
    }
  });

  it("CSP_NONCE_HEADER 상수가 'x-nonce'", () => {
    expect(CSP_NONCE_HEADER).toBe("x-nonce");
  });
});

describe("isDynamicCspPath — 경로별 CSP 분기 classifier", () => {
  // 동적/보안 민감 경로: nonce + strict-dynamic 강제 (force-dynamic 페이지 + 모든 API)
  it.each([
    "/admin",
    "/admin/products",
    "/checkout",
    "/checkout/123",
    "/payment",
    "/payment/widget",
    "/api",
    "/api/auth/session",
    "/api/booking/seat-hold",
    "/login",
    "/login?callbackUrl=/mypage",
    "/signup",
    "/booking",
    "/booking/abc",
    "/bookings",
    "/bookings/list",
    "/mypage",
    "/mypage/profile",
  ])("dynamic 경로 %s → true (nonce CSP 적용)", (path) => {
    expect(isDynamicCspPath(path)).toBe(true);
  });

  // 정적/ISR 경로: nonce CSP 적용 시 캐시-nonce 미스매치 발생 → 'self' 만으로 완화
  it.each(["/", "/products", "/products/123", "/products/japan-tour", "/search", "/about"])(
    "static/ISR 경로 %s → false (캐시 보존 위해 nonce 미적용)",
    (path) => {
      expect(isDynamicCspPath(path)).toBe(false);
    },
  );
});
