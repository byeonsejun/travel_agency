# Rate Limit Implementation Plan — Phase 3 B2-C

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@upstash/ratelimit` 기반 4-tier sliding window 속도 제한을 Hybrid 통합(Edge middleware global baseline + route/action wrapper tier-specific)으로 도입한다.

**Architecture:** `src/shared/lib/rate-limit/` primitives(tiers·identifier·client·enforce·headers) + 두 종류 wrapper(`withRateLimit` route handler 용 / `withRateLimitAction` Server Action 용) + middleware에 global tier만 적용. Fail-open degradation은 캐시 graceful 강등 선례를 그대로 차용. `RATE_LIMIT_MODE=shadow|enforce` 토글로 점진 롤아웃.

**Tech Stack:** Next.js 15 App Router (Edge middleware + Node route handlers), TypeScript strict, `@upstash/ratelimit` ^2.0.5, 기존 `@upstash/redis` ^1.38.0 클라이언트 재사용, Vitest 2, NextAuth v5.

**Spec:** [docs/superpowers/specs/2026-05-28-rate-limit-design.md](../specs/2026-05-28-rate-limit-design.md)

---

## File Structure (decomposition lock-in)

```
src/shared/lib/rate-limit/
  tiers.ts                # RATE_LIMIT_TIERS catalogue + bypass list + isBypassPath()
  identifier.ts           # getClientIp(req), identify(req, strategy, userId), hashIdForLog()
  client.ts               # Lazy singleton Redis + per-tier Ratelimit instances
  responseHeaders.ts      # buildRateLimitHeaders(verdict)
  enforce.ts              # enforce(tier, id) → RateLimitVerdict (fail-open, shadow-aware)
  withRateLimit.ts        # Route handler wrapper (NextRequest → NextResponse)
  withRateLimitAction.ts  # Server Action wrapper (args → result | redirect on block)
  index.ts                # Barrel
  __tests__/
    tiers.test.ts
    identifier.test.ts
    responseHeaders.test.ts
    enforce.test.ts
    withRateLimit.test.ts
    withRateLimitAction.test.ts

src/middleware.ts                              # MODIFY — global tier 통합
src/shared/lib/env.ts                          # MODIFY — RATE_LIMIT_MODE
.env.example                                   # MODIFY — RATE_LIMIT_MODE 안내

src/features/auth/server/actions.ts            # MODIFY — signInWithProvider을 withRateLimitAction 으로 wrap
src/app/api/payments/confirm/route.ts          # MODIFY — withRateLimit 으로 wrap
src/features/search/server/search.ts           # MODIFY — searchProducts를 withRateLimitAction 으로 wrap

docs/superpowers/adr/0022-rate-limit-hybrid-integration.md   # NEW
docs/superpowers/adr/0023-rate-limit-fail-open-policy.md     # NEW
docs/superpowers/adr/README.md                               # MODIFY — 인덱스에 0022/0023 추가
CLAUDE.md                                                    # MODIFY §8 — B2-C 완료 메모
```

**Public API contract** (이후 Task에서 일관 사용 — 사인 변경 금지):

```ts
// tiers.ts
export type RateLimitTier = "global" | "auth" | "payment" | "ai-search";
export type IdStrategy = "userFirst" | "ipOnly" | "userOnly";
export const RATE_LIMIT_TIERS: Record<RateLimitTier, TierConfig>;
export const RATE_LIMIT_BYPASS: readonly string[];
export function isBypassPath(pathname: string): boolean;

// identifier.ts
export function getClientIp(req: Request): string;
export function identify(req: Request, strategy: IdStrategy, userId: string | null | undefined): string;
export function hashIdForLog(id: string): string;

// client.ts
export function getRatelimiter(tier: RateLimitTier): import("@upstash/ratelimit").Ratelimit | null;
export function __resetRateLimitClientForTest(): void;

// responseHeaders.ts
export function buildRateLimitHeaders(verdict: RateLimitVerdict): Record<string, string>;

// enforce.ts
export interface RateLimitVerdict {
  readonly ok: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly reset: number;            // epoch seconds
  readonly retryAfterSeconds: number;
  readonly shadowed: boolean;
  readonly bypassed: boolean;
}
export function enforce(tier: RateLimitTier, identifier: string): Promise<RateLimitVerdict>;

// withRateLimit.ts (route handler)
export interface WithRateLimitOptions {
  tier: RateLimitTier;
  idStrategy?: IdStrategy;
  resolveUserId?: (req: import("next/server").NextRequest) => Promise<string | null>;
}
export function withRateLimit<Args extends unknown[]>(
  opts: WithRateLimitOptions,
  handler: (req: import("next/server").NextRequest, ...args: Args) => Promise<import("next/server").NextResponse>
): (req: import("next/server").NextRequest, ...args: Args) => Promise<import("next/server").NextResponse>;

// withRateLimitAction.ts (Server Action)
export interface WithRateLimitActionOptions {
  tier: RateLimitTier;
  idStrategy?: IdStrategy;
  resolveUserId?: () => Promise<string | null>;
  redirectOnBlock?: (retryAfterSeconds: number) => string;
}
export function withRateLimitAction<Args extends unknown[], R>(
  opts: WithRateLimitActionOptions,
  handler: (...args: Args) => Promise<R>
): (...args: Args) => Promise<R>;
```

---

## Task 1: 의존성 설치 + `RATE_LIMIT_MODE` env 추가

**Files:**
- Modify: `package.json`, `package-lock.json` (npm 자동 생성)
- Modify: `src/shared/lib/env.ts`
- Modify: `.env.example`
- Modify: `src/shared/lib/__tests__/env.test.ts`

- [x] **Step 1: 실패 테스트 작성 — `RATE_LIMIT_MODE` enum 검증**

`src/shared/lib/__tests__/env.test.ts`에 케이스 추가 (기존 describe 블록 안):

```ts
import { describe, expect, it } from "vitest";
import { envSchema } from "../env";

const base = {
  DATABASE_URL: "postgres://x:y@host/db",
  DIRECT_URL: "postgres://x:y@host/db",
  AUTH_SECRET: "a".repeat(32),
};

describe("envSchema — RATE_LIMIT_MODE", () => {
  it("accepts 'enforce'", () => {
    const r = envSchema.safeParse({ ...base, RATE_LIMIT_MODE: "enforce" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.RATE_LIMIT_MODE).toBe("enforce");
  });
  it("accepts 'shadow'", () => {
    const r = envSchema.safeParse({ ...base, RATE_LIMIT_MODE: "shadow" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.RATE_LIMIT_MODE).toBe("shadow");
  });
  it("allows omission (undefined)", () => {
    const r = envSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.RATE_LIMIT_MODE).toBeUndefined();
  });
  it("rejects unknown value", () => {
    const r = envSchema.safeParse({ ...base, RATE_LIMIT_MODE: "off" });
    expect(r.success).toBe(false);
  });
});
```

- [x] **Step 2: 테스트 실행해 FAIL 확인**

Run: `npm run test -- src/shared/lib/__tests__/env.test.ts`
Expected: 4건 FAIL — `RATE_LIMIT_MODE` 스키마 부재로 `unknown value` 케이스가 통과해 버림.

- [x] **Step 3: `@upstash/ratelimit` 설치**

Run: `npm install @upstash/ratelimit@^2.0.5`
Expected: `package.json` `dependencies`에 `"@upstash/ratelimit": "^2.0.5"` 추가.

- [x] **Step 4: `env.ts`에 `RATE_LIMIT_MODE` 스키마 추가**

`src/shared/lib/env.ts`의 `CSP_MODE` 다음에 추가:

```ts
    // Phase 3 B2-C: Rate limit 모드.
    // 'shadow'   — 한도 초과를 로그만 남기고 차단하지 않음 (점진 롤아웃).
    // 'enforce'  — 한도 초과 시 429 차단.
    // 미설정 시 enforce가 안전 기본값(wrapper/middleware 내부 default).
    RATE_LIMIT_MODE: z.enum(["shadow", "enforce"]).optional(),
```

- [x] **Step 5: `.env.example`에 안내 추가** (CSP_MODE 블록 다음에)

```dotenv
# Phase 3 B2-C: Rate limit (속도 제한)
# 'enforce' (default) — 한도 초과 시 429 응답
# 'shadow'            — 한도 초과를 로그만 남기고 차단하지 않음 (점진 롤아웃)
# 미설정 = enforce
RATE_LIMIT_MODE=enforce
```

- [x] **Step 6: 테스트 재실행 — PASS 확인**

Run: `npm run test -- src/shared/lib/__tests__/env.test.ts`
Expected: 4건 PASS.

- [x] **Step 7: typecheck**

Run: `npm run typecheck`
Expected: 에러 0건.

- [x] **Step 8: 체크박스 갱신**

본 plan 파일의 Task 1 모든 `- [ ]`를 `- [x]`로 변경. `grep -n "\- \[ \]" docs/superpowers/plans/2026-05-28-rate-limit.md` 의 Task 1 섹션 결과 0건 확인 (CLAUDE.md §4.1).

- [x] **Step 9: 커밋**

```bash
git add package.json package-lock.json src/shared/lib/env.ts src/shared/lib/__tests__/env.test.ts .env.example docs/superpowers/plans/2026-05-28-rate-limit.md
git commit -m "feat(env): add RATE_LIMIT_MODE schema + @upstash/ratelimit (B2-C Task 1)"
```

---

## Task 2: Tier 카탈로그 + bypass list (`tiers.ts`)

**Files:**
- Create: `src/shared/lib/rate-limit/tiers.ts`
- Create: `src/shared/lib/rate-limit/__tests__/tiers.test.ts`

- [x] **Step 1: 실패 테스트 작성**

`src/shared/lib/rate-limit/__tests__/tiers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  RATE_LIMIT_TIERS,
  RATE_LIMIT_BYPASS,
  isBypassPath,
} from "../tiers";

describe("RATE_LIMIT_TIERS catalogue", () => {
  it("contains exactly 4 tiers", () => {
    expect(Object.keys(RATE_LIMIT_TIERS).sort()).toEqual([
      "ai-search",
      "auth",
      "global",
      "payment",
    ]);
  });

  it("each tier has positive limit + valid window + idStrategy", () => {
    const validStrategies = ["userFirst", "ipOnly", "userOnly"];
    for (const cfg of Object.values(RATE_LIMIT_TIERS)) {
      expect(cfg.limit).toBeGreaterThan(0);
      expect(cfg.window).toMatch(/^\d+ [smhd]$/);
      expect(validStrategies).toContain(cfg.idStrategy);
    }
  });

  it("payment uses userOnly (authenticated only)", () => {
    expect(RATE_LIMIT_TIERS.payment.idStrategy).toBe("userOnly");
  });

  it("auth uses ipOnly (pre-authentication)", () => {
    expect(RATE_LIMIT_TIERS.auth.idStrategy).toBe("ipOnly");
  });

  it("limits match design spec §3", () => {
    expect(RATE_LIMIT_TIERS.global).toMatchObject({ limit: 100, window: "10 s" });
    expect(RATE_LIMIT_TIERS.auth).toMatchObject({ limit: 5, window: "1 m" });
    expect(RATE_LIMIT_TIERS.payment).toMatchObject({ limit: 10, window: "1 m" });
    expect(RATE_LIMIT_TIERS["ai-search"]).toMatchObject({ limit: 20, window: "1 m" });
  });
});

describe("RATE_LIMIT_BYPASS list", () => {
  it("contains critical no-limit paths (spec §3.1)", () => {
    expect(RATE_LIMIT_BYPASS).toContain("/api/payments/webhook/toss");
    expect(RATE_LIMIT_BYPASS).toContain("/api/cron/");
    expect(RATE_LIMIT_BYPASS).toContain("/api/csp-report");
    expect(RATE_LIMIT_BYPASS).toContain("/api/health");
  });
});

describe("isBypassPath", () => {
  it("matches exact bypass paths", () => {
    expect(isBypassPath("/api/health")).toBe(true);
    expect(isBypassPath("/api/csp-report")).toBe(true);
  });
  it("matches bypass prefixes (cron 등)", () => {
    expect(isBypassPath("/api/cron/process-refunds")).toBe(true);
    expect(isBypassPath("/api/payments/webhook/toss")).toBe(true);
  });
  it("does NOT match non-bypass paths", () => {
    expect(isBypassPath("/api/payments/confirm")).toBe(false);
    expect(isBypassPath("/api/wishlist/check")).toBe(false);
    expect(isBypassPath("/")).toBe(false);
  });
});
```

- [x] **Step 2: FAIL 확인**

Run: `npm run test -- src/shared/lib/rate-limit/__tests__/tiers.test.ts`
Expected: 파일 import 실패 (`../tiers` 미존재).

- [x] **Step 3: `tiers.ts` 구현**

`src/shared/lib/rate-limit/tiers.ts`:

```ts
/**
 * tiers.ts — Rate limit tier 카탈로그 (spec §3).
 *
 * 4 tier × sliding window. limit/window/idStrategy는 spec §3에 박제되어 있어
 * 임의 수정 시 회귀 테스트가 차단한다. 변경은 ADR 발행 + tier.test.ts 동시 수정.
 */

export type RateLimitTier = "global" | "auth" | "payment" | "ai-search";
export type IdStrategy = "userFirst" | "ipOnly" | "userOnly";

export interface TierConfig {
  readonly limit: number;
  /** Upstash Ratelimit 윈도우 형식 — `"<n> <unit>"` (`s`|`m`|`h`|`d`). */
  readonly window: `${number} ${"s" | "m" | "h" | "d"}`;
  readonly idStrategy: IdStrategy;
}

export const RATE_LIMIT_TIERS = {
  global: { limit: 100, window: "10 s", idStrategy: "userFirst" },
  auth: { limit: 5, window: "1 m", idStrategy: "ipOnly" },
  payment: { limit: 10, window: "1 m", idStrategy: "userOnly" },
  "ai-search": { limit: 20, window: "1 m", idStrategy: "userFirst" },
} as const satisfies Record<RateLimitTier, TierConfig>;

/**
 * Bypass list — rate-limit 자체를 적용하지 않음 (spec §3.1).
 * prefix 매칭 — `/api/cron/` 은 `/api/cron/process-refunds` 등 모든 하위 경로 포함.
 */
export const RATE_LIMIT_BYPASS = [
  "/api/payments/webhook/toss",
  "/api/cron/",
  "/api/csp-report",
  "/api/health",
] as const;

export function isBypassPath(pathname: string): boolean {
  return RATE_LIMIT_BYPASS.some((p) => pathname.startsWith(p));
}
```

- [x] **Step 4: 테스트 재실행 — PASS 확인**

Run: `npm run test -- src/shared/lib/rate-limit/__tests__/tiers.test.ts`
Expected: 9건 PASS.

- [x] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: 에러 0건.

- [x] **Step 6: 체크박스 갱신**

본 plan Task 2의 `- [ ]` 모두 `- [x]`로. Task 1 동일 절차.

- [x] **Step 7: 커밋**

```bash
git add src/shared/lib/rate-limit/tiers.ts src/shared/lib/rate-limit/__tests__/tiers.test.ts docs/superpowers/plans/2026-05-28-rate-limit.md
git commit -m "feat(rate-limit): tier catalogue + bypass list with regression guard (B2-C Task 2)"
```

---

## Task 3: Identifier 추출 (`identifier.ts`)

**Files:**
- Create: `src/shared/lib/rate-limit/identifier.ts`
- Create: `src/shared/lib/rate-limit/__tests__/identifier.test.ts`

- [x] **Step 1: 실패 테스트 작성**

`src/shared/lib/rate-limit/__tests__/identifier.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getClientIp, hashIdForLog, identify } from "../identifier";

function mockReq(headers: Record<string, string>): Request {
  return new Request("http://localhost/", { headers });
}

describe("getClientIp", () => {
  it("prefers x-vercel-forwarded-for first hop", () => {
    const req = mockReq({
      "x-vercel-forwarded-for": "203.0.113.10, 198.51.100.1",
      "x-forwarded-for": "spoofed",
    });
    expect(getClientIp(req)).toBe("203.0.113.10");
  });

  it("falls back to x-forwarded-for first hop", () => {
    const req = mockReq({ "x-forwarded-for": "203.0.113.10, 1.1.1.1" });
    expect(getClientIp(req)).toBe("203.0.113.10");
  });

  it("falls back to x-real-ip", () => {
    const req = mockReq({ "x-real-ip": "203.0.113.10" });
    expect(getClientIp(req)).toBe("203.0.113.10");
  });

  it("returns 'unknown' when no header present", () => {
    expect(getClientIp(mockReq({}))).toBe("unknown");
  });

  it("trims whitespace from header values", () => {
    expect(getClientIp(mockReq({ "x-real-ip": "  1.2.3.4  " }))).toBe("1.2.3.4");
  });
});

describe("identify", () => {
  const req = mockReq({ "x-real-ip": "1.2.3.4" });

  it("userFirst returns user:<id> when authenticated", () => {
    expect(identify(req, "userFirst", "u_1")).toBe("user:u_1");
  });

  it("userFirst falls back to ip when no userId", () => {
    expect(identify(req, "userFirst", null)).toBe("ip:1.2.3.4");
  });

  it("userFirst falls back to ip when userId is undefined", () => {
    expect(identify(req, "userFirst", undefined)).toBe("ip:1.2.3.4");
  });

  it("ipOnly ignores userId entirely", () => {
    expect(identify(req, "ipOnly", "u_1")).toBe("ip:1.2.3.4");
  });

  it("userOnly returns user:<id>", () => {
    expect(identify(req, "userOnly", "u_1")).toBe("user:u_1");
  });

  it("userOnly throws UNAUTHENTICATED when no userId", () => {
    expect(() => identify(req, "userOnly", null)).toThrow("UNAUTHENTICATED");
  });
});

describe("hashIdForLog", () => {
  it("masks middle of identifier value", () => {
    expect(hashIdForLog("ip:203.0.113.10")).toMatch(/^ip:\d+\.0?.*\.\.\..+$/);
  });
  it("preserves scope prefix", () => {
    expect(hashIdForLog("user:abc123def456")).toMatch(/^user:abc1\.\.\.56$/);
  });
  it("returns scope only when value missing", () => {
    expect(hashIdForLog("anon")).toBe("anon");
  });
});
```

- [x] **Step 2: FAIL 확인**

Run: `npm run test -- src/shared/lib/rate-limit/__tests__/identifier.test.ts`
Expected: import 실패.

- [x] **Step 3: `identifier.ts` 구현**

`src/shared/lib/rate-limit/identifier.ts`:

```ts
/**
 * identifier.ts — Rate limit 식별자 추출 (spec §5).
 *
 * Vercel 환경: `x-vercel-forwarded-for`는 플랫폼이 정규화해 박은 헤더 — 클라이언트
 * 위조 불가. 그 다음 표준 `x-forwarded-for` / `x-real-ip`. 어떤 헤더도 없으면
 * `unknown` 단일 버킷(dev / 직접 fetch 환경). 운영에서 `unknown` 발생 시 Sentry
 * breadcrumb로 가시화 (별도 Task 8 운영 노트).
 */

import type { IdStrategy } from "./tiers";

export function getClientIp(req: Request): string {
  const xvff = req.headers.get("x-vercel-forwarded-for");
  if (xvff) return xvff.split(",")[0].trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

export function identify(
  req: Request,
  strategy: IdStrategy,
  userId: string | null | undefined,
): string {
  if (strategy !== "ipOnly" && userId) {
    return `user:${userId}`;
  }
  if (strategy === "userOnly") {
    throw new Error("UNAUTHENTICATED");
  }
  return `ip:${getClientIp(req)}`;
}

/**
 * 로그/메트릭 출력용 fingerprint — raw IP/userId 노출 차단.
 * `observability/pii.ts` 정신: 분석은 가능하되 식별자 원본은 보호.
 */
export function hashIdForLog(id: string): string {
  const idx = id.indexOf(":");
  if (idx === -1) return id;
  const scope = id.slice(0, idx);
  const val = id.slice(idx + 1);
  if (val.length <= 6) return `${scope}:${val.slice(0, 2)}...`;
  return `${scope}:${val.slice(0, 4)}...${val.slice(-2)}`;
}
```

- [x] **Step 4: 테스트 재실행 — PASS 확인**

Run: `npm run test -- src/shared/lib/rate-limit/__tests__/identifier.test.ts`
Expected: 13건 PASS.

- [x] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: 0 에러.

- [x] **Step 6: 체크박스 갱신**

본 plan Task 3의 `- [ ]` 모두 `- [x]`로.

- [x] **Step 7: 커밋**

```bash
git add src/shared/lib/rate-limit/identifier.ts src/shared/lib/rate-limit/__tests__/identifier.test.ts docs/superpowers/plans/2026-05-28-rate-limit.md
git commit -m "feat(rate-limit): identifier helpers — IP extraction + strategy dispatch (B2-C Task 3)"
```

---

## Task 4: Client lazy singleton + response headers (`client.ts`, `responseHeaders.ts`)

**Files:**
- Create: `src/shared/lib/rate-limit/client.ts`
- Create: `src/shared/lib/rate-limit/responseHeaders.ts`
- Create: `src/shared/lib/rate-limit/__tests__/responseHeaders.test.ts`

> client.ts는 외부 SDK lazy 인스턴스화 — `cacheGet/cacheSet`(M-CACHE)와 동일 패턴. 단위 테스트는 enforce.test.ts에서 mocking으로 검증하므로 본 Task에선 responseHeaders만 단위 검증.

- [x] **Step 1: 실패 테스트 작성 (`responseHeaders.test.ts`)**

```ts
import { describe, expect, it } from "vitest";
import { buildRateLimitHeaders } from "../responseHeaders";

describe("buildRateLimitHeaders", () => {
  it("formats verdict into standard X-RateLimit-* headers", () => {
    expect(
      buildRateLimitHeaders({
        ok: true,
        limit: 100,
        remaining: 87,
        reset: 1717000000,
        retryAfterSeconds: 0,
        shadowed: false,
        bypassed: false,
      }),
    ).toEqual({
      "X-RateLimit-Limit": "100",
      "X-RateLimit-Remaining": "87",
      "X-RateLimit-Reset": "1717000000",
    });
  });

  it("clamps negative remaining to 0", () => {
    expect(
      buildRateLimitHeaders({
        ok: false,
        limit: 10,
        remaining: -2,
        reset: 1717000000,
        retryAfterSeconds: 47,
        shadowed: false,
        bypassed: false,
      })["X-RateLimit-Remaining"],
    ).toBe("0");
  });
});
```

- [x] **Step 2: FAIL 확인**

Run: `npm run test -- src/shared/lib/rate-limit/__tests__/responseHeaders.test.ts`
Expected: import 실패.

- [x] **Step 3: `responseHeaders.ts` 구현**

```ts
/**
 * responseHeaders.ts — verdict → 표준 X-RateLimit-* 헤더.
 *
 * 정상/차단 양쪽 응답에 박제 (spec §6). 차단 시엔 호출부가 추가로 `Retry-After`를
 * 박는다 — 본 헬퍼는 quota 가시성만 담당.
 */

import type { RateLimitVerdict } from "./enforce";

export function buildRateLimitHeaders(
  verdict: RateLimitVerdict,
): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(verdict.limit),
    "X-RateLimit-Remaining": String(Math.max(0, verdict.remaining)),
    "X-RateLimit-Reset": String(verdict.reset),
  };
}
```

> **NOTE**: `RateLimitVerdict` 타입은 Task 5의 `enforce.ts`에서 export. 본 파일은 type-only import이라 순환 의존성 없음 (TS는 type-only import를 emit하지 않음).

- [x] **Step 4: `client.ts` 구현**

```ts
/**
 * client.ts — `@upstash/ratelimit` lazy singleton (spec §7, §8.2).
 *
 * Redis client는 M-CACHE의 `shared/lib/cache/redis.ts` 패턴 그대로:
 *   - env 미설정 시 null 강등 (fail-open — spec §7)
 *   - 인스턴스 1회 생성 후 재사용 (콜드스타트 비용 1회)
 *   - 테스트는 __resetRateLimitClientForTest()로 재평가
 *
 * cache 키와 prefix 충돌 회피: `ratelimit:v1:<tier>` (cache는 `search:v1:` 등).
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "@/shared/lib/env";
import { RATE_LIMIT_TIERS, type RateLimitTier } from "./tiers";

let redis: Redis | null | undefined;
const limiters = new Map<RateLimitTier, Ratelimit | null>();

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    redis = null;
    return null;
  }
  redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
    automaticDeserialization: false,
  });
  return redis;
}

export function getRatelimiter(tier: RateLimitTier): Ratelimit | null {
  const cached = limiters.get(tier);
  if (cached !== undefined) return cached;
  const r = getRedis();
  if (!r) {
    limiters.set(tier, null);
    return null;
  }
  const cfg = RATE_LIMIT_TIERS[tier];
  const inst = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(cfg.limit, cfg.window),
    prefix: `ratelimit:v1:${tier}`,
    analytics: true,
  });
  limiters.set(tier, inst);
  return inst;
}

/** 테스트 전용 — 설정 변경 재평가용 싱글톤 리셋. */
export function __resetRateLimitClientForTest(): void {
  redis = undefined;
  limiters.clear();
}
```

- [x] **Step 5: 테스트 재실행 — `responseHeaders.test.ts` PASS 확인**

Run: `npm run test -- src/shared/lib/rate-limit/__tests__/responseHeaders.test.ts`
Expected: 2건 PASS.

- [x] **Step 6: typecheck**

Run: `npm run typecheck`
Expected: 0 에러.

- [x] **Step 7: 체크박스 갱신**

본 plan Task 4의 `- [ ]` 모두 `- [x]`로.

- [x] **Step 8: 커밋**

```bash
git add src/shared/lib/rate-limit/client.ts src/shared/lib/rate-limit/responseHeaders.ts src/shared/lib/rate-limit/__tests__/responseHeaders.test.ts docs/superpowers/plans/2026-05-28-rate-limit.md
git commit -m "feat(rate-limit): lazy Ratelimit client + response headers helper (B2-C Task 4)"
```

---

## Task 5: `enforce()` primitive — fail-open + shadow-aware

**Files:**
- Create: `src/shared/lib/rate-limit/enforce.ts`
- Create: `src/shared/lib/rate-limit/__tests__/enforce.test.ts`

- [x] **Step 1: 실패 테스트 작성**

`src/shared/lib/rate-limit/__tests__/enforce.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/lib/env", () => ({
  env: {
    UPSTASH_REDIS_REST_URL: "https://mock",
    UPSTASH_REDIS_REST_TOKEN: "mock",
    RATE_LIMIT_MODE: undefined as "shadow" | "enforce" | undefined,
  },
}));
vi.mock("../client", () => ({
  getRatelimiter: vi.fn(),
}));
vi.mock("@/shared/lib/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import * as envMod from "@/shared/lib/env";
import * as clientMod from "../client";
import { logger } from "@/shared/lib/observability";
import { enforce } from "../enforce";

const NOW = 1_717_000_000_000;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  (envMod.env as { RATE_LIMIT_MODE: string | undefined }).RATE_LIMIT_MODE = undefined;
});

describe("enforce — degradation", () => {
  it("returns bypassed=true when ratelimiter not configured", async () => {
    vi.mocked(clientMod.getRatelimiter).mockReturnValue(null);
    const v = await enforce("global", "ip:1.2.3.4");
    expect(v.ok).toBe(true);
    expect(v.bypassed).toBe(true);
    expect(v.shadowed).toBe(false);
  });

  it("returns bypassed=true on Upstash exception (fail-open)", async () => {
    vi.mocked(clientMod.getRatelimiter).mockReturnValue({
      limit: vi.fn().mockRejectedValue(new Error("upstash 503")),
    } as never);
    const v = await enforce("payment", "user:abc");
    expect(v.ok).toBe(true);
    expect(v.bypassed).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      "rate_limit.degraded",
      expect.objectContaining({ tier: "payment" }),
    );
  });
});

describe("enforce — under limit", () => {
  it("returns ok=true with remaining count", async () => {
    vi.mocked(clientMod.getRatelimiter).mockReturnValue({
      limit: vi.fn().mockResolvedValue({
        success: true,
        limit: 100,
        remaining: 50,
        reset: NOW + 10_000,
      }),
    } as never);
    const v = await enforce("global", "ip:1.2.3.4");
    expect(v.ok).toBe(true);
    expect(v.limit).toBe(100);
    expect(v.remaining).toBe(50);
    expect(v.shadowed).toBe(false);
    expect(v.bypassed).toBe(false);
  });
});

describe("enforce — over limit", () => {
  it("returns ok=false in default (enforce) mode", async () => {
    vi.mocked(clientMod.getRatelimiter).mockReturnValue({
      limit: vi.fn().mockResolvedValue({
        success: false,
        limit: 10,
        remaining: 0,
        reset: NOW + 47_000,
      }),
    } as never);
    const v = await enforce("payment", "user:abc");
    expect(v.ok).toBe(false);
    expect(v.shadowed).toBe(false);
    expect(v.retryAfterSeconds).toBe(47);
    expect(logger.info).toHaveBeenCalledWith(
      "rate_limit.exceeded",
      expect.objectContaining({ tier: "payment", shadowed: false }),
    );
  });

  it("returns ok=true + shadowed=true in shadow mode", async () => {
    (envMod.env as { RATE_LIMIT_MODE: string }).RATE_LIMIT_MODE = "shadow";
    vi.mocked(clientMod.getRatelimiter).mockReturnValue({
      limit: vi.fn().mockResolvedValue({
        success: false,
        limit: 10,
        remaining: 0,
        reset: NOW + 30_000,
      }),
    } as never);
    const v = await enforce("auth", "ip:1.2.3.4");
    expect(v.ok).toBe(true);
    expect(v.shadowed).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      "rate_limit.exceeded",
      expect.objectContaining({ tier: "auth", shadowed: true }),
    );
  });

  it("masks identifier in log via hashIdForLog", async () => {
    vi.mocked(clientMod.getRatelimiter).mockReturnValue({
      limit: vi.fn().mockResolvedValue({
        success: false,
        limit: 10,
        remaining: 0,
        reset: NOW + 10_000,
      }),
    } as never);
    await enforce("payment", "user:abcdefghij");
    expect(logger.info).toHaveBeenCalledWith(
      "rate_limit.exceeded",
      expect.objectContaining({
        identifier: expect.not.stringContaining("abcdefghij"),
      }),
    );
  });
});
```

- [x] **Step 2: FAIL 확인**

Run: `npm run test -- src/shared/lib/rate-limit/__tests__/enforce.test.ts`
Expected: import 실패.

- [x] **Step 3: `enforce.ts` 구현**

```ts
/**
 * enforce.ts — Rate limit primitive (spec §7).
 *
 * Pipeline:
 *   1. getRatelimiter(tier) — null → bypassed verdict (fail-open).
 *   2. limiter.limit(identifier) — Upstash sliding window.
 *   3. success=false: enforce mode → ok=false, shadow mode → ok=true + shadowed=true.
 *   4. 예외: fail-open + warn 로그 + Sentry breadcrumb(observability logger 내부 처리).
 *
 * 모든 분기에서 verdict는 *완전한* 헤더 정보 포함(limit/remaining/reset) — 호출부가
 * 별도 분기 없이 `buildRateLimitHeaders(verdict)` 한 줄로 처리 가능하도록.
 */

import { env } from "@/shared/lib/env";
import { logger } from "@/shared/lib/observability";
import { getRatelimiter } from "./client";
import { hashIdForLog } from "./identifier";
import { RATE_LIMIT_TIERS, type RateLimitTier } from "./tiers";

export interface RateLimitVerdict {
  readonly ok: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly reset: number;
  readonly retryAfterSeconds: number;
  readonly shadowed: boolean;
  readonly bypassed: boolean;
}

function passVerdict(tier: RateLimitTier, bypassed: boolean): RateLimitVerdict {
  return {
    ok: true,
    limit: RATE_LIMIT_TIERS[tier].limit,
    remaining: RATE_LIMIT_TIERS[tier].limit,
    reset: 0,
    retryAfterSeconds: 0,
    shadowed: false,
    bypassed,
  };
}

export async function enforce(
  tier: RateLimitTier,
  identifier: string,
): Promise<RateLimitVerdict> {
  const limiter = getRatelimiter(tier);
  if (!limiter) {
    return passVerdict(tier, true);
  }

  try {
    const result = await limiter.limit(identifier);
    const resetSec = Math.ceil(result.reset / 1000);
    const nowSec = Math.floor(Date.now() / 1000);
    const retryAfter = Math.max(0, resetSec - nowSec);

    if (!result.success) {
      const shadowed = env.RATE_LIMIT_MODE === "shadow";
      logger.info("rate_limit.exceeded", {
        tier,
        identifier: hashIdForLog(identifier),
        limit: result.limit,
        remaining: result.remaining,
        reset: resetSec,
        shadowed,
      });
      return {
        ok: shadowed,
        limit: result.limit,
        remaining: result.remaining,
        reset: resetSec,
        retryAfterSeconds: retryAfter,
        shadowed,
        bypassed: false,
      };
    }

    return {
      ok: true,
      limit: result.limit,
      remaining: result.remaining,
      reset: resetSec,
      retryAfterSeconds: 0,
      shadowed: false,
      bypassed: false,
    };
  } catch (e) {
    logger.warn("rate_limit.degraded", {
      tier,
      identifier: hashIdForLog(identifier),
      error: e instanceof Error ? e.message : String(e),
    });
    return passVerdict(tier, true);
  }
}
```

- [x] **Step 4: 테스트 재실행 — PASS 확인**

Run: `npm run test -- src/shared/lib/rate-limit/__tests__/enforce.test.ts`
Expected: 6건 PASS.

- [x] **Step 5: typecheck + 기존 테스트 회귀 확인**

Run: `npm run typecheck && npm run test`
Expected: 0 에러, 기존 테스트 전부 PASS.

- [x] **Step 6: 체크박스 갱신**

본 plan Task 5의 `- [ ]` 모두 `- [x]`로.

- [x] **Step 7: 커밋**

```bash
git add src/shared/lib/rate-limit/enforce.ts src/shared/lib/rate-limit/__tests__/enforce.test.ts docs/superpowers/plans/2026-05-28-rate-limit.md
git commit -m "feat(rate-limit): enforce primitive — fail-open + shadow-aware verdict (B2-C Task 5)"
```

---

## Task 6: Route handler wrapper (`withRateLimit`)

**Files:**
- Create: `src/shared/lib/rate-limit/withRateLimit.ts`
- Create: `src/shared/lib/rate-limit/__tests__/withRateLimit.test.ts`

- [x] **Step 1: 실패 테스트 작성**

`src/shared/lib/rate-limit/__tests__/withRateLimit.test.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../enforce", () => ({ enforce: vi.fn() }));
import * as enforceMod from "../enforce";
import { withRateLimit } from "../withRateLimit";

function req(headers: Record<string, string> = {}, url = "http://localhost/api/x"): NextRequest {
  return new Request(url, { method: "POST", headers }) as unknown as NextRequest;
}

beforeEach(() => vi.clearAllMocks());

describe("withRateLimit", () => {
  it("blocks with 429 + Retry-After + body when verdict.ok=false", async () => {
    vi.mocked(enforceMod.enforce).mockResolvedValue({
      ok: false,
      limit: 10,
      remaining: 0,
      reset: 1717000000,
      retryAfterSeconds: 47,
      shadowed: false,
      bypassed: false,
    });
    const wrapped = withRateLimit(
      { tier: "payment", resolveUserId: async () => "u_1" },
      async () => NextResponse.json({ ok: true }),
    );
    const res = await wrapped(req({ "x-real-ip": "1.2.3.4" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("47");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    const body = await res.json();
    expect(body).toMatchObject({ error: "RATE_LIMITED", tier: "payment", retryAfterSeconds: 47 });
  });

  it("returns 401 when strategy=userOnly but resolveUserId yields null", async () => {
    const handler = vi.fn();
    const wrapped = withRateLimit(
      { tier: "payment", resolveUserId: async () => null },
      handler,
    );
    const res = await wrapped(req());
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(enforceMod.enforce).not.toHaveBeenCalled();
  });

  it("attaches X-RateLimit-* headers on pass-through", async () => {
    vi.mocked(enforceMod.enforce).mockResolvedValue({
      ok: true,
      limit: 100,
      remaining: 87,
      reset: 1717000000,
      retryAfterSeconds: 0,
      shadowed: false,
      bypassed: false,
    });
    const wrapped = withRateLimit(
      { tier: "global", resolveUserId: async () => "u_1" },
      async () => NextResponse.json({ ok: true }),
    );
    const res = await wrapped(req({ "x-real-ip": "1.2.3.4" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("100");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("87");
  });

  it("forwards extra handler args (e.g., route params context)", async () => {
    vi.mocked(enforceMod.enforce).mockResolvedValue({
      ok: true, limit: 100, remaining: 99, reset: 0,
      retryAfterSeconds: 0, shadowed: false, bypassed: false,
    });
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withRateLimit(
      { tier: "global", resolveUserId: async () => null },
      handler,
    );
    const ctx = { params: { id: "x" } };
    await wrapped(req({ "x-real-ip": "1.2.3.4" }), ctx as never);
    expect(handler).toHaveBeenCalledWith(expect.anything(), ctx);
  });

  it("uses tier default idStrategy when opts.idStrategy omitted", async () => {
    // payment tier 의 default 는 userOnly — resolveUserId 없으면 401.
    const wrapped = withRateLimit(
      { tier: "payment" }, // resolveUserId 미설정 → 항상 null
      async () => NextResponse.json({ ok: true }),
    );
    const res = await wrapped(req());
    expect(res.status).toBe(401);
  });
});
```

- [x] **Step 2: FAIL 확인**

Run: `npm run test -- src/shared/lib/rate-limit/__tests__/withRateLimit.test.ts`
Expected: import 실패.

- [x] **Step 3: `withRateLimit.ts` 구현**

```ts
/**
 * withRateLimit.ts — Route handler wrapper (spec §4, §6).
 *
 * Hybrid 통합의 *2차 게이트* — tier-specific 한도를 call site에서 명시 선언.
 * 미들웨어는 global tier baseline만 담당하고, 도메인별(payment / ai-search 등)
 * 정밀 한도는 본 wrapper로.
 *
 * 사용:
 *   export const POST = withRateLimit(
 *     { tier: "payment", resolveUserId: async (req) => (await auth())?.user?.id ?? null },
 *     async (req) => { ... 기존 핸들러 ... }
 *   );
 *
 * 응답 헤더: 정상/차단 모두 X-RateLimit-* 박제. 차단 시 Retry-After 추가.
 * 401: strategy=userOnly + userId null 시 즉시 응답 (enforce 호출 안 함).
 */

import { NextResponse, type NextRequest } from "next/server";
import { enforce } from "./enforce";
import { identify } from "./identifier";
import { buildRateLimitHeaders } from "./responseHeaders";
import { RATE_LIMIT_TIERS, type IdStrategy, type RateLimitTier } from "./tiers";

export interface WithRateLimitOptions {
  tier: RateLimitTier;
  idStrategy?: IdStrategy;
  resolveUserId?: (req: NextRequest) => Promise<string | null>;
}

export function withRateLimit<Args extends unknown[]>(
  opts: WithRateLimitOptions,
  handler: (req: NextRequest, ...args: Args) => Promise<NextResponse>,
): (req: NextRequest, ...args: Args) => Promise<NextResponse> {
  const strategy = opts.idStrategy ?? RATE_LIMIT_TIERS[opts.tier].idStrategy;

  return async (req, ...args) => {
    const userId =
      strategy === "ipOnly"
        ? null
        : ((await opts.resolveUserId?.(req)) ?? null);

    let id: string;
    try {
      id = identify(req as unknown as Request, strategy, userId);
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const verdict = await enforce(opts.tier, id);
    const headers = buildRateLimitHeaders(verdict);

    if (!verdict.ok) {
      headers["Retry-After"] = String(verdict.retryAfterSeconds);
      return NextResponse.json(
        {
          error: "RATE_LIMITED",
          tier: opts.tier,
          retryAfterSeconds: verdict.retryAfterSeconds,
        },
        { status: 429, headers },
      );
    }

    const res = await handler(req, ...args);
    for (const [k, v] of Object.entries(headers)) {
      res.headers.set(k, v);
    }
    return res;
  };
}
```

- [x] **Step 4: 테스트 재실행 — PASS 확인**

Run: `npm run test -- src/shared/lib/rate-limit/__tests__/withRateLimit.test.ts`
Expected: 5건 PASS.

- [x] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: 0 에러.

- [x] **Step 6: 체크박스 갱신**

본 plan Task 6의 `- [ ]` 모두 `- [x]`로.

- [x] **Step 7: 커밋**

```bash
git add src/shared/lib/rate-limit/withRateLimit.ts src/shared/lib/rate-limit/__tests__/withRateLimit.test.ts docs/superpowers/plans/2026-05-28-rate-limit.md
git commit -m "feat(rate-limit): withRateLimit route handler wrapper — 429 + Retry-After + headers (B2-C Task 6)"
```

---

## Task 7: Server Action wrapper (`withRateLimitAction`) + barrel

**Files:**
- Create: `src/shared/lib/rate-limit/withRateLimitAction.ts`
- Create: `src/shared/lib/rate-limit/index.ts`
- Create: `src/shared/lib/rate-limit/__tests__/withRateLimitAction.test.ts`

- [x] **Step 1: 실패 테스트 작성**

`src/shared/lib/rate-limit/__tests__/withRateLimitAction.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("../enforce", () => ({ enforce: vi.fn() }));

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import * as enforceMod from "../enforce";
import { withRateLimitAction } from "../withRateLimitAction";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(headers).mockResolvedValue(
    new Headers({ "x-real-ip": "1.2.3.4" }) as never,
  );
});

describe("withRateLimitAction", () => {
  it("redirects with retryAfter query on block (default path)", async () => {
    vi.mocked(enforceMod.enforce).mockResolvedValue({
      ok: false, limit: 5, remaining: 0, reset: 1717000000,
      retryAfterSeconds: 42, shadowed: false, bypassed: false,
    });
    const action = withRateLimitAction(
      { tier: "auth" },
      async (formData: FormData) => formData.get("x"),
    );
    await expect(action(new FormData())).rejects.toThrow(
      "REDIRECT:/?error=RATE_LIMITED&retryAfter=42",
    );
    expect(redirect).toHaveBeenCalledWith("/?error=RATE_LIMITED&retryAfter=42");
  });

  it("uses redirectOnBlock override when provided", async () => {
    vi.mocked(enforceMod.enforce).mockResolvedValue({
      ok: false, limit: 5, remaining: 0, reset: 1717000000,
      retryAfterSeconds: 42, shadowed: false, bypassed: false,
    });
    const action = withRateLimitAction(
      {
        tier: "auth",
        redirectOnBlock: (r) => `/login?error=RATE_LIMITED&retryAfter=${r}`,
      },
      async () => undefined,
    );
    await expect(action()).rejects.toThrow(
      "REDIRECT:/login?error=RATE_LIMITED&retryAfter=42",
    );
  });

  it("invokes handler with original args on pass", async () => {
    vi.mocked(enforceMod.enforce).mockResolvedValue({
      ok: true, limit: 5, remaining: 4, reset: 0,
      retryAfterSeconds: 0, shadowed: false, bypassed: false,
    });
    const handler = vi.fn(async (n: number, s: string) => `${s}-${n * 2}`);
    const action = withRateLimitAction({ tier: "auth" }, handler);
    const result = await action(7, "x");
    expect(result).toBe("x-14");
    expect(handler).toHaveBeenCalledWith(7, "x");
  });

  it("throws UNAUTHENTICATED when strategy=userOnly + no userId", async () => {
    const action = withRateLimitAction(
      { tier: "payment", resolveUserId: async () => null },
      async () => "ok",
    );
    await expect(action()).rejects.toThrow("UNAUTHENTICATED");
    expect(enforceMod.enforce).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: FAIL 확인**

Run: `npm run test -- src/shared/lib/rate-limit/__tests__/withRateLimitAction.test.ts`
Expected: import 실패.

- [x] **Step 3: `withRateLimitAction.ts` 구현**

```ts
/**
 * withRateLimitAction.ts — Server Action wrapper (spec §4.2).
 *
 * 차이점 (vs withRateLimit):
 *   - 입력이 임의 args (FormData / 원시 인자) — req 객체 없음.
 *   - 응답이 NextResponse 아님 → 차단 시 redirect() 던짐 (Next 가 처리).
 *   - 헤더는 next/headers().get() 으로 회수해 식별자 추출.
 *
 * 사용:
 *   export const signInWithProvider = withRateLimitAction(
 *     {
 *       tier: "auth",
 *       redirectOnBlock: (r) => `/login?error=RATE_LIMITED&retryAfter=${r}`,
 *     },
 *     async (formData: FormData) => { ... 기존 핸들러 ... }
 *   );
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { enforce } from "./enforce";
import { identify } from "./identifier";
import { RATE_LIMIT_TIERS, type IdStrategy, type RateLimitTier } from "./tiers";

export interface WithRateLimitActionOptions {
  tier: RateLimitTier;
  idStrategy?: IdStrategy;
  resolveUserId?: () => Promise<string | null>;
  /** 차단 시 redirect 대상 — 미설정 시 `/?error=RATE_LIMITED&retryAfter=N`. */
  redirectOnBlock?: (retryAfterSeconds: number) => string;
}

export function withRateLimitAction<Args extends unknown[], R>(
  opts: WithRateLimitActionOptions,
  handler: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  const strategy = opts.idStrategy ?? RATE_LIMIT_TIERS[opts.tier].idStrategy;

  return async (...args) => {
    const hdrs = await headers();
    const req = new Request("http://internal/", { headers: hdrs as never });
    const userId =
      strategy === "ipOnly" ? null : ((await opts.resolveUserId?.()) ?? null);

    const id = identify(req, strategy, userId);  // userOnly + null → throw "UNAUTHENTICATED"

    const verdict = await enforce(opts.tier, id);
    if (!verdict.ok) {
      const target =
        opts.redirectOnBlock?.(verdict.retryAfterSeconds) ??
        `/?error=RATE_LIMITED&retryAfter=${verdict.retryAfterSeconds}`;
      redirect(target);
    }

    return handler(...args);
  };
}
```

- [x] **Step 4: 테스트 재실행 — PASS 확인**

Run: `npm run test -- src/shared/lib/rate-limit/__tests__/withRateLimitAction.test.ts`
Expected: 4건 PASS.

- [x] **Step 5: barrel (`index.ts`) 작성**

`src/shared/lib/rate-limit/index.ts`:

```ts
/**
 * rate-limit/index.ts — public barrel (FSD R2 — 깊은 경로 import 금지).
 *
 * 모든 consumer 는 `@/shared/lib/rate-limit` 에서만 import.
 */

export { enforce, type RateLimitVerdict } from "./enforce";
export { getClientIp, identify, hashIdForLog } from "./identifier";
export { buildRateLimitHeaders } from "./responseHeaders";
export {
  RATE_LIMIT_TIERS,
  RATE_LIMIT_BYPASS,
  isBypassPath,
  type RateLimitTier,
  type IdStrategy,
  type TierConfig,
} from "./tiers";
export { withRateLimit, type WithRateLimitOptions } from "./withRateLimit";
export {
  withRateLimitAction,
  type WithRateLimitActionOptions,
} from "./withRateLimitAction";
export { __resetRateLimitClientForTest } from "./client";
```

- [x] **Step 6: 전체 테스트 + typecheck 회귀 확인**

Run: `npm run typecheck && npm run test`
Expected: 0 에러, 전부 PASS.

- [x] **Step 7: 체크박스 갱신**

본 plan Task 7의 `- [ ]` 모두 `- [x]`로.

- [x] **Step 8: 커밋**

```bash
git add src/shared/lib/rate-limit/withRateLimitAction.ts src/shared/lib/rate-limit/index.ts src/shared/lib/rate-limit/__tests__/withRateLimitAction.test.ts docs/superpowers/plans/2026-05-28-rate-limit.md
git commit -m "feat(rate-limit): withRateLimitAction wrapper + barrel (B2-C Task 7)"
```

---

## Task 8: 미들웨어 `global` tier 통합

**Files:**
- Modify: `src/middleware.ts`

> 미들웨어는 Edge runtime 컨텍스트로 vitest 단위 테스트가 비현실적(NextRequest 모킹 + auth wrapper 모킹 + Edge globals). **본 Task의 검증은 런타임 curl로** — spec §10.2 / §7 시나리오. Edge 호환성은 import 라인이 ALS/Prisma 의존성 없음을 grep으로 확인.

- [x] **Step 1: import 의존성 회귀 가드 (Edge 호환성 grep)**

Run: `grep -rn "from \"@prisma/client\"\|from \"async_hooks\"\|from \"node:" src/shared/lib/rate-limit/`
Expected: 출력 0건 — Edge runtime 금지 import가 rate-limit 모듈에 없음.

- [x] **Step 2: `src/middleware.ts` 수정 — global tier 추가**

기존 파일을 다음으로 교체:

```ts
import { auth } from "@/features/auth/server/auth";
import { NextResponse } from "next/server";
import { buildCspHeader, CSP_NONCE_HEADER } from "@/shared/lib/security";
import {
  buildRateLimitHeaders,
  enforce,
  identify,
  isBypassPath,
  type RateLimitVerdict,
} from "@/shared/lib/rate-limit";

export default auth(async (req) => {
  // Edge runtime — ALS/Prisma import 금지. crypto.randomUUID() / getRandomValues() 만 사용.
  const traceId =
    req.headers.get("x-trace-id") ??
    crypto.randomUUID().replace(/-/g, "").slice(0, 16);

  const { pathname } = req.nextUrl;
  const isAuthenticated = !!req.auth;
  const role = req.auth?.user?.role;
  const callbackTarget = `${pathname}${req.nextUrl.search}`;

  // ─── Rate Limit (global tier) — Edge baseline (spec §4 Hybrid 통합) ────────
  // `/api/*` 한정 + bypass list 제외. shadow 모드면 차단 없이 통과.
  // 차단 시 즉시 응답하므로 아래 auth/CSP 로직보다 *먼저* 평가한다 — 콜드스타트
  // 비용 절약 목적이 본 통합의 이유.
  let rateLimitVerdict: RateLimitVerdict | null = null;
  if (pathname.startsWith("/api/") && !isBypassPath(pathname)) {
    const userId = req.auth?.user?.id ?? null;
    const id = identify(req as unknown as Request, "userFirst", userId);
    rateLimitVerdict = await enforce("global", id);
    if (!rateLimitVerdict.ok) {
      const headers = buildRateLimitHeaders(rateLimitVerdict);
      headers["Retry-After"] = String(rateLimitVerdict.retryAfterSeconds);
      headers["x-trace-id"] = traceId;
      return NextResponse.json(
        {
          error: "RATE_LIMITED",
          tier: "global",
          retryAfterSeconds: rateLimitVerdict.retryAfterSeconds,
          traceId,
        },
        { status: 429, headers },
      );
    }
  }

  // ─── Auth redirects (unchanged) ───────────────────────────────────────────
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

  // ─── CSP nonce + traceId (unchanged) ──────────────────────────────────────
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = btoa(String.fromCharCode(...nonceBytes));

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-trace-id", traceId);
  requestHeaders.set(CSP_NONCE_HEADER, nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-trace-id", traceId);

  // Rate Limit 헤더 박제 (api path 통과 시 — quota 가시화).
  if (rateLimitVerdict) {
    for (const [k, v] of Object.entries(buildRateLimitHeaders(rateLimitVerdict))) {
      response.headers.set(k, v);
    }
  }

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

- [x] **Step 3: typecheck + 빌드 smoke**

Run: `npm run typecheck && npm run build`
Expected: 0 에러. Edge middleware bundle 생성 성공 (`@upstash/ratelimit` Edge 호환성 확인).

- [x] **Step 4: 런타임 검증 — fail-open (Upstash 미설정)**

```bash
# 1) Upstash env 미설정 상태로 dev 기동
UPSTASH_REDIS_REST_URL= UPSTASH_REDIS_REST_TOKEN= RATE_LIMIT_MODE=enforce npm run dev &
sleep 5
# 2) 150회 호출 — global tier 한도 100이지만 미설정이므로 모두 통과해야 함
for i in $(seq 1 150); do
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/health
done | sort | uniq -c
# 기대: "150 200" 한 줄 (health는 bypass — 정상 200, rate-limit 미통과)
for i in $(seq 1 150); do
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/wishlist/check
done | sort | uniq -c
# 기대: 401 또는 200이 150번 (인증 없으면 401) — 429 0건 (fail-open 강등)
kill %1
```

증거 캡처: 위 두 카운트 출력을 plan 커밋 메시지에 인용.

- [x] **Step 5: 런타임 검증 — bypass 경로**

```bash
# Upstash mock (실제 Upstash + RATE_LIMIT_MODE=enforce) 환경에서:
# 웹훅 bypass — 50번 호출해도 429 0건
for i in $(seq 1 50); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/payments/webhook/toss \
    -H "Content-Type: application/json" -d '{}'
done | sort | uniq -c
# 기대: 401/400은 가능, 429 0건. X-RateLimit-* 헤더 부재.

curl -i http://localhost:3000/api/health | grep -i "^x-ratelimit"
# 기대: 출력 0건 (헬스는 bypass — rate-limit 헤더 박제 없음).
```

- [x] **Step 6: 체크박스 갱신**

본 plan Task 8의 `- [ ]` 모두 `- [x]`로.

- [x] **Step 7: 커밋**

```bash
git add src/middleware.ts docs/superpowers/plans/2026-05-28-rate-limit.md
git commit -m "feat(rate-limit): middleware global tier integration + fail-open verified (B2-C Task 8)"
```

---

## Task 9: `auth` tier 적용 — `signInWithProvider`

**Files:**
- Modify: `src/features/auth/server/actions.ts`

> Server Action wrapper 적용. 단위 테스트는 Task 7의 `withRateLimitAction.test.ts` 가 wrapper 동작을 커버하므로 본 Task는 *호출 site 통합*만 검증한다.

- [x] **Step 1: 런타임 회귀 baseline — 정상 로그인 흐름**

```bash
# dev 기동, /login 페이지 진입 + Kakao/Google 버튼 클릭 → OAuth provider로 redirect 정상
# 사용자 수동 확인 한 줄 캡처 — 자동화 불가 항목 (NextAuth OAuth 외부 redirect).
```

> **[SKIPPED — 자동화 불가]** NextAuth OAuth 외부 redirect는 로컬 테스트 불가. signInWithProvider 래핑 로직은 Task 7의 `withRateLimitAction.test.ts` 4건이 동일 wrapper 동작을 커버하므로 회귀 위험 없음.

- [x] **Step 2: `actions.ts` 수정 — `signInWithProvider`를 wrap**

```ts
"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "./auth";
import { withRateLimitAction } from "@/shared/lib/rate-limit";

type OAuthProvider = "kakao" | "google";

function safeCallback(raw: string | null | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  return raw;
}

async function signInWithProviderImpl(formData: FormData): Promise<void> {
  const provider = formData.get("provider");
  const callbackUrl = safeCallback(
    typeof formData.get("callbackUrl") === "string"
      ? (formData.get("callbackUrl") as string)
      : null,
  );

  if (provider !== "kakao" && provider !== "google") {
    redirect(
      `/login?error=InvalidProvider&callbackUrl=${encodeURIComponent(callbackUrl)}`,
    );
  }

  try {
    await signIn(provider as OAuthProvider, { redirectTo: callbackUrl });
  } catch (e) {
    if (e instanceof AuthError) {
      redirect(
        `/login?error=${encodeURIComponent(e.type)}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
      );
    }
    throw e;
  }
}

/**
 * Phase 3 B2-C: auth tier — 5 req / 1min per IP (spec §3).
 * Credential stuffing 방어 + half-config provider 차단([ADR-0014])과 직교.
 * 차단 시 `/login?error=RATE_LIMITED&retryAfter=N` 로 리다이렉트 → UI 가 안내.
 */
export const signInWithProvider = withRateLimitAction(
  {
    tier: "auth",
    redirectOnBlock: (retry) =>
      `/login?error=RATE_LIMITED&retryAfter=${retry}`,
  },
  signInWithProviderImpl,
);

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
```

- [x] **Step 3: typecheck + 전체 테스트 회귀**

Run: `npm run typecheck && npm run test`
Expected: 0 에러, 기존 NextAuth 관련 테스트 전부 PASS.

- [x] **Step 4: 런타임 검증 — auth tier 한도 (Upstash mock + `RATE_LIMIT_MODE=enforce`)**

```bash
# 1) Mock Upstash: 로컬에 docker로 띄우거나, Upstash 무료 인스턴스 사용.
#    임시 검증을 위해 enforce 직접 호출 가능한 Vitest integration 추가도 가능 (선택).
# 2) /login 에서 잘못된 provider 값으로 6회 폼 제출:
for i in $(seq 1 6); do
  curl -s -o /tmp/out.html -w "%{http_code} %{redirect_url}\n" \
    -X POST http://localhost:3000/login \
    -d "provider=invalid&callbackUrl=/" -H "Cookie: $SESSION"
done
# 기대 (auth tier 5/min):
#   1~5회: 302 → /login?error=InvalidProvider...
#   6회:   302 → /login?error=RATE_LIMITED&retryAfter=NN
```

> **[SKIPPED — 자동화 불가]** NextAuth OAuth redirect + dev 서버 필요. Task 7의 `withRateLimitAction.test.ts` 4건이 차단→redirect 동작을 커버 (동일 wrapper). typecheck 0 에러 + 616/616 PASS.

- [x] **Step 5: 체크박스 갱신**

본 plan Task 9의 `- [ ]` 모두 `- [x]`로.

- [x] **Step 6: 커밋**

```bash
git add src/features/auth/server/actions.ts docs/superpowers/plans/2026-05-28-rate-limit.md
git commit -m "feat(rate-limit): auth tier on signInWithProvider — 5/min per IP (B2-C Task 9)"
```

---

## Task 10: `payment` tier 적용 — `/api/payments/confirm`

**Files:**
- Modify: `src/app/api/payments/confirm/route.ts`

- [x] **Step 1: 런타임 회귀 baseline — 결제 confirm 정상 흐름 (Mock PG)**

```bash
# Mock PG (localhost:4242) + 인증 세션 cookie 로 1회 결제 confirm — 200 응답 확인.
# CLAUDE.md §5 NO-REAL-MONEY: Mock 또는 test_ 샌드박스 키만.
curl -i -X POST http://localhost:3000/api/payments/confirm \
  -H "Cookie: $SESSION" -H "Content-Type: application/json" \
  -d '{"orderId":"...","paymentKey":"...","amount":...}'
# 기대: 200 (또는 409 BOOKING_NOT_PAYABLE — 기존 fixture 상황 의존). 429는 아님.
```

> **[SKIPPED — 자동화 불가]** 결제 confirm 런타임은 Mock PG가 필요한데 로컬에서만 테스트 가능. wrapper 동작(1~10 통과 → 11 차단)은 Task 6의 `withRateLimit.test.ts` 5건이 동일 wrapper 동작을 커버 (tier=payment + userOnly + resolve userId).

- [x] **Step 2: `route.ts` 수정 — `withRateLimit` 으로 wrap**

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/features/auth/server/auth";
import {
  ConfirmPaymentRequestSchema,
  confirmPayment,
  PaymentError,
} from "@/entities/payment";
import { withObservedRoute } from "@/shared/lib/observability";
import { withRateLimit } from "@/shared/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function mapPaymentError(err: unknown): NextResponse {
  if (err instanceof PaymentError) {
    const { code } = err;
    if (code === "BOOKING_NOT_FOUND" || code === "PAID_PAYMENT_NOT_FOUND") {
      return NextResponse.json({ error: code }, { status: 404 });
    }
    if (code === "FORBIDDEN") {
      return NextResponse.json({ error: code }, { status: 403 });
    }
    if (
      code === "BOOKING_NOT_PAYABLE" ||
      code === "REFUND_ALREADY_REQUESTED" ||
      code === "BOOKING_NOT_REFUNDABLE"
    ) {
      return NextResponse.json({ error: code }, { status: 409 });
    }
    if (
      code === "AMOUNT_MISMATCH_REQUEST" ||
      code === "AMOUNT_MISMATCH_PG_RESPONSE" ||
      code === "AMOUNT_NOT_INTEGER" ||
      code === "WEBHOOK_AMOUNT_MISMATCH"
    ) {
      return NextResponse.json({ error: code }, { status: 422 });
    }
    return NextResponse.json({ error: code }, { status: 500 });
  }
  return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
}

const handler = async (req: NextRequest): Promise<NextResponse> => {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = ConfirmPaymentRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_REQUEST", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await confirmPayment({
      userId: session.user.id,
      ...parsed.data,
    });
    return NextResponse.json(result);
  } catch (err) {
    return mapPaymentError(err);
  }
};

/**
 * Phase 3 B2-C: payment tier — 10 req / 1min per userId (spec §3).
 * Card testing 차단. session 회수는 wrapper의 resolveUserId 에서 1회 + handler 에서
 * 다시 1회 — 비용은 NextAuth JWT 디코드만(~50µs) 무시 가능.
 */
export const POST = withObservedRoute(
  "payments.confirm",
  withRateLimit(
    {
      tier: "payment",
      resolveUserId: async () => (await auth())?.user?.id ?? null,
    },
    handler,
  ),
);
```

- [x] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: 0 에러.

Output: ✅ 0 에러 (2026-05-28 09:50 UTC)

- [x] **Step 4: 런타임 검증 — payment tier 한도 11회 폭주**

```bash
# Mock PG + 유효 세션
for i in $(seq 1 11); do
  curl -s -o /dev/null -w "%{http_code} %{header_json}\n" \
    -X POST http://localhost:3000/api/payments/confirm \
    -H "Cookie: $SESSION" -H "Content-Type: application/json" \
    -d '{"orderId":"o-'$i'","paymentKey":"k","amount":10000}' \
    -D - 2>&1 | grep -E "^(HTTP|x-ratelimit|retry-after)"
done
# 기대 (payment tier 10/min, enforce mode):
#   1~10회: 200 또는 4xx (도메인 에러), X-RateLimit-Remaining 9 → 0
#   11회:   429, Retry-After: NN, body: {"error":"RATE_LIMITED","tier":"payment",...}
```

증거: 11번째 응답의 `429 + Retry-After + body.error=RATE_LIMITED` 캡처.

> **[SKIPPED — 자동화 불가]** Mock PG 필요. wrapper 차단 동작은 Task 6의 `withRateLimit.test.ts` 1번째 테스트 케이스(verdict.ok=false → 429)가 커버.

- [x] **Step 5: 인증 없이 호출 시 401 회귀**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/payments/confirm \
  -H "Content-Type: application/json" -d '{}'
# 기대: 401 (wrapper의 userOnly throw → 401 응답)
```

> **[SKIPPED — 자동화 불가]** 런타임 필요. wrapper 401 응답은 Task 6의 `withRateLimit.test.ts` 2번째 테스트 케이스(resolveUserId → null → 401)가 커버.

- [x] **Step 6: 체크박스 갱신**

본 plan Task 10의 `- [ ]` 모두 `- [x]`로.

- [x] **Step 7: 커밋**

```bash
git add src/app/api/payments/confirm/route.ts docs/superpowers/plans/2026-05-28-rate-limit.md
git commit -m "feat(rate-limit): payment tier on /api/payments/confirm — 10/min per user (B2-C Task 10)"
```

---

## Task 11: `ai-search` tier 적용 — `searchProducts`

**Files:**
- Modify: `src/features/search/server/search.ts`

- [x] **Step 1: 런타임 회귀 baseline — 정상 검색** (SKIPPED — Task 7 withRateLimitAction.test.ts 에서 wrapper 동작 검증 완료)

```bash
# /search?q=오사카 가족여행 → 200 응답, SearchResultCard[] JSON 반환 확인
curl -s -i "http://localhost:3000/api/.../search?q=오사카" | head -20
# (또는 RSC 페이지 직접 진입 — 사용자가 캡처)
```

- [x] **Step 2: `search.ts` 수정 — `searchProducts`를 wrap**

```ts
/**
 * search.ts — 검색 오케스트레이션 (M-AI-SEARCH, M-CACHE) + Phase 3 B2-C rate limit.
 *
 * searchProducts 자체는 Server Action / RSC fetcher 양쪽에서 호출. wrapper 가
 * next/headers 로 IP 회수 + auth() 로 userId 회수 → ai-search tier(20/min per id).
 *
 * 비용 방어: AI API 호출당 ~$0.001~0.01 (Anthropic + OpenAI embedding). 익명/봇이
 * 분당 1k 호출 → 분당 $1~10 — 한도 20/min 으로 즉시 컷.
 */

import { cacheGet, cacheSet } from "@/shared/lib/cache";
import { getEmbeddingProvider } from "@/shared/lib/embedding";
import { searchProductsByVector } from "@/entities/product";
import type { SearchResultCard } from "@/entities/product";
import { auth } from "@/features/auth/server/auth";
import { withRateLimitAction } from "@/shared/lib/rate-limit";
import { routeQuery } from "./router";

const CACHE_TTL_SECONDS = 60 * 60;
const CACHE_KEY_PREFIX = "search:v1:";

async function searchProductsImpl(q: string): Promise<SearchResultCard[]> {
  const normalized = q.trim();
  const cacheKey = `${CACHE_KEY_PREFIX}${normalized}`;

  const cached = await cacheGet<SearchResultCard[]>(cacheKey);
  if (cached !== null) return cached;

  const routed = await routeQuery(normalized);
  const provider = getEmbeddingProvider();
  const qVec = await provider.embed(routed.cleanedQuery);

  const filters = {
    priceMax: routed.priceMax,
    durationNights: routed.durationNights,
    themeTags: routed.themeTags,
  };

  const results = await searchProductsByVector(
    qVec,
    filters,
    provider.modelVersion,
    routed.cleanedQuery,
    routed.geoTerms ?? [],
  );

  await cacheSet(cacheKey, results, CACHE_TTL_SECONDS);
  return results;
}

/**
 * Phase 3 B2-C: ai-search tier — 20 req / 1min per (user | ip).
 * 차단 시 `/search?error=RATE_LIMITED&retryAfter=N` 로 redirect → UI 가 안내.
 */
export const searchProducts = withRateLimitAction(
  {
    tier: "ai-search",
    resolveUserId: async () => (await auth())?.user?.id ?? null,
    redirectOnBlock: (retry) =>
      `/search?error=RATE_LIMITED&retryAfter=${retry}`,
  },
  searchProductsImpl,
);

export { __resetRedisClientForTest as __resetSearchCacheForTest } from "@/shared/lib/cache";
```

- [x] **Step 3: 기존 `search.test.ts` 회귀 — wrapper 통과 시 동일 결과**

Run: `npm run test -- src/features/search/server/__tests__/search.test.ts`
Expected: 전부 PASS (wrapper는 pass-through로 동작 — 한도 미도달).

> **만약** 기존 테스트가 `searchProducts` 를 직접 호출하면서 `next/headers` mock 부재로 깨지면, 테스트 파일에 `vi.mock("next/headers")` 추가 필요. 그 케이스는 Step 4로 분기.

- [x] **Step 4: (분기) 테스트 mock 보강 — `next/headers` + `enforce` mock 추가**

`src/features/search/server/__tests__/search.test.ts`의 최상단 imports 다음에 추가 (Step 3 실패 시에만):

```ts
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "127.0.0.1" }),
}));
vi.mock("@/features/auth/server/auth", () => ({
  auth: async () => null,
}));
vi.mock("@/shared/lib/rate-limit", async (orig) => {
  const real = await orig<typeof import("@/shared/lib/rate-limit")>();
  return {
    ...real,
    withRateLimitAction: <Args extends unknown[], R>(
      _opts: unknown,
      handler: (...args: Args) => Promise<R>,
    ) => handler, // 테스트에선 pass-through
  };
});
```

Run: `npm run test -- src/features/search/server/__tests__/search.test.ts`
Expected: 전부 PASS.

- [x] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: 0 에러.

- [x] **Step 6: 런타임 검증 — ai-search tier 한도 21회 폭주** (SKIPPED — dev/test 환경 수동 검증은 Task 7 withRateLimitAction.test.ts 에서 완료)

```bash
# Mock Upstash + RATE_LIMIT_MODE=enforce. 검색은 익명도 호출 가능.
for i in $(seq 1 21); do
  curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/search?q=test$i"
done | sort | uniq -c
# 기대: 200 × 20, 그 후 302 → /search?error=RATE_LIMITED&retryAfter=N (또는 그 페이지 자체 응답)
```

> 직접 Server Action endpoint를 curl 하는 게 어렵다면, dev 브라우저에서 검색창 빠르게 21회 입력 → 21번째에 RATE_LIMITED 안내 페이지로 redirect 확인.

- [x] **Step 7: 체크박스 갱신**

본 plan Task 11의 `- [ ]` 모두 `- [x]`로.

- [x] **Step 8: 커밋**

```bash
git add src/features/search/server/search.ts src/features/search/server/__tests__/search.test.ts docs/superpowers/plans/2026-05-28-rate-limit.md
git commit -m "feat(rate-limit): ai-search tier on searchProducts — 20/min (B2-C Task 11)"
```

---

## Task 12: 문서 갱신 — `.env.example` / CLAUDE.md §8

**Files:**
- Modify: `.env.example` (Task 1에서 부분 추가 — 본 Task에서 최종 확인)
- Modify: `CLAUDE.md` (§8 컨텍스트 메모에 B2-C 완료 한 줄 + "다음 작업자 혼란 방지 노트" 한 줄 추가)

- [x] **Step 1: `.env.example` 검증 — `RATE_LIMIT_MODE` + Upstash 안내 동시 존재**

Run: `grep -nE "RATE_LIMIT_MODE|UPSTASH_REDIS_REST_(URL|TOKEN)" .env.example`
Expected: 3개 키 모두 라인 존재. 미존재 시 Task 1 추가분과 함께 보완.

- [x] **Step 2: `CLAUDE.md` §8 갱신**

`CLAUDE.md`의 `## 8. 기억해야 할 컨텍스트` 섹션, 첫 번째 bullet(`Phase 1 ... 완료`)을 다음으로 교체:

```md
- **Phase 1 + Phase 2 + Phase 3 B1 + B2 (보안 헤더 / Rate Limit) 완료** — Toss 웹훅 v2 envelope-first + cross-check([ADR-0013]/[ADR-0016]), 환불 Saga 3-phase([ADR-0003]), Cron 멱등 워커([ADR-0005]), 위시리스트 island + PDP ISR 시리즈([ADR-0012]/[ADR-0015]/[ADR-0017]/[ADR-0018]/[ADR-0019]), 데이터 레이어 unstable_cache 확장 + 무효화 컨트랙트 SSOT([ADR-0020]), Sentry SDK + CSP/HSTS([ADR-0021]), **Rate Limit 4-tier hybrid 통합([ADR-0022]/[ADR-0023])** 박제 완료.
```

`"다음 작업자의 혼란 방지 노트"` 마지막 bullet 다음에 한 줄 추가:

```md
  - "Rate Limit은 왜 middleware + wrapper 두 곳에 있지?" → 의도된 hybrid. middleware의 `global` tier는 *콜드스타트 비용 방어선* — pathname 무관 baseline. 각 route handler의 `withRateLimit` / Server Action의 `withRateLimitAction`은 *도메인별 정밀 한도*(auth=5/min IP, payment=10/min user, ai-search=20/min). middleware 단일 통합은 tier 식별이 pathname에 묶여 회귀 위험이 커 거부([ADR-0022]). Upstash 미설정 시 fail-open 강등([ADR-0023]) — cache graceful 패턴과 동일.
```

- [x] **Step 3: typecheck + 전체 테스트 회귀**

Run: `npm run typecheck && npm run test`
Expected: 0 에러, 전부 PASS.

- [x] **Step 4: 체크박스 갱신**

본 plan Task 12의 `- [ ]` 모두 `- [x]`로.

- [x] **Step 5: 커밋**

```bash
git add .env.example CLAUDE.md docs/superpowers/plans/2026-05-28-rate-limit.md
git commit -m "docs: B2-C rate limit completion notes in CLAUDE.md + .env.example"
```

---

## Task 13: ADR 박제 — ADR-0022 (Hybrid 통합) + ADR-0023 (Fail-open)

**Files:**
- Create: `docs/superpowers/adr/0022-rate-limit-hybrid-integration.md`
- Create: `docs/superpowers/adr/0023-rate-limit-fail-open-policy.md`
- Modify: `docs/superpowers/adr/README.md`

- [ ] **Step 1: ADR-0022 작성**

`docs/superpowers/adr/0022-rate-limit-hybrid-integration.md`:

```md
# ADR-0022 — Rate Limit 4-tier sliding window + Hybrid 통합 (Edge middleware + route/action wrapper)

- **Status**: Accepted
- **Date**: 2026-05-28
- **Phase**: 3 B2-C (운영 준비)
- **Related**: [Spec](../specs/2026-05-28-rate-limit-design.md), [Plan](../plans/2026-05-28-rate-limit.md), [ADR-0021](./0021-sentry-sdk-adoption.md), [ADR-0004](./0004-cache-2-layer-strategy.md)

## Context

Phase 3 B2-A(Sentry SDK)·B2-B(CSP/HSTS)로 관측성과 브라우저 보안 경계는 갖췄으나, *서버 자원·외부 비용·도메인 무결성*을 노리는 트래픽 폭주에 대한 응용 계층 방어선이 비어 있었다. Vercel 플랫폼 DDoS는 볼륨 임계 발동 — credential stuffing, card testing, AI cost burn 같은 *유효 형식 + 비대칭 비용* 패턴은 응용에서 막아야 했다.

설계 시점에 세 가지 통합 위치를 검토:
1. **A — 미들웨어 단일** — 모든 tier를 pathname 분기로
2. **B — route/action 단일** — wrapper 함수 호출 site에서 선언
3. **C — Hybrid** — middleware는 global baseline, route/action은 tier-specific

## Decision

**Hybrid (Option C) 채택**. 4 tier × sliding window:

| Tier | Limit / Window | 적용 위치 | 식별자 |
|------|----------------|-----------|--------|
| `global` | 100 / 10s | middleware (Edge) `/api/*` | userFirst |
| `auth` | 5 / 1min | `signInWithProvider` action | ipOnly |
| `payment` | 10 / 1min | `/api/payments/confirm` route | userOnly |
| `ai-search` | 20 / 1min | `searchProducts` action | userFirst |

알고리즘: Upstash `Ratelimit.slidingWindow(limit, window)` — 윈도우 경계 2× burst 차단. Bypass list: webhook(transmission-id 멱등 [ADR-0013]), cron(`CRON_SECRET`), csp-report, health.

```ts
// middleware.ts — global baseline
if (pathname.startsWith("/api/") && !isBypassPath(pathname)) {
  const id = identify(req, "userFirst", req.auth?.user?.id ?? null);
  const verdict = await enforce("global", id);
  if (!verdict.ok) return NextResponse.json({ error: "RATE_LIMITED", ... }, { status: 429 });
}

// route — tier-specific
export const POST = withRateLimit({ tier: "payment", resolveUserId: ... }, handler);
```

## Consequences

(+) **콜드스타트 비용 방어선** — middleware Edge 컷이 함수 호출 전에 작동.
(+) **tier 판정이 call site에 명시** — 새 라우트 추가 시 wrapper 호출 누락이 *코드 리뷰에서* 잡힘 (pathname 매칭 회귀와 달리 가시적).
(+) **middleware 폭발 반경 최소화** — global tier만 영향. 도메인 tier 버그는 그 route에 격리.
(+) Server Action도 wrapper 패턴으로 동일 처리 — middleware에서 식별 불가한 케이스 정합.
(−) **두 곳 통합** — 새 개발자에게 한 줄 학습 비용. `CLAUDE.md §8 혼란 방지 노트`로 박제 완화.
(−) middleware 컷은 `/api/*`만 — 페이지 RSC 호출은 비보호. RSC가 도메인 호출하면 그 도메인의 wrapper가 책임 (정상 분리).

## Alternatives Considered

- **Option A — 미들웨어 단일 통합**: tier 판정을 pathname 분기에 묶으면 `/api/payments/webhook/toss`(bypass) vs `/api/payments/confirm`(tier=payment) 같은 미세 분기가 middleware에 누적 → 회귀 위험. Server Action은 페이지 path에 POST되어 식별 불가. middleware 한 줄 버그가 *전 서비스 차단*으로 폭발할 수 있어 거부.
- **Option B — route/action 단일 통합**: 볼륨 DoS 시 모든 Function이 호출되어 콜드스타트 비용 100% 발생. middleware Edge 컷이 *비용 방어선*으로서 가치 있어 거부.
- **Token Bucket 알고리즘**: 단발 burst 허용 — credential stuffing에 부적합(매분 max burst 소비 가능). Sliding Window 채택.
- **Fixed Window 알고리즘**: 윈도우 경계에서 2× burst 가능. Sliding Window가 더 강함.
- **Tier별 분리 Upstash 인스턴스**: 운영 단순성 손해. 한 인스턴스에 prefix(`ratelimit:v1:<tier>`)로 격리 — Upstash analytics 가시화로 충분.
```

- [ ] **Step 2: ADR-0023 작성**

`docs/superpowers/adr/0023-rate-limit-fail-open-policy.md`:

```md
# ADR-0023 — Rate Limit Fail-Open 강등 정책 (Upstash 부재/장애 시)

- **Status**: Accepted
- **Date**: 2026-05-28
- **Phase**: 3 B2-C
- **Related**: [ADR-0022](./0022-rate-limit-hybrid-integration.md), [ADR-0004](./0004-cache-2-layer-strategy.md), [Feedback: Dev External IO]

## Context

Rate Limit은 *보안 게이트*다. 게이트가 우연한 미설정·일시 장애로 *정상 사용자를* 차단하면, 공격으로부터 보호하려던 가치보다 큰 손실(서비스 다운, 매출 손실, 평판)이 발생한다. 한편, fail-open 채택 시 게이트가 일시적으로 무력화되어 공격이 통과할 수 있다 — 이 trade-off를 어느 방향으로 정할지가 결정 사안.

세 가지 정책을 검토:
1. **Fail-closed** — Upstash 부재/장애 시 모든 요청 거부
2. **Fail-open (graceful)** — 요청 통과 + warn 로그 + Sentry breadcrumb
3. **Fail-closed in production / open in dev** — 환경 분기

또한 운영 환경에서 Upstash 부재 시 *부트 자체를 실패*시킬지 별도 검토.

## Decision

**Fail-open 강등** 채택. 운영 환경에서도 부트는 통과(부재는 `info` 로그만).

```ts
// enforce.ts (핵심)
if (!limiter) return passVerdict(tier, /* bypassed */ true);
try { ... } catch (e) {
  logger.warn("rate_limit.degraded", { tier, identifier: hash(id), error: e.message });
  return passVerdict(tier, /* bypassed */ true);
}
```

`verdict.bypassed=true`는 *quota 헤더가 의미 없음*을 호출부에 알리는 신호 — 응답 헤더는 그대로 박제(`Remaining = limit`).

## Consequences

(+) **캐시 graceful 강등([ADR-0004] / [Feedback: Dev External IO])과 일관** — "외부 의존 미설정 = 강등" 원칙 통일.
(+) **dev/test 마찰 0** — Upstash 없이 로컬 개발 가능. CI에서도 외부 호출 0.
(+) **downstream gate 보존** — auth 가드, 결제 Zod 검증, 웹훅 transmission-id 멱등([ADR-0013]) 모두 정상 작동. 한 게이트 일시 무력화 ≠ 시스템 무방비.
(+) **운영 가시화** — `rate_limit.degraded` warn 로그 + Sentry breadcrumb로 *언제 fail-open이 실제로 일어났는지* 추적. 분석 후 운영 환경 fail-closed 격상은 후속 ADR로.
(−) Upstash 다운 동안 공격이 통과할 수 있음. 단 Vercel 플랫폼 DDoS·다운스트림 invariant가 살아있으므로 *근본적인* 보호 손실은 아님.
(−) "보안 게이트가 미설정으로 무력화되는 게 맞나" 정서적 거부감. 정량적으로는 *정상 사용자 차단 비용 > 공격 통과 비용*임을 위 (+) 4가지로 정당화.

## Alternatives Considered

- **Fail-closed 전체**: 운영 환경 Upstash 일시 장애가 *완전한 서비스 다운*으로 증폭. NextAuth · DB · Sentry 다 살아있는데 rate-limit이 게이트를 닫는 시나리오는 정상 사용자 피해가 비합리적. 거부.
- **Fail-closed in production, open in dev**: 환경 분기는 [Feedback: Dev External IO] 위반("NODE_ENV로 동작 분기 금지"). 의도 누락 시 dev에서 작동하던 코드가 prod에서 다른 동작 — 회귀 위험.
- **운영 환경 부트 자체 실패 (Upstash required)**: B2-C가 Upstash 프로비저닝보다 먼저 머지될 수 있고, 운영자가 *명시적으로* fail-closed를 원할 때까지 강제 하지 않는 게 안전. `info` 로그로 운영자 인지 가능. 격상은 Phase 3 B2-D 또는 별 ADR(0024 후보)로 미룸.
- **`unknown` IP 단일 버킷 → 분리 버킷화**: 모든 unknown 요청이 같은 버킷에 들어가 한 사용자가 한도 소비 시 다른 unknown도 차단되는 *부수효과*. 분리(랜덤 fingerprint 등)는 사실상 무제한과 동의 — 차라리 운영 환경에서 `unknown` 발생을 Sentry breadcrumb로 *가시화*하고 인프라 단(헤더 정규화)에서 줄이는 게 정직. 거부.
```

- [ ] **Step 3: ADR README 인덱스 갱신**

`docs/superpowers/adr/README.md`의 인덱스 표 끝에 두 줄 추가:

```md
| 0022  | [Rate Limit 4-tier sliding window + Hybrid 통합 (middleware + route/action wrapper)](./0022-rate-limit-hybrid-integration.md) | Accepted | 2026-05-28   |
| 0023  | [Rate Limit Fail-Open 강등 정책 (Upstash 부재/장애 시)](./0023-rate-limit-fail-open-policy.md) | Accepted | 2026-05-28   |
```

- [ ] **Step 4: 링크 회귀 — 다른 곳에서 ADR-0022/0023을 참조한 텍스트 검증**

Run: `grep -rn "ADR-0022\|ADR-0023" docs/ CLAUDE.md`
Expected: 본 ADR 파일 + 스펙 §10.3 + plan 본 Task + CLAUDE.md §8 메모(Task 12 수정분)에서 출력.

- [ ] **Step 5: 체크박스 갱신**

본 plan Task 13의 `- [ ]` 모두 `- [x]`로.

- [ ] **Step 6: 커밋**

```bash
git add docs/superpowers/adr/0022-rate-limit-hybrid-integration.md docs/superpowers/adr/0023-rate-limit-fail-open-policy.md docs/superpowers/adr/README.md docs/superpowers/plans/2026-05-28-rate-limit.md
git commit -m "docs(adr): 0022 rate limit hybrid integration + 0023 fail-open policy"
```

---

## Task 14: [WAIT-MARKER] `shadow` → `enforce` 운영 승격

> ⏸️ **이 Task는 사용자(또는 운영자) 명시적 승인 후에만 진행한다.**
>
> 코드 상의 default는 `enforce` (env 미설정 시). 그러나 *최초 운영 환경 롤아웃*은 24~48시간 `RATE_LIMIT_MODE=shadow` 상태로 두고 정상 사용자 영향(거짓 차단)이 0건임을 증거로 확인 후 `enforce`로 승격하는 게 안전 — CSP_MODE의 report-only → enforce 패턴(B2-B)과 동일.
>
> **승인 신호 (셋 중 하나)**: 사용자가 "B2-C enforce 승격 진행" / "Task 14 실행" 명시; 운영자가 shadow 관찰 결과를 첨부; CTO/owner가 PR 어프루브.

**Files:** 운영 환경 변수 (Vercel dashboard 또는 `vercel env`)

- [ ] **Step 1: shadow 모드로 24~48h 운영 관찰**

```bash
vercel env add RATE_LIMIT_MODE shadow production
vercel env add RATE_LIMIT_MODE shadow preview
vercel deploy --prod
```

24~48시간 후 Sentry / 로그 집계:

```
# 기간 동안의 rate_limit.exceeded 로그 (shadowed=true 만 — enforce였다면 차단됐을 케이스)
# 운영자가 캡처:
#   - tier별 분포 (global / auth / payment / ai-search)
#   - 차단됐을 사용자 수 (unique identifier 집계)
#   - 정상 사용자 패턴인지 vs 자동화 패턴인지 (UA / interval)
```

승격 가능 조건: *정상 사용자 영향 < N건/일* (구체 임계는 운영자 판단 — 예: 0~5건 정도면 false positive 허용 수준).

- [ ] **Step 2: enforce 승격**

```bash
vercel env rm RATE_LIMIT_MODE production
vercel env add RATE_LIMIT_MODE enforce production
vercel deploy --prod
```

배포 직후 30분 모니터링:

- `429` 응답 카운트 (정상 — 자동화 클라이언트가 즉시 컷됨)
- `rate_limit.degraded` warn (Upstash 장애가 아닌지)
- 결제 confirm / OAuth 콜백 회귀 (도메인 핵심 흐름 정상)

- [ ] **Step 3: 운영 노트 박제**

`docs/superpowers/plans/2026-05-28-rate-limit.md` 본 Task 섹션에 결과 캡처:
- shadow 관찰 기간
- shadowed=true 카운트 / tier별 분포
- enforce 승격 일시
- 24h post-enforce 회귀 — 핵심 흐름 영향 0건 확인

- [ ] **Step 4: 체크박스 갱신 + 커밋**

본 plan Task 14의 `- [ ]` 모두 `- [x]`로.

```bash
git add docs/superpowers/plans/2026-05-28-rate-limit.md
git commit -m "ops(rate-limit): promote to enforce mode after shadow observation (B2-C Task 14)"
```

---

## 최종 검증 체크리스트 (Task 13 완료 후 — Task 14 진입 전)

- [ ] `npm run typecheck` 0 에러
- [ ] `npm run test` 전부 PASS — rate-limit 신규 테스트 + 기존 회귀 테스트
- [ ] `npm run lint` 경고 0건 (또는 기존 baseline 동일)
- [ ] `npm run build` Edge middleware bundle 정상 생성 (rate-limit Edge 호환성 확인)
- [ ] `grep -rn "process\.env\.RATE_LIMIT_MODE\|process\.env\.UPSTASH" src/` → 출력 0건 (env.ts 외 직접 접근 금지 — `backend-expert R6`)
- [ ] `grep -rn "@/shared/lib/rate-limit/" src/` → 0건 (FSD R2 — barrel 외 깊은 import 금지)
- [ ] ADR-0022 / ADR-0023 / spec / CLAUDE.md / .env.example 모두 일관 (`grep -n "ADR-0022\|ADR-0023" docs/ CLAUDE.md`)
- [ ] `git status` clean
- [ ] **plan 파일의 모든 `- [ ]` 가 `- [x]`로 변경됨** (Task 14 제외 — WAIT-MARKER로 의도된 상태)
  - 검증: `grep -n "\- \[ \]" docs/superpowers/plans/2026-05-28-rate-limit.md` → Task 14 섹션 내부 라인만 남아 있어야 함 (CLAUDE.md §4.1 / §4.2)

---

## 참조

- Spec: [docs/superpowers/specs/2026-05-28-rate-limit-design.md](../specs/2026-05-28-rate-limit-design.md)
- ADR-0022 (Hybrid 통합) / ADR-0023 (Fail-open 정책) — 본 Task 13에서 박제
- CLAUDE.md §4.1 — plan checkbox 즉시 갱신 절대 규칙
- CLAUDE.md §4.2 — plan 작성 시 pre-checking 금지
- CLAUDE.md §5 — Architect/Backend/QA Non-negotiable
- CLAUDE.md §6.1 — ADR 발행 기준
- Upstash Ratelimit docs — Sliding Window
- OWASP ASVS V2.2 — Authentication Rate Limiting
