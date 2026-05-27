# Security Headers + Nonce CSP Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nextour 의 모든 HTML 응답에 프로덕션 수준 보안 헤더 7종(정적, `next.config.mjs`)과 nonce 기반 `strict-dynamic` CSP(동적, `src/middleware.ts`) 를 박제하고, `/api/csp-report` 엔드포인트로 위반을 Sentry 로 수렴시킨다. HSTS 는 Rolling Expiration (6개월) + Preload 배제.

**Architecture:** 두 채널 분리 — (1) `next.config.mjs` `headers()` 가 정적 7종(HSTS / X-Content-Type-Options / Referrer-Policy / Permissions-Policy / X-Frame-Options / COOP / CORP) 을 빌드타임 박제, (2) `middleware.ts` 가 요청별 16바이트 base64 nonce 를 `crypto.getRandomValues` 로 생성해 `Content-Security-Policy{-Report-Only}` 헤더와 `x-nonce` 요청 헤더로 동시 박제. `/api/csp-report` 는 Zod 검증 + AdBlock/확장프로그램 노이즈 필터 후 `captureMessage` 로 Sentry fanout. Report-Only → Enforce 전환은 정량 임계값 통과 7일 후 *명시적 시간 게이트* (Task 6~8, `[WAIT-MARKER]`).

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Zod 3 (페이로드/env 검증), Vitest 2 + happy-dom (테스트), `@sentry/nextjs` (이미 ADR-0021 로 wiring 됨 — `captureMessage` 재사용).

**선행 spec:** [`docs/superpowers/specs/2026-05-27-security-headers-design.md`](../specs/2026-05-27-security-headers-design.md)
**선행 ADR:** [ADR-0021 Sentry SDK adoption](../adr/0021-sentry-sdk-adoption.md) — `captureMessage` 와 `connect-src` Sentry ingest 도메인 의존.

---

## File Structure

**신규 파일:**
- `src/shared/lib/security/csp.ts` — `buildCspHeader` 순수 함수 + `CSP_NONCE_HEADER` 상수 (SSOT)
- `src/shared/lib/security/index.ts` — barrel export
- `src/shared/lib/security/__tests__/csp.test.ts` — `buildCspHeader` 단위 테스트
- `src/shared/lib/security/__tests__/csp-fixtures.test.ts` — directive 카탈로그 회귀 가드
- `src/app/api/csp-report/route.ts` — CSP 위반 신고 엔드포인트 (Zod + 노이즈 필터 + Sentry fanout)
- `src/app/api/csp-report/__tests__/route.test.ts` — 엔드포인트 동작 테스트
- `src/__tests__/middleware-csp.test.ts` — middleware nonce 주입 + 응답 헤더 검증
- `src/__tests__/next-config-headers.test.ts` — `next.config.mjs` `headers()` 정합성 가드

**수정 파일:**
- `next.config.mjs` — 정적 헤더 7종 `headers()` 함수 추가 (`withSentryConfig` 래퍼는 유지)
- `src/middleware.ts` — nonce 생성 + CSP 헤더 박제 + `x-nonce` 요청 헤더 전파 + matcher 확장
- `src/shared/lib/env.ts` — `CSP_MODE` schema 추가 (`z.enum(["report-only","enforce"]).optional()`)
- `src/shared/lib/__tests__/env.test.ts` — `CSP_MODE` 케이스 추가
- `.env.example` — `CSP_MODE=report-only` 주석 추가 (없으면 생성)

---

## Task 1: `next.config.mjs` 정적 보안 헤더 7종 박제

**Files:**
- Modify: `next.config.mjs`
- Create: `src/__tests__/next-config-headers.test.ts`

- [x] **Step 1: 실패하는 테스트 작성 (Red) — 7종 헤더 정합성 가드**

`src/__tests__/next-config-headers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import nextConfigModule from "../../next.config.mjs";

/**
 * `next.config.mjs` 는 `withSentryConfig(...)` 로 래핑된 wrapped config 를 default export.
 * wrapper 는 원본 config 를 그대로 보존하며 추가 옵션만 머지한다 → headers() 함수는 동일하게 노출.
 */
describe("next.config.mjs headers()", () => {
  it("정적 보안 헤더 7종을 모든 경로(/:path*) 에 박제한다", async () => {
    const config = (nextConfigModule as { headers?: () => Promise<unknown[]> })
      .headers;
    expect(config, "headers() 함수가 export 되어야 한다").toBeTypeOf("function");

    const rules = await config!();
    expect(rules).toHaveLength(1);
    const rule = rules[0] as { source: string; headers: Array<{ key: string; value: string }> };
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
    const config = (nextConfigModule as { headers?: () => Promise<unknown[]> }).headers;
    const rules = await config!();
    const hsts = (rules[0] as { headers: Array<{ key: string; value: string }> }).headers.find(
      (h) => h.key === "Strict-Transport-Security",
    );
    expect(hsts?.value).not.toContain("preload");
  });
});
```

- [x] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test src/__tests__/next-config-headers.test.ts`

Expected: FAIL — `headers() 함수가 export 되어야 한다` 또는 `expect(received).toBeTypeOf("function")` 실패.

- [x] **Step 3: `next.config.mjs` 에 `headers()` 함수 추가 (Green)**

`next.config.mjs` 전체 교체:

```js
/** @type {import('next').NextConfig} */
import { withSentryConfig } from "@sentry/nextjs";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=()",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      { protocol: "https", hostname: "picsum.photos" },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  hideSourceMaps: true,
});
```

- [x] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test src/__tests__/next-config-headers.test.ts`

Expected: PASS (2 케이스).

- [x] **Step 5: typecheck 통과 확인**

Run: `npm run typecheck`

Expected: exit 0.

- [x] **Step 6: 런타임 QA 증거 수집 — dev 서버 응답 헤더 검증**

Run (두 터미널 필요):
```bash
# 터미널 A: dev 서버 기동
npm run dev

# 터미널 B: curl 로 헤더 확인 — 7종 모두 출력되어야 함
curl -sI http://localhost:3000/ | grep -iE 'strict-transport-security|x-content-type-options|referrer-policy|permissions-policy|x-frame-options|cross-origin-opener-policy|cross-origin-resource-policy'
```

Expected: 7줄 출력. `Strict-Transport-Security: max-age=15552000; includeSubDomains` / `X-Content-Type-Options: nosniff` / `Referrer-Policy: strict-origin-when-cross-origin` / `Permissions-Policy: ...` / `X-Frame-Options: DENY` / `Cross-Origin-Opener-Policy: same-origin` / `Cross-Origin-Resource-Policy: same-origin` 모두 출현.

- [x] **Step 7: 체크박스 갱신 + 커밋**

`docs/superpowers/plans/2026-05-27-security-headers-wiring.md` 의 Task 1 항목을 `- [x]` 로 변경한 뒤:

```bash
git add next.config.mjs src/__tests__/next-config-headers.test.ts docs/superpowers/plans/2026-05-27-security-headers-wiring.md
git commit -m "feat(security): static security headers x7 in next.config.mjs (B2-B Task 1)"
```

---

## Task 2: `buildCspHeader` 순수 함수 + barrel export

**Files:**
- Create: `src/shared/lib/security/csp.ts`
- Create: `src/shared/lib/security/index.ts`
- Create: `src/shared/lib/security/__tests__/csp.test.ts`
- Create: `src/shared/lib/security/__tests__/csp-fixtures.test.ts`

- [x] **Step 1: 실패하는 테스트 작성 (Red) — `buildCspHeader` 동작 명세**

`src/shared/lib/security/__tests__/csp.test.ts`:

```ts
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
```

`src/shared/lib/security/__tests__/csp-fixtures.test.ts` (카탈로그 회귀 가드):

```ts
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
```

- [x] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test src/shared/lib/security`

Expected: FAIL — `Cannot find module '../csp'` 또는 import 해소 실패.

- [x] **Step 3: `buildCspHeader` 순수 함수 구현 (Green)**

`src/shared/lib/security/csp.ts`:

```ts
/**
 * CSP 헤더 빌더 — 순수 함수.
 * directive 카탈로그는 docs/superpowers/specs/2026-05-27-security-headers-design.md §3.2 가 SSOT.
 * 환경변수에 의존하지 않는다 → 테스트는 nonce/reportOnly 만 주입하면 충분.
 */

export const CSP_NONCE_HEADER = "x-nonce" as const;

export type CspBuildInput = {
  nonce: string;
  reportOnly: boolean;
};

export type CspBuildOutput = {
  headerName: "Content-Security-Policy" | "Content-Security-Policy-Report-Only";
  value: string;
};

export function buildCspHeader({ nonce, reportOnly }: CspBuildInput): CspBuildOutput {
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https://*.supabase.co https://picsum.photos`,
    `font-src 'self' data:`,
    `connect-src 'self' https://*.ingest.sentry.io https://api.tosspayments.com https://*.supabase.co`,
    `frame-src 'self' https://js.tosspayments.com`,
    `frame-ancestors 'none'`,
    `form-action 'self' https://api.tosspayments.com`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
    `report-uri /api/csp-report`,
  ];

  return {
    headerName: reportOnly
      ? "Content-Security-Policy-Report-Only"
      : "Content-Security-Policy",
    value: directives.join("; "),
  };
}
```

`src/shared/lib/security/index.ts`:

```ts
export { buildCspHeader, CSP_NONCE_HEADER } from "./csp";
export type { CspBuildInput, CspBuildOutput } from "./csp";
```

- [x] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test src/shared/lib/security`

Expected: PASS (csp.test.ts 5건 + csp-fixtures.test.ts 7건 = 총 12건).

- [x] **Step 5: typecheck 통과 확인**

Run: `npm run typecheck`

Expected: exit 0.

- [x] **Step 6: 체크박스 갱신 + 커밋**

Task 2 항목을 `- [x]` 로 변경 후:

```bash
git add src/shared/lib/security/ docs/superpowers/plans/2026-05-27-security-headers-wiring.md
git commit -m "feat(security): buildCspHeader pure fn + barrel + catalogue regression guard (B2-B Task 2)"
```

---

## Task 3: `env.ts` 에 `CSP_MODE` schema 추가

**Files:**
- Modify: `src/shared/lib/env.ts`
- Modify: `src/shared/lib/__tests__/env.test.ts`
- Modify (또는 Create): `.env.example`

- [x] **Step 1: 실패하는 테스트 작성 (Red) — `CSP_MODE` 3 케이스**

`src/shared/lib/__tests__/env.test.ts` 끝에 `describe("CSP_MODE", ...)` 블록 추가 (기존 describe 블록들 보존):

```ts
describe("CSP_MODE", () => {
  // 다른 describe 블록과 동일한 baseEnv 패턴 재사용. baseEnv 는 파일 상단에 이미 정의되어 있다고 가정.
  // 만약 정의되어 있지 않다면 envSchema 가 통과하는 최소 값 세트를 인라인으로 구성.
  const baseEnv = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    NEXTAUTH_SECRET: "test-secret-test-secret-test-secret-test-secret",
    NEXTAUTH_URL: "http://localhost:3000",
  };

  it("미설정 시 undefined — 기본 report-only 동작 (middleware 에서 분기)", () => {
    const parsed = envSchema.parse(baseEnv);
    expect(parsed.CSP_MODE).toBeUndefined();
  });

  it("CSP_MODE=report-only — 통과", () => {
    const parsed = envSchema.parse({ ...baseEnv, CSP_MODE: "report-only" });
    expect(parsed.CSP_MODE).toBe("report-only");
  });

  it("CSP_MODE=enforce — 통과", () => {
    const parsed = envSchema.parse({ ...baseEnv, CSP_MODE: "enforce" });
    expect(parsed.CSP_MODE).toBe("enforce");
  });

  it("CSP_MODE=invalid — Zod 실패", () => {
    expect(() => envSchema.parse({ ...baseEnv, CSP_MODE: "bogus" })).toThrow();
  });
});
```

> **주의**: 위 `baseEnv` 객체는 *기존 `env.test.ts` 의 baseEnv 가 export 되어 있다면 import 로 재사용*하는 것이 우선. 없다면 위 인라인 정의로 진행하고, 기존 describe 블록의 baseEnv 패턴과 어긋나지 않는지 한 번 더 확인.

- [x] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test src/shared/lib/__tests__/env.test.ts`

Expected: 새로 추가한 CSP_MODE 케이스 4건이 모두 FAIL — `expected 'report-only' to be undefined` 또는 schema 가 `CSP_MODE` 키를 모름.

- [x] **Step 3: `envSchema` 에 `CSP_MODE` 추가 (Green)**

`src/shared/lib/env.ts` 의 `envSchema = z.object({ ... })` 블록 내, 기존 `SENTRY_DSN` 다음 자리에 추가:

```ts
    // CSP 헤더 모드 — 미설정 또는 'report-only' = 위반 신고만,
    // 'enforce' = 실제 차단. 롤아웃 게이트(Plan Task 6~8)에서 단계적 전환.
    CSP_MODE: z.enum(["report-only", "enforce"]).optional(),
```

- [x] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test src/shared/lib/__tests__/env.test.ts`

Expected: PASS — 신규 4건 포함 모든 케이스 통과.

- [x] **Step 5: `.env.example` 갱신**

`.env.example` 끝에 추가 (파일이 없다면 신규 생성하면서 기존 env 키들의 안전한 placeholder 와 함께 작성):

```bash
# CSP 모드 — 'report-only' (기본, 위반 신고만) 또는 'enforce' (실제 차단).
# 신규 배포는 report-only 로 시작 → §5 Plan Task 6~8 정량 임계값 통과 후 enforce 전환.
CSP_MODE=report-only
```

- [x] **Step 6: typecheck 통과 확인**

Run: `npm run typecheck`

Expected: exit 0.

- [x] **Step 7: 체크박스 갱신 + 커밋**

Task 3 항목을 `- [x]` 로 변경 후:

```bash
git add src/shared/lib/env.ts src/shared/lib/__tests__/env.test.ts .env.example docs/superpowers/plans/2026-05-27-security-headers-wiring.md
git commit -m "feat(env): add CSP_MODE schema (report-only|enforce) + .env.example (B2-B Task 3)"
```

---

## Task 4: `middleware.ts` nonce 주입 + CSP 헤더 박제 + matcher 확장

**Files:**
- Modify: `src/middleware.ts`
- Create: `src/__tests__/middleware-csp.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성 (Red) — middleware 응답에 CSP 박제 + nonce 랜덤성**

`src/__tests__/middleware-csp.test.ts`:

```ts
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
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test src/__tests__/middleware-csp.test.ts`

Expected: FAIL — 응답 헤더에 `content-security-policy-report-only` 가 존재하지 않음 (현재 middleware 는 `x-trace-id` 만 박제).

- [ ] **Step 3: `src/middleware.ts` 에 nonce 생성 + CSP 박제 추가 (Green)**

`src/middleware.ts` 전체 교체 (기존 인증 가드 로직 보존 + CSP 블록 추가 + matcher 확장):

```ts
import { auth } from "@/features/auth/server/auth";
import { NextResponse } from "next/server";
import { buildCspHeader, CSP_NONCE_HEADER } from "@/shared/lib/security";

export default auth((req) => {
  // Edge runtime — ALS/Prisma import 금지. crypto.randomUUID() / getRandomValues() 만 사용.
  const traceId =
    req.headers.get("x-trace-id") ??
    crypto.randomUUID().replace(/-/g, "").slice(0, 16);

  const { pathname } = req.nextUrl;
  const isAuthenticated = !!req.auth;
  const role = req.auth?.user?.role;

  const callbackTarget = `${pathname}${req.nextUrl.search}`;

  if (pathname.startsWith("/login") && isAuthenticated) {
    const res = NextResponse.redirect(new URL("/", req.url));
    res.headers.set("x-trace-id", traceId);
    return res;
  }

  if (pathname.startsWith("/admin")) {
    if (!isAuthenticated || role !== "ADMIN") {
      const url = new URL("/login", req.url);
      url.searchParams.set("callbackUrl", callbackTarget);
      const res = NextResponse.redirect(url);
      res.headers.set("x-trace-id", traceId);
      return res;
    }
  }

  const authRequired = ["/mypage", "/booking", "/bookings"];
  if (authRequired.some((p) => pathname.startsWith(p))) {
    if (!isAuthenticated) {
      const url = new URL("/login", req.url);
      url.searchParams.set("callbackUrl", callbackTarget);
      const res = NextResponse.redirect(url);
      res.headers.set("x-trace-id", traceId);
      return res;
    }
  }

  // 요청별 nonce — 16바이트 base64 (Edge runtime 호환).
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = btoa(String.fromCharCode(...nonceBytes));

  // 요청 헤더에 traceId + nonce 박제 → RSC tree 가 headers() API 로 회수.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-trace-id", traceId);
  requestHeaders.set(CSP_NONCE_HEADER, nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-trace-id", traceId);

  // CSP 헤더 박제 — CSP_MODE=enforce 가 아니면 Report-Only 가 기본 (롤아웃 게이트).
  const csp = buildCspHeader({
    nonce,
    reportOnly: process.env.CSP_MODE !== "enforce",
  });
  response.headers.set(csp.headerName, csp.value);

  return response;
});

export const config = {
  // CSP nonce 는 모든 HTML 응답에 박혀야 함.
  // _next/static, _next/image, favicon, /api/csp-report (재귀 방지) 만 제외.
  // missing 조건은 Next 의 RSC prefetch 호출에서 middleware 가 nonce 를 다시 생성하지 않도록 함.
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|api/csp-report).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
```

> **인증 가드 회귀 주의**: 기존 matcher 5종(`/login/...`, `/admin/...`, `/mypage/...`, `/booking/...`, `/bookings/...`, `/products/[id]/checkout`)은 negative-pattern matcher 로 *모두 포괄됨* (해당 경로들이 negative 에 걸리지 않으므로 middleware 가 거친다). `pathname.startsWith` 분기 자체는 그대로 → 인증 가드 동작 보존.

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test src/__tests__/middleware-csp.test.ts`

Expected: PASS (3 케이스).

- [ ] **Step 5: 기존 인증 가드 회귀 테스트 통과 확인**

기존 인증 가드 관련 테스트가 있다면 함께 실행:

Run: `npm run test`

Expected: 전체 PASS — 신규 + 기존 모두 통과.

- [ ] **Step 6: typecheck 통과 확인**

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 7: 런타임 QA 증거 수집 — 두 요청의 nonce 가 다르고 Report-Only 헤더가 박힌다**

Run (dev 서버 실행 중 가정):
```bash
# nonce 동적성 검증 — 두 호출의 nonce 값 추출 후 비교
NONCE_A=$(curl -sI http://localhost:3000/ | grep -i 'content-security-policy-report-only' | grep -oE "'nonce-[^']+'" | head -1)
NONCE_B=$(curl -sI http://localhost:3000/ | grep -i 'content-security-policy-report-only' | grep -oE "'nonce-[^']+'" | head -1)
echo "A=$NONCE_A"
echo "B=$NONCE_B"
test "$NONCE_A" != "$NONCE_B" && echo "✅ nonce 가 매 요청 다름" || echo "❌ nonce 가 동일 — 검증 실패"
```

Expected: `A=` 와 `B=` 가 서로 다른 nonce 값, `✅` 메시지 출력.

추가 검증 — `/admin` 비인증 접근이 여전히 `/login` 으로 리다이렉트:

```bash
curl -sI http://localhost:3000/admin | grep -iE 'location|content-security-policy'
```

Expected: `Location: /login?callbackUrl=...` + CSP 헤더 *없음* (redirect 응답이라 CSP 박제 경로 미진입 — 기존 redirect 경로 보존 정합).

- [ ] **Step 8: 체크박스 갱신 + 커밋**

Task 4 항목을 `- [x]` 로 변경 후:

```bash
git add src/middleware.ts src/__tests__/middleware-csp.test.ts docs/superpowers/plans/2026-05-27-security-headers-wiring.md
git commit -m "feat(security): middleware nonce injection + CSP header + matcher expansion (B2-B Task 4)"
```

---

## Task 5: `/api/csp-report` 엔드포인트 — Zod + 노이즈 필터 + Sentry fanout

**Files:**
- Create: `src/app/api/csp-report/route.ts`
- Create: `src/app/api/csp-report/__tests__/route.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성 (Red) — 5 케이스 매트릭스**

`src/app/api/csp-report/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const captureMessageMock = vi.fn();
vi.mock("@/shared/lib/observability", () => ({
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}));

const loggerMock = {
  debug: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
};
vi.mock("@/shared/lib/observability/logger", () => ({
  logger: loggerMock,
}));

async function postReport(body: unknown, contentType = "application/csp-report") {
  const { POST } = await import("../route");
  const req = new Request("http://localhost:3000/api/csp-report", {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(req);
}

describe("/api/csp-report", () => {
  beforeEach(() => {
    captureMessageMock.mockReset();
    loggerMock.debug.mockReset();
    loggerMock.warn.mockReset();
  });

  it("정상 페이로드 → 200 + captureMessage 1회 호출", async () => {
    const res = await postReport({
      "csp-report": {
        "violated-directive": "script-src-elem",
        "blocked-uri": "https://evil.com/inject.js",
        "document-uri": "http://localhost:3000/products/abc",
      },
    });
    expect(res.status).toBe(200);
    expect(captureMessageMock).toHaveBeenCalledTimes(1);
    expect(captureMessageMock.mock.calls[0][0]).toContain("CSP violation");
  });

  it("Zod 실패 (csp-report 누락) → 200 silent + captureMessage 0회 + logger.warn 1회", async () => {
    const res = await postReport({ malformed: true });
    expect(res.status).toBe(200);
    expect(captureMessageMock).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "csp.report.invalid_payload",
      expect.any(Object),
    );
  });

  it("chrome-extension blocked-uri → 200 + captureMessage 0회 (노이즈 필터)", async () => {
    const res = await postReport({
      "csp-report": {
        "violated-directive": "script-src",
        "blocked-uri": "chrome-extension://abcdefg/inject.js",
      },
    });
    expect(res.status).toBe(200);
    expect(captureMessageMock).not.toHaveBeenCalled();
    expect(loggerMock.debug).toHaveBeenCalledWith(
      "csp.report.noise_filtered",
      expect.any(Object),
    );
  });

  it("Content-Type 누락 → 415", async () => {
    const res = await postReport({ "csp-report": {} }, "text/plain");
    expect(res.status).toBe(415);
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("잘못된 JSON → 200 silent (브라우저 재시도 방지)", async () => {
    const res = await postReport("not-a-json{{{", "application/csp-report");
    expect(res.status).toBe(200);
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("moz-extension source-file → 노이즈 필터", async () => {
    const res = await postReport({
      "csp-report": {
        "violated-directive": "script-src",
        "blocked-uri": "https://evil.com/x.js",
        "source-file": "moz-extension://uuid/content.js",
      },
    });
    expect(res.status).toBe(200);
    expect(captureMessageMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test src/app/api/csp-report/__tests__/route.test.ts`

Expected: FAIL — `Cannot find module '../route'`.

- [ ] **Step 3: 엔드포인트 구현 (Green)**

`src/app/api/csp-report/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { captureMessage } from "@/shared/lib/observability";
import { logger } from "@/shared/lib/observability/logger";

/**
 * CSP Level 2 report-uri payload schema.
 * - 모든 필드 optional — 브라우저 구현 편차 흡수
 * - 필드별 길이 상한 — 악의적 100MB JSON 차단
 */
const cspReportSchema = z.object({
  "csp-report": z.object({
    "document-uri": z.string().max(2048).optional(),
    "referrer": z.string().max(2048).optional(),
    "violated-directive": z.string().max(256).optional(),
    "effective-directive": z.string().max(256).optional(),
    "original-policy": z.string().max(4096).optional(),
    "disposition": z.enum(["report", "enforce"]).optional(),
    "blocked-uri": z.string().max(2048).optional(),
    "line-number": z.number().int().nonnegative().optional(),
    "column-number": z.number().int().nonnegative().optional(),
    "source-file": z.string().max(2048).optional(),
    "status-code": z.number().int().optional(),
    "script-sample": z.string().max(512).optional(),
  }),
});

/**
 * 브라우저 확장프로그램 · AdBlock 의 노이즈 패턴.
 * 사용자 시스템 잡음이라 Sentry 로 보내봤자 actionable 하지 않다 — quota 보호.
 */
const NOISE_BLOCKED_URI_PATTERNS = [
  /^chrome-extension:/i,
  /^moz-extension:/i,
  /^safari-extension:/i,
  /^safari-web-extension:/i,
  /^webkit-masked-url:/i,
  /^about:/i,
];

const NOISE_SOURCE_FILE_PATTERNS = [
  /^chrome-extension:/i,
  /^moz-extension:/i,
  /^safari-extension:/i,
];

type CspReportInner = z.infer<typeof cspReportSchema>["csp-report"];

function isNoiseReport(report: CspReportInner): boolean {
  const blocked = report["blocked-uri"] ?? "";
  const source = report["source-file"] ?? "";
  return (
    NOISE_BLOCKED_URI_PATTERNS.some((re) => re.test(blocked)) ||
    NOISE_SOURCE_FILE_PATTERNS.some((re) => re.test(source))
  );
}

export const runtime = "nodejs"; // ALS/errorTracker 의존 → Edge 금지

export async function POST(req: Request): Promise<NextResponse> {
  const contentType = req.headers.get("content-type") ?? "";
  const validContentType =
    contentType.includes("application/csp-report") ||
    contentType.includes("application/json");
  if (!validContentType) {
    return NextResponse.json({ ok: false }, { status: 415 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const parsed = cspReportSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn("csp.report.invalid_payload", { error: parsed.error.flatten() });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const report = parsed.data["csp-report"];

  if (isNoiseReport(report)) {
    logger.debug("csp.report.noise_filtered", {
      blockedUri: report["blocked-uri"],
      sourceFile: report["source-file"],
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  let blockedOrigin = "";
  try {
    blockedOrigin = new URL(report["blocked-uri"] ?? "").origin;
  } catch {
    blockedOrigin = report["blocked-uri"] ?? "unknown";
  }

  captureMessage(
    `CSP violation: ${report["violated-directive"]} blocked ${blockedOrigin}`,
    "warning",
    {
      cspViolatedDirective: report["violated-directive"],
      cspBlockedUri: report["blocked-uri"],
      cspDocumentUri: report["document-uri"],
      cspSourceFile: report["source-file"],
      cspDisposition: report["disposition"],
    },
  );

  return NextResponse.json({ ok: true }, { status: 200 });
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test src/app/api/csp-report/__tests__/route.test.ts`

Expected: PASS (6 케이스).

- [ ] **Step 5: typecheck + 전체 test 회귀 확인**

Run:
```bash
npm run typecheck
npm run test
```

Expected: exit 0 + 전체 테스트 PASS.

- [ ] **Step 6: 런타임 QA 증거 수집 — curl 시나리오 4종**

Run (dev 서버 실행 중 가정):

```bash
# (1) 정상 페이로드 → 200 + Sentry 전송 (서버 로그에 captureMessage 흔적)
curl -sX POST -H 'Content-Type: application/csp-report' \
  -d '{"csp-report":{"violated-directive":"script-src","blocked-uri":"https://evil.com/x.js"}}' \
  http://localhost:3000/api/csp-report -w "\n%{http_code}\n"
# Expected: {"ok":true}\n200

# (2) chrome-extension blocked-uri → 200 + 노이즈 필터 (서버 로그에 csp.report.noise_filtered)
curl -sX POST -H 'Content-Type: application/csp-report' \
  -d '{"csp-report":{"violated-directive":"script-src","blocked-uri":"chrome-extension://abc/x.js"}}' \
  http://localhost:3000/api/csp-report -w "\n%{http_code}\n"
# Expected: {"ok":true}\n200

# (3) 잘못된 JSON → 200 silent
curl -sX POST -H 'Content-Type: application/csp-report' \
  -d 'not-a-json{{{' \
  http://localhost:3000/api/csp-report -w "\n%{http_code}\n"
# Expected: {"ok":true}\n200

# (4) 잘못된 Content-Type → 415
curl -sX POST -H 'Content-Type: text/plain' \
  -d '{"csp-report":{}}' \
  http://localhost:3000/api/csp-report -w "\n%{http_code}\n"
# Expected: {"ok":false}\n415
```

Expected: 4개 시나리오 모두 위 주석의 응답값과 일치.

- [ ] **Step 7: 체크박스 갱신 + 커밋**

Task 5 항목을 `- [x]` 로 변경 후:

```bash
git add src/app/api/csp-report/ docs/superpowers/plans/2026-05-27-security-headers-wiring.md
git commit -m "feat(security): /api/csp-report endpoint with Zod + noise filter + Sentry fanout (B2-B Task 5)"
```

---

## ⏳ Task 6: [WAIT-MARKER] Preview 환경 Report-Only 배포 + S1→S2 1주 모니터링

> **🛑 STOP — 시간 게이트 Task. 서브에이전트는 본 Task 를 단일 세션에서 자동 실행 금지.**
> 본 Task 는 *7일의 실데이터 수집* 이 필수. spec §5.2 의 5개 정량 임계값을 연속 7일 충족해야 Task 7 로 진입.

**Files:**
- 코드 변경 없음 (Vercel 환경변수 + Sentry 대시보드 설정만)

- [ ] **Step 1: Preview 환경 배포 — Task 1~5 의 최신 main commit 을 preview 로 배포**

Run:
```bash
git push origin main
# Vercel 자동 preview deploy 트리거 — preview URL 받기
# 또는 Vercel CLI 보유 시: `vercel --no-clipboard` 로 preview deploy
```

Expected: Vercel preview deploy 성공 + preview URL 획득 (`https://<sha>-<project>.vercel.app`).

- [ ] **Step 2: Preview 환경변수 확인 — `CSP_MODE` 미설정 (= report-only 기본 동작)**

Vercel Dashboard → Project Settings → Environment Variables 에서 `CSP_MODE` 가 *Preview* scope 에 *설정되어 있지 않음* 확인. (만약 실수로 `enforce` 가 설정돼있다면 즉시 제거.)

확인 방법 — Preview URL 에서 응답 헤더 검증:

```bash
PREVIEW_URL="https://<your-preview-url>"
curl -sI "$PREVIEW_URL/" | grep -iE 'content-security-policy'
# Expected: 'Content-Security-Policy-Report-Only' 만 존재 (enforce 헤더 없음)
```

- [ ] **Step 3: Sentry `csp.violation` issue 알림 채널 연결 (옵션, 권장)**

Sentry Dashboard → Project → Alerts → Issue Alert 신규:
- Trigger: `event.message contains "CSP violation"`
- Action: 운영자 이메일 또는 Slack webhook
- Cooldown: 1시간 (alert storm 방지)

> 본 단계는 *없어도* 다음 Step 의 일일 점검이 가능하지만, 알림이 있으면 7일 모니터링 부담이 절반.

- [ ] **Step 4: 🛑 [WAIT-MARKER] — 7일 모니터링 대기**

> **본 Step 는 인간 운영자 또는 별 세션의 스케줄러가 7일에 걸쳐 수행. 단일 세션에서 통과 처리 금지.**

매일 1회 (또는 알림 트리거 시) 다음 5개 지표 점검 → 일별 기록 (스프레드시트 또는 plan 의 코멘트 영역):

| # | 지표 | 임계값 | 확인 방법 |
|---|---|---|---|
| M1 | 합법 origin 위반 0건 | 7일 누적 0건 | Sentry: `csp.violation` issue 중 `cspBlockedUri` 가 *우리가 의도하지 않은* origin (e.g. 갑작스런 3rd-party CDN) |
| M2 | inline script 위반 0건 | 7일 누적 0건 | Sentry: `cspViolatedDirective: script-src-elem` + `cspBlockedUri: inline` issue |
| M3 | /api/csp-report p95 latency < 50ms | 매일 50ms 이하 | Vercel Analytics 또는 Sentry transactions |
| M4 | Sentry quota daily < 17 events | 매일 17 events 이하 | Sentry Usage Dashboard |
| M5 | 골든패스 회귀 0건 | 매일 1회 시나리오 | preview 환경에서 홈→PDP→위시리스트→체크아웃→마이페이지 순회 후 `/api/csp-report` 수신 0건 |

매일 점검 명령 (preview 환경):
```bash
# (a) preview 헤더가 여전히 Report-Only 인지 확인
curl -sI "$PREVIEW_URL/" | grep -i 'content-security-policy-report-only' | head -1

# (b) Sentry 일일 CSP violation 카운트는 Sentry UI 에서 확인 — 자동화 불가
echo "📊 Sentry 대시보드에서 'csp.violation' 그룹의 daily new count 확인 필요"
```

- [ ] **Step 5: 7일 모니터링 결과 종합 + 게이트 판정**

7일치 일별 기록 검토 → 5개 지표 모두 충족 여부:
- ✅ 5개 모두 충족 → Task 7 로 진입
- ❌ 1개 이상 미달 → directive 보정 (e.g. 누락된 `connect-src` 추가) → re-deploy → 7일 카운터 리셋 → 다시 Step 4 부터

판정 결과를 본 plan 의 Task 6 끝에 한 줄로 박제 (예: `> ✅ 2026-06-03 게이트 통과 — Sentry 누적 위반 0건, p95 22ms`).

- [ ] **Step 6: 체크박스 갱신 + 커밋**

Task 6 모든 Step 을 `- [x]` 로 변경 후:

```bash
git add docs/superpowers/plans/2026-05-27-security-headers-wiring.md
git commit -m "ops(security): B2-B Task 6 complete — 7d Report-Only monitoring gate passed"
```

---

## ⏳ Task 7: [WAIT-MARKER] Preview Enforce 전환 + S2→S3 1주 모니터링

> **🛑 STOP — 시간 게이트 Task. Task 6 의 모든 지표가 7일 충족 후에만 진입.**
> 본 Task 도 *7일의 실데이터 수집* 이 필수. spec §5.3 의 4개 운영 임계값 (P1~P4) 을 연속 7일 충족해야 Task 8 진입.

**Files:**
- 코드 변경 없음 (Vercel 환경변수만)

- [ ] **Step 1: Preview 환경에 `CSP_MODE=enforce` 박제**

Vercel Dashboard → Project Settings → Environment Variables:
- Key: `CSP_MODE`
- Value: `enforce`
- Scope: ✅ Preview / ✗ Production / ✗ Development

저장 후 *redeploy* 트리거 (latest commit re-deploy).

확인:
```bash
curl -sI "$PREVIEW_URL/" | grep -iE 'content-security-policy'
# Expected: 'Content-Security-Policy: ...' 만 (Report-Only 헤더 없음)
```

- [ ] **Step 2: 골든패스 즉시 회귀 검증 (Enforce 전환 직후 60분 내)**

Preview 환경에서 다음 시나리오를 *수동으로* 실행 → 모든 페이지 정상 동작 + CSP 차단 0건 확인:

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | 홈 (`/`) 접근 | 정상 렌더 + DevTools Console 에 CSP error 0건 |
| 2 | 상품 목록 (`/products`) | 카드 이미지 정상 로드 (Supabase / Picsum) |
| 3 | 상품 상세 (`/products/[id]`) | wishlist 토글 island 동작 |
| 4 | 위시리스트 (`/mypage/wishlist`) | 토글 시 깜빡임 없음 |
| 5 | 체크아웃 진입 (`/products/[id]/checkout`) | Toss 결제 위젯 iframe 정상 로드 (frame-src) |
| 6 | 결제 모의 (`test_` 키, Mock) | confirm API 호출 정상 (connect-src tosspayments) |
| 7 | 마이페이지 (`/mypage`) | 인증 가드 + 사용자 데이터 정상 |
| 8 | global-error 트리거 (강제 throw) | global-error.tsx 렌더 + Sentry capture |

회귀 1건이라도 발견 → **즉시 Vercel 환경변수 `CSP_MODE` 를 `report-only` 로 되돌리고 Task 6 의 모니터링부터 다시 시작**.

- [ ] **Step 3: 🛑 [WAIT-MARKER] — 7일 모니터링 대기**

> **본 Step 는 인간 운영자 또는 별 세션 스케줄러가 7일에 걸쳐 수행. 단일 세션에서 통과 처리 금지.**

매일 1회 다음 4개 지표 점검:

| # | 지표 | 임계값 | 확인 방법 |
|---|---|---|---|
| P1 | Preview p95 LCP | baseline +50ms 이하 | Vercel Analytics (Web Vitals) |
| P2 | Preview CSP 차단 카운터 | 일 100건 이하 | Sentry `csp.violation` 그룹 daily new |
| P3 | Preview 5xx error rate | baseline +0.1% 이하 | Vercel Logs / Sentry transactions |
| P4 | 체크아웃 완료율 | baseline ±2% 이내 | 자체 metric (booking PAID transitions) — 수동 집계 또는 별 메트릭 도입 |

> P4 가 자동화 어렵다면 *Preview 트래픽이 적어 측정 불가* 라는 사실을 기록하고 **production deploy 후 (Task 8) 동일 임계값으로 운영 1주 재검증** 으로 위임.

- [ ] **Step 4: 7일 모니터링 결과 종합 + 게이트 판정**

7일치 일별 기록 검토 → 4개 지표 모두 충족 여부:
- ✅ 4개 모두 충족 → Task 8 로 진입
- ❌ 1개 이상 미달 → 즉시 `CSP_MODE=report-only` 롤백 → root cause 분석 → directive 보정 후 Task 6 부터 재시작

판정 결과를 본 plan 의 Task 7 끝에 한 줄로 박제.

- [ ] **Step 5: 체크박스 갱신 + 커밋**

Task 7 모든 Step 을 `- [x]` 로 변경 후:

```bash
git add docs/superpowers/plans/2026-05-27-security-headers-wiring.md
git commit -m "ops(security): B2-B Task 7 complete — 7d Preview Enforce monitoring gate passed"
```

---

## ⏳ Task 8: [WAIT-MARKER] Production Enforce + 운영 1주 무사고 + ADR 발행

> **🛑 STOP — 시간 게이트 Task. Task 7 의 모든 지표가 7일 충족 후에만 진입.**
> 본 Task 도 *7일의 운영 모니터링* 이 필수. 무사고 7일 후 ADR-0022 박제.

**Files:**
- Create: `docs/superpowers/adr/0022-security-headers-and-csp.md`
- Modify: `docs/superpowers/adr/README.md`
- Modify: `CLAUDE.md` (Phase 3 B2-B 완료 박제)

- [ ] **Step 1: Production 환경에 `CSP_MODE=enforce` 박제**

Vercel Dashboard → Environment Variables:
- Key: `CSP_MODE`
- Value: `enforce`
- Scope: ✅ Production (+ Preview 도 enforce 유지)

저장 후 *production redeploy* (latest main commit promote 또는 redeploy).

확인:
```bash
PROD_URL="https://<your-production-domain>"
curl -sI "$PROD_URL/" | grep -iE 'content-security-policy'
# Expected: 'Content-Security-Policy: ...' (Report-Only 헤더 없음)

# 보안 헤더 7종 검증
curl -sI "$PROD_URL/" | grep -iE 'strict-transport-security|x-content-type-options|referrer-policy|permissions-policy|x-frame-options|cross-origin-opener-policy|cross-origin-resource-policy'
# Expected: 7줄 출력
```

- [ ] **Step 2: 외부 보안 스코어 도구로 검증 (옵션, 권장)**

- [securityheaders.com](https://securityheaders.com/) 에 production URL 입력 → **A+ 등급** 확인
- [Mozilla Observatory](https://observatory.mozilla.org) → **A 등급 이상** 확인

> A+ / A 미달 시 거부 사유 확인 후 directive 보정 (대부분 `style-src` 의 `'unsafe-inline'` 이 -5점 영향, 본 PR 범위 밖이므로 의도된 점수 감점).

- [ ] **Step 3: 🛑 [WAIT-MARKER] — 운영 7일 모니터링**

> **본 Step 는 인간 운영자 또는 별 세션 스케줄러가 7일에 걸쳐 수행. 단일 세션에서 통과 처리 금지.**

Task 7 의 P1~P4 임계값을 *production traffic* 으로 재검증. 7일 무사고:
- ✅ P1~P4 모두 충족 → Step 4 진입
- ❌ 1개 이상 미달 → 즉시 `CSP_MODE` 환경변수를 `report-only` 로 production rollback (헤더 1줄 변경, 다음 cold start 즉시 반영) → Task 6 부터 재시작

- [ ] **Step 4: ADR-0022 작성**

`docs/superpowers/adr/0022-security-headers-and-csp.md` 작성 — `template.md` 복사 후 4섹션 채움:

- **Context** — Phase 3 B2-B 진입 배경 (관측 가능성 B2-A 완료 후 공격 표면적 축소 차례). 정적 헤더 7종 + 동적 CSP 두 채널 분리의 필요성.
- **Decision** — nonce-based `strict-dynamic` CSP + HSTS Rolling Expiration (6개월, preload 배제) + 정적 헤더 7종. 코드 핵심 인용 (`buildCspHeader` 1~3줄 + middleware nonce 생성 1줄).
- **Consequences** — 얻은 것: securityheaders.com A+, MITM 통제, XSS 표면적 축소, Clickjacking 차단, Sentry 로 CSP 위반 가시화. 포기/미해결: `style-src 'unsafe-inline'` 유지 (별 PR), Trusted Types 미도입, SRI 미도입, Rate Limit (B2-C) 미도입.
- **Alternatives Considered** — spec §9 의 옵션 A~H 8종을 그대로 옮겨 박제. 특히 옵션 D (HSTS Preload 신청) 거부 사유 4가지를 *원문 그대로* (롤백 불가성 / 라이프사이클 리스크 / Rolling 충분 / 성숙도-비용 미스매치) 박제.

- [ ] **Step 5: ADR 인덱스 갱신**

`docs/superpowers/adr/README.md` 의 인덱스 표에 한 줄 추가:

```markdown
| 0022  | [Security Headers + Nonce CSP + HSTS Rolling Expiration](./0022-security-headers-and-csp.md) | Accepted | 2026-XX-XX   |
```

- [ ] **Step 6: `CLAUDE.md` 의 Phase 진행 컨텍스트 갱신**

§8 ("기억해야 할 컨텍스트") 의 "Phase 3 B1 완료" 줄을 다음으로 교체:

> Phase 1 + Phase 2 + Phase 3 B1 (캐시 튜닝) + Phase 3 B2-A (Sentry SDK) + **Phase 3 B2-B (보안 헤더 + nonce CSP)** 완료 — securityheaders.com A+, HSTS Rolling Expiration 6개월(preload 배제, [ADR-0022]), 정적 헤더 7종 + nonce strict-dynamic CSP, `/api/csp-report` Sentry fanout.

또한 §8 의 "다음 작업자의 혼란 방지 노트" 에 한 줄 추가:

> "왜 HSTS preload 가 없지?" → [ADR-0022] 박제. 포트폴리오 도메인 라이프사이클 + 1인 운영 + Rolling Expiration 의 충분성. 조직 성숙도 트리거 4개 충족 시 재검토.

- [ ] **Step 7: 통합 검증 (QA Engineer R8) — 전체 회귀**

Run:
```bash
npm run typecheck
npm run test
npm run lint
```

Expected: 모두 exit 0.

런타임 증거 — production:
```bash
# 보안 헤더 7+1종 (정적 7 + 동적 CSP)
curl -sI "$PROD_URL/" | grep -iE 'strict-transport-security|x-content-type-options|referrer-policy|permissions-policy|x-frame-options|cross-origin-opener-policy|cross-origin-resource-policy|content-security-policy'
# Expected: 8줄

# HSTS preload 토큰 없음 검증
curl -sI "$PROD_URL/" | grep -i 'strict-transport-security' | grep -v preload
# Expected: 1줄 출력 (preload 부재 확인)

# CSP enforce 모드 확인 (Report-Only 헤더 부재)
curl -sI "$PROD_URL/" | grep -i 'content-security-policy-report-only'
# Expected: 0줄
```

- [ ] **Step 8: 체크박스 갱신 + 최종 커밋**

Task 8 모든 Step 을 `- [x]` 로 변경 후:

```bash
git add docs/superpowers/adr/0022-security-headers-and-csp.md \
  docs/superpowers/adr/README.md \
  CLAUDE.md \
  docs/superpowers/plans/2026-05-27-security-headers-wiring.md
git commit -m "docs(adr): 0022 security headers + nonce CSP + HSTS Rolling Expiration (B2-B 완료)"
```

---

## 종합 검증 — Plan 완료 시점 체크리스트

> Task 1~8 모두 완료 후 (즉, Task 8 Step 7 의 통합 검증 + Step 8 ADR 박제 후) 본 체크리스트로 *최종 자가 점검*. 본 체크리스트의 미완료는 plan 미완료다.

- [ ] `npm run typecheck` exit 0
- [ ] `npm run test` 전체 PASS (신규 약 40~50 케이스 포함)
- [ ] `npm run lint` exit 0
- [ ] production `curl -sI` 응답에 정적 헤더 7종 + `Content-Security-Policy` 1종 = 8개 헤더 출현
- [ ] production HSTS 헤더에 `preload` 토큰 *부재*
- [ ] production `CSP_MODE=enforce` (Report-Only 헤더 부재)
- [ ] [securityheaders.com](https://securityheaders.com/) A+ 등급 스크린샷 또는 결과 인용
- [ ] `docs/superpowers/adr/0022-security-headers-and-csp.md` 생성, 인덱스 갱신, 4섹션 모두 채움
- [ ] `CLAUDE.md` §8 B2-B 완료 박제
- [ ] 본 plan 파일의 Task 1~8 모든 체크박스 `- [x]`
- [ ] Sentry `csp.violation` issue 그룹에 production deploy 후 7일치 실데이터 + 게이트 통과 기록 박제 (옵션 — Sentry UI 스크린샷)

---

## Notes / 운영 메모

- **롤백 절차** (Production Enforce 후 사고 시): Vercel Dashboard → Environment Variables → `CSP_MODE` 값을 `enforce` → `report-only` 로 변경 → redeploy 트리거 (또는 next cold start 자동 반영). 헤더 1줄 변경으로 즉시 차단 해제, 위반 신고는 계속 수집.
- **Preload 재검토 트리거** (spec §3.3.3): 도메인 5년 잠금 / 인증서 갱신 모니터링 / 서브도메인 무사고 6개월 / 비즈니스 요구 — 4개 모두 충족 시 ADR-0022 superseded by ADR-NNNN 으로 재검토.
- **별 PR 후보** (spec §11): SRI / Trusted Types / Reporting API Level 3 / `style-src` nonce 화 / Rate Limit B2-C.
- **Sentry quota 모니터링**: `csp.violation` 그룹이 일 50건 초과로 증가하면 노이즈 필터 정규식 매트릭스 확장 검토 (e.g. 신규 브라우저 확장 패턴).
