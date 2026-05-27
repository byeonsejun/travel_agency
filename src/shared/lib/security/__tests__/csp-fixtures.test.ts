import { describe, it, expect } from "vitest";
import { buildCspHeader } from "../csp";

/**
 * directive 누군가 임의로 빼면 즉시 빨간불.
 * 본 테스트는 §3.2 의 SSOT 를 외부에서 한 번 더 잠그는 안전망.
 */
describe("CSP directive 카탈로그 회귀 가드", () => {
  const out = buildCspHeader({ nonce: "TEST_NONCE_VALUE", reportOnly: true });

  it("Sentry ingest 도메인이 connect-src 에 포함", () => {
    expect(out.value).toMatch(/connect-src[^;]*https:\/\/\*\.ingest\.sentry\.io/);
  });

  it("Toss 결제 위젯 iframe 이 frame-src 에 포함", () => {
    expect(out.value).toMatch(/frame-src[^;]*https:\/\/js\.tosspayments\.com/);
  });

  it("Toss API 가 form-action + connect-src 에 포함", () => {
    expect(out.value).toMatch(/connect-src[^;]*https:\/\/api\.tosspayments\.com/);
    expect(out.value).toMatch(/form-action[^;]*https:\/\/api\.tosspayments\.com/);
  });

  it("frame-ancestors 'none' 으로 Clickjacking 차단", () => {
    expect(out.value).toMatch(/frame-ancestors 'none'/);
  });

  it("report-uri 가 /api/csp-report 로 박혀있다", () => {
    expect(out.value).toMatch(/report-uri \/api\/csp-report/);
  });

  it("object-src 'none' 으로 Flash/PDF 잔존 공격면 차단", () => {
    expect(out.value).toMatch(/object-src 'none'/);
  });

  it("upgrade-insecure-requests 가 존재", () => {
    expect(out.value).toMatch(/upgrade-insecure-requests/);
  });
});
