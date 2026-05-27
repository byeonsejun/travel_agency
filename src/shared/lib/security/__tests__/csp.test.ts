import { describe, it, expect } from "vitest";
import { buildCspHeader, CSP_NONCE_HEADER } from "../csp";

describe("buildCspHeader", () => {
  const NONCE = "AbCdEfGh0123456789==";

  it("reportOnly=true 일 때 headerName 이 -Report-Only 변종", () => {
    const out = buildCspHeader({ nonce: NONCE, reportOnly: true });
    expect(out.headerName).toBe("Content-Security-Policy-Report-Only");
  });

  it("reportOnly=false 일 때 headerName 이 enforce 변종", () => {
    const out = buildCspHeader({ nonce: NONCE, reportOnly: false });
    expect(out.headerName).toBe("Content-Security-Policy");
  });

  it("script-src 에 nonce 가 정확히 박힌다", () => {
    const out = buildCspHeader({ nonce: NONCE, reportOnly: true });
    expect(out.value).toContain(`script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'`);
  });

  it("directive 카탈로그 — 13개 directive 가 모두 존재 (§3.2 SSOT)", () => {
    const out = buildCspHeader({ nonce: NONCE, reportOnly: true });
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
    for (const d of required) {
      expect(out.value).toContain(d);
    }
  });

  it("CSP_NONCE_HEADER 상수가 'x-nonce'", () => {
    expect(CSP_NONCE_HEADER).toBe("x-nonce");
  });
});
