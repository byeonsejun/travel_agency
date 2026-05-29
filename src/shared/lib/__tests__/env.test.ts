import { afterEach, describe, expect, it } from "vitest";

import { envSchema } from "@/shared/lib/env";

// 모든 env 시나리오 테스트의 공통 베이스라인.
// invariant 차단 여부만 검증하므로 production-required 키는 NODE_ENV=test로 회피.
const validBase = {
  DATABASE_URL: "postgresql://localhost:5432/test",
  DIRECT_URL: "postgresql://localhost:5432/test",
  AUTH_SECRET: "x".repeat(32),
  USE_REAL_EMBEDDING: "0",
  PAYMENT_FORCE_REAL: "0",
  // NODE_ENV=test에서 default(api.tosspayments.com)는 ADR-0009 invariant에 걸린다.
  // localhost Mock으로 명시 — 테스트는 항상 Mock 원칙과 일관.
  TOSS_API_BASE_URL: "http://localhost:4242",
  NODE_ENV: "test",
} as const;

describe("envSchema — NO-REAL-MONEY invariant (ADR-0009, ADR-0014)", () => {
  // ADR-0014 화이트리스트 격상: `test_` 가 아닌 모든 prefix 거부.
  // 블랙리스트(live_만 거부)에서 화이트리스트(test_만 허용)로 invariant 강화.
  describe("test_ 화이트리스트 격상 (ADR-0014)", () => {
    it("TOSS_CLIENT_KEY=prod_… (test_ 아님) 이면 parse 실패", () => {
      const result = envSchema.safeParse({
        ...validBase,
        TOSS_CLIENT_KEY: "prod_ck_abc",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path[0] === "TOSS_CLIENT_KEY"),
        ).toBe(true);
      }
    });

    it("TOSS_SECRET_KEY=ck_abc (prefix 없음) 이면 parse 실패", () => {
      const result = envSchema.safeParse({
        ...validBase,
        TOSS_SECRET_KEY: "ck_abc",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path[0] === "TOSS_SECRET_KEY"),
        ).toBe(true);
      }
    });

    it("production 환경에서도 test_ 가 아니면 차단 (운영 배포 fail-fast)", () => {
      const result = envSchema.safeParse({
        ...validBase,
        NODE_ENV: "production",
        TOSS_CLIENT_KEY: "prod_ck_abc",
        TOSS_SECRET_KEY: "prod_sk_abc",
        CRON_SECRET: "y".repeat(32),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const offending = result.error.issues.filter(
          (i) => i.path[0] === "TOSS_CLIENT_KEY" || i.path[0] === "TOSS_SECRET_KEY",
        );
        expect(offending.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe("live_ 키 부팅 차단 (모든 환경)", () => {
    it("TOSS_CLIENT_KEY=live_… 이면 parse 실패", () => {
      const result = envSchema.safeParse({
        ...validBase,
        TOSS_CLIENT_KEY: "live_ck_abc",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path[0] === "TOSS_CLIENT_KEY")).toBe(true);
      }
    });

    it("TOSS_SECRET_KEY=live_… 이면 parse 실패", () => {
      const result = envSchema.safeParse({
        ...validBase,
        TOSS_SECRET_KEY: "live_sk_abc",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path[0] === "TOSS_SECRET_KEY")).toBe(true);
      }
    });

    it("production 환경에서도 live_ 키 차단", () => {
      // production에서는 다른 required 키들도 필요하지만, live_ 차단 이슈가 포함되는지만 확인.
      const result = envSchema.safeParse({
        ...validBase,
        NODE_ENV: "production",
        TOSS_CLIENT_KEY: "live_ck_abc",
        TOSS_SECRET_KEY: "live_sk_abc",
        CRON_SECRET: "y".repeat(32),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const liveIssues = result.error.issues.filter((i) =>
          /live\(실거래\)/.test(i.message)
        );
        expect(liveIssues.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("test_ 샌드박스 키는 정상 통과", () => {
      const result = envSchema.safeParse({
        ...validBase,
        TOSS_CLIENT_KEY: "test_ck_abc",
        TOSS_SECRET_KEY: "test_sk_abc",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("test 환경에서 외부 결제 IO 차단", () => {
    // 신규 invariant: 테스트는 항상 Mock — feedback_dev_external_io와 일관.
    it("NODE_ENV=test + PAYMENT_FORCE_REAL=true 조합 차단", () => {
      const result = envSchema.safeParse({
        ...validBase,
        NODE_ENV: "test",
        PAYMENT_FORCE_REAL: "1",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path[0] === "PAYMENT_FORCE_REAL")
        ).toBe(true);
      }
    });

    // 신규 invariant: 테스트 환경에서 운영 토스 도메인을 가리키면 차단.
    it("NODE_ENV=test + TOSS_API_BASE_URL=api.tosspayments.com 차단", () => {
      const result = envSchema.safeParse({
        ...validBase,
        NODE_ENV: "test",
        TOSS_API_BASE_URL: "https://api.tosspayments.com",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path[0] === "TOSS_API_BASE_URL")
        ).toBe(true);
      }
    });

    it("NODE_ENV=test + TOSS_API_BASE_URL=localhost(Mock) 정상 통과", () => {
      const result = envSchema.safeParse({
        ...validBase,
        NODE_ENV: "test",
        TOSS_API_BASE_URL: "http://localhost:4242",
      });
      expect(result.success).toBe(true);
    });

    // dev 환경은 PAYMENT_FORCE_REAL=true 허용 (토스 샌드박스 실거래 테스트 용도).
    it("NODE_ENV=development + PAYMENT_FORCE_REAL=true 정상 통과", () => {
      const result = envSchema.safeParse({
        ...validBase,
        NODE_ENV: "development",
        PAYMENT_FORCE_REAL: "1",
        TOSS_CLIENT_KEY: "test_ck_abc",
        TOSS_SECRET_KEY: "test_sk_abc",
      });
      expect(result.success).toBe(true);
    });

    // dev 환경에서 운영 도메인은 허용 (샌드박스 test_ 키와 조합 시 토스 샌드박스가 응답).
    it("NODE_ENV=development + TOSS_API_BASE_URL=api.tosspayments.com 정상 통과", () => {
      const result = envSchema.safeParse({
        ...validBase,
        NODE_ENV: "development",
        TOSS_API_BASE_URL: "https://api.tosspayments.com",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("baseline sanity", () => {
    it("validBase만으로 정상 통과", () => {
      const result = envSchema.safeParse(validBase);
      expect(result.success).toBe(true);
    });
  });
});

describe("envSchema — OAuth provider 페어/포맷 가드", () => {
  describe("Kakao 페어 검증", () => {
    it("AUTH_KAKAO_ID만 있고 SECRET이 없으면 실패", () => {
      const result = envSchema.safeParse({
        ...validBase,
        AUTH_KAKAO_ID: "kakao_id_xyz",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => /KAKAO/.test(i.message)),
        ).toBe(true);
      }
    });

    it("AUTH_KAKAO_SECRET만 있고 ID가 없으면 실패", () => {
      const result = envSchema.safeParse({
        ...validBase,
        AUTH_KAKAO_SECRET: "kakao_secret_xyz",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => /KAKAO/.test(i.message)),
        ).toBe(true);
      }
    });

    it("둘 다 설정되면 통과", () => {
      const result = envSchema.safeParse({
        ...validBase,
        AUTH_KAKAO_ID: "kakao_id_xyz",
        AUTH_KAKAO_SECRET: "kakao_secret_xyz",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Google 페어 + 포맷 검증", () => {
    it("AUTH_GOOGLE_ID만 있고 SECRET이 없으면 실패", () => {
      const result = envSchema.safeParse({
        ...validBase,
        AUTH_GOOGLE_ID: "abc.apps.googleusercontent.com",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => /GOOGLE/.test(i.message)),
        ).toBe(true);
      }
    });

    it("AUTH_GOOGLE_SECRET만 있고 ID가 없으면 실패", () => {
      const result = envSchema.safeParse({
        ...validBase,
        AUTH_GOOGLE_SECRET: "google_secret_xyz",
      });
      expect(result.success).toBe(false);
    });

    it("AUTH_GOOGLE_ID 포맷이 .apps.googleusercontent.com 으로 끝나지 않으면 실패", () => {
      const result = envSchema.safeParse({
        ...validBase,
        AUTH_GOOGLE_ID: "not-a-google-id",
        AUTH_GOOGLE_SECRET: "google_secret_xyz",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some(
            (i) =>
              i.path[0] === "AUTH_GOOGLE_ID" &&
              /googleusercontent\.com/.test(i.message),
          ),
        ).toBe(true);
      }
    });

    it("페어 모두 설정 + Google 표준 포맷 → 통과", () => {
      const result = envSchema.safeParse({
        ...validBase,
        AUTH_GOOGLE_ID: "123456789.apps.googleusercontent.com",
        AUTH_GOOGLE_SECRET: "GOCSPX-google_secret_xyz",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("default 상태 — 둘 다 미설정", () => {
    it("Kakao/Google 모두 미설정이면 통과 (provider 비활성 경로)", () => {
      const result = envSchema.safeParse(validBase);
      expect(result.success).toBe(true);
    });
  });
});

describe("CSP_MODE", () => {
  it("미설정 시 undefined — 기본 report-only 동작 (middleware 에서 분기)", () => {
    const parsed = envSchema.parse(validBase);
    expect(parsed.CSP_MODE).toBeUndefined();
  });

  it("CSP_MODE=report-only — 통과", () => {
    const parsed = envSchema.parse({ ...validBase, CSP_MODE: "report-only" });
    expect(parsed.CSP_MODE).toBe("report-only");
  });

  it("CSP_MODE=enforce — 통과", () => {
    const parsed = envSchema.parse({ ...validBase, CSP_MODE: "enforce" });
    expect(parsed.CSP_MODE).toBe("enforce");
  });

  it("CSP_MODE=invalid — Zod 실패", () => {
    expect(() => envSchema.parse({ ...validBase, CSP_MODE: "bogus" })).toThrow();
  });
});

describe("envSchema — RATE_LIMIT_MODE", () => {
  it("accepts 'enforce'", () => {
    const r = envSchema.safeParse({ ...validBase, RATE_LIMIT_MODE: "enforce" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.RATE_LIMIT_MODE).toBe("enforce");
  });
  it("accepts 'shadow'", () => {
    const r = envSchema.safeParse({ ...validBase, RATE_LIMIT_MODE: "shadow" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.RATE_LIMIT_MODE).toBe("shadow");
  });
  it("allows omission (undefined)", () => {
    const r = envSchema.safeParse(validBase);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.RATE_LIMIT_MODE).toBeUndefined();
  });
  it("rejects unknown value", () => {
    const r = envSchema.safeParse({ ...validBase, RATE_LIMIT_MODE: "off" });
    expect(r.success).toBe(false);
  });
});

describe("envSchema — SENTRY_AUTH_TOKEN runtime exposure 차단 (build-only invariant)", () => {
  const originalNextPhase = process.env.NEXT_PHASE;
  const originalVercel = process.env.VERCEL;

  afterEach(() => {
    if (originalNextPhase === undefined) delete process.env.NEXT_PHASE;
    else process.env.NEXT_PHASE = originalNextPhase;
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  });

  it("NEXT_PHASE=phase-production-build + SENTRY_AUTH_TOKEN 설정 → parse 통과", () => {
    process.env.NEXT_PHASE = "phase-production-build";
    delete process.env.VERCEL;
    const result = envSchema.safeParse({
      ...validBase,
      SENTRY_AUTH_TOKEN: "sntrys_xxxxxxxxxxxxxxxx",
    });
    expect(result.success).toBe(true);
  });

  it("비-Vercel runtime (Docker / bare metal) + SENTRY_AUTH_TOKEN 설정 → parse 실패 (런타임 노출 차단)", () => {
    delete process.env.NEXT_PHASE;
    delete process.env.VERCEL;
    const result = envSchema.safeParse({
      ...validBase,
      SENTRY_AUTH_TOKEN: "sntrys_xxxxxxxxxxxxxxxx",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path[0] === "SENTRY_AUTH_TOKEN",
      );
      expect(issue).toBeDefined();
      expect(issue?.message).toContain("phase-production-build");
    }
  });

  // ADR-0024: Vercel runtime 은 빌드+런타임 env scope 분리가 없어 차단 시 middleware crash.
  // 보안은 (a) org:ci token scope + (b) Vercel Sensitive 마스킹 + (c) 런타임 코드 token 미참조의 다층 방어로 대체.
  it("Vercel runtime (VERCEL=1, NEXT_PHASE 미설정) + SENTRY_AUTH_TOKEN 설정 → parse 통과 (ADR-0024)", () => {
    delete process.env.NEXT_PHASE;
    process.env.VERCEL = "1";
    const result = envSchema.safeParse({
      ...validBase,
      SENTRY_AUTH_TOKEN: "sntrys_xxxxxxxxxxxxxxxx",
    });
    expect(result.success).toBe(true);
  });

  it("SENTRY_AUTH_TOKEN 부재 → NEXT_PHASE/VERCEL 무관 통과", () => {
    delete process.env.NEXT_PHASE;
    delete process.env.VERCEL;
    const result = envSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });
});
