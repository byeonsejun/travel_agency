import { describe, it, expect } from "vitest";
import nextConfigModule from "../../next.config.mjs";

/**
 * `next.config.mjs` 는 `withSentryConfig(...)` 로 래핑된 wrapped config 를 default export.
 * wrapper 는 원본 config 를 그대로 보존하며 추가 옵션만 머지한다 → headers() 함수는 동일하게 노출.
 */
describe("next.config.mjs headers()", () => {
  const cfg = nextConfigModule as {
    headers?: () => Promise<
      Array<{ source: string; headers: Array<{ key: string; value: string }> }>
    >;
  };

  it("정적 보안 헤더 7종을 모든 경로(/:path*) 에 박제한다", async () => {
    expect(cfg.headers, "headers() 함수가 export 되어야 한다").toBeTypeOf("function");

    const rules = await cfg.headers!();
    expect(rules).toHaveLength(1);
    const rule = rules[0];
    expect(rule.source).toBe("/:path*");

    const headerMap = new Map(rule.headers.map((h) => [h.key, h.value]));

    expect(headerMap.get("Strict-Transport-Security")).toBe(
      "max-age=15552000; includeSubDomains",
    );
    expect(headerMap.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headerMap.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headerMap.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=()",
    );
    expect(headerMap.get("X-Frame-Options")).toBe("DENY");
    expect(headerMap.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(headerMap.get("Cross-Origin-Resource-Policy")).toBe("same-origin");

    expect(rule.headers).toHaveLength(7);
  });

  it("HSTS preload 토큰이 포함되지 않는다 (Rolling Expiration 정책)", async () => {
    const rules = await cfg.headers!();
    const hsts = rules[0].headers.find((h) => h.key === "Strict-Transport-Security");
    expect(hsts?.value).not.toContain("preload");
  });
});
