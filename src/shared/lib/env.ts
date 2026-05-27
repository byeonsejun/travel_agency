import { z } from "zod";

// envSchema는 테스트에서 다양한 시나리오(NO-REAL-MONEY invariant 등)를
// safeParse로 검증하기 위해 export한다. 실제 부팅값은 `env` 한 곳에서만 사용.
export const envSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    DIRECT_URL: z.string().url(),
    AUTH_SECRET: z.string().min(32),
    AUTH_KAKAO_ID: z.string().optional(),
    AUTH_KAKAO_SECRET: z.string().optional(),
    // Google OAuth (PRD §4.2 — 소셜 로그인). 페어 검증 + 포맷 가드는 superRefine.
    AUTH_GOOGLE_ID: z.string().optional(),
    AUTH_GOOGLE_SECRET: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM_EMAIL: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    // M-AI-SEARCH 하이브리드 검색: 실 임베딩 provider 키 (OpenAI).
    OPENAI_API_KEY: z.string().optional(),
    // 비-프로덕션에서도 실 임베딩 API를 켜는 opt-in 스위치.
    // "1"/"true"면 NODE_ENV와 무관하게 OpenAIEmbeddingProvider 사용.
    // 기본 false → dev는 DeterministicDevProvider 유지(외부 비용 0).
    USE_REAL_EMBEDDING: z.preprocess(
      (v) => v === "1" || v === "true",
      z.boolean()
    ),
    // M-CACHE: Upstash Redis 분산 캐시 (REST). 둘 다 미설정이면
    // 캐시 레이어는 no-op으로 강등(매 요청 원본 파이프라인 — dev 무중단).
    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
    TOSS_CLIENT_KEY: z.string().optional(),
    TOSS_SECRET_KEY: z.string().optional(),
    TOSS_API_BASE_URL: z
      .string()
      .url()
      .default("https://api.tosspayments.com"),
    // 1단계(토스 샌드박스 실거래 테스트) opt-in 스위치.
    // 비-프로덕션에서 "1"/"true"면 dev Mock 폴백을 끄고 실제 토스
    // 결제창을 띄운다. 샌드박스(test_ 키) 전용 — 라이브 키와 조합 시
    // 아래 superRefine이 차단한다 (CLAUDE.md §5 NO-REAL-MONEY).
    PAYMENT_FORCE_REAL: z.preprocess(
      (v) => v === "1" || v === "true",
      z.boolean()
    ),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    // M-OBS: 관측성 환경 변수.
    // SENTRY_DSN이 비어있으면 errorTracker는 logger fanout만 수행한다 (no-op SDK 경로).
    // 빈 문자열("")은 미설정으로 간주 (preprocess로 undefined 변환).
    SENTRY_DSN: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().url().optional()
    ),
    OBSERVABILITY_LOG_LEVEL: z
      .enum(["debug", "info", "warn", "error"])
      .default("info"),
    APP_VERSION: z.string().optional(),
    // Cron worker 인증용 비밀키. /api/cron/* 라우트가 Authorization: Bearer
    // 헤더로 이 값을 검증한다. production에선 superRefine으로 required.
    // dev/test에선 optional이지만 설정되어 있으면 동일 검증을 거친다.
    CRON_SECRET: z.string().min(32).optional(),
    // M-OBS-2: Sentry SDK 운영 env (Phase 3 B2-A).
    // SENTRY_AUTH_TOKEN은 sourcemap upload용 build-only 비밀 — 런타임 노출 차단을 superRefine에서 강제.
    SENTRY_AUTH_TOKEN: z.string().optional(),
    SENTRY_ENVIRONMENT: z.string().optional(),
    SENTRY_RELEASE: z.string().optional(),
    // Phase 3 B2-B: CSP 적용 모드.
    // 'report-only' — Content-Security-Policy-Report-Only 헤더(위반 신고만, 차단 없음).
    // 'enforce'      — Content-Security-Policy 헤더(실제 차단).
    // 미설정 시 middleware가 report-only를 기본으로 사용.
    // 빈 문자열("")은 미설정으로 간주 (SENTRY_DSN 패턴 — vi.stubEnv 호환).
    CSP_MODE: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.enum(["report-only", "enforce"]).optional()
    ),
    // Phase 3 B2-C: Rate limit 모드.
    // 'shadow'   — 한도 초과를 로그만 남기고 차단하지 않음 (점진 롤아웃).
    // 'enforce'  — 한도 초과 시 429 차단.
    // 미설정 시 enforce가 안전 기본값(wrapper/middleware 내부 default).
    // 빈 문자열("")은 미설정으로 간주 (vi.stubEnv 호환).
    RATE_LIMIT_MODE: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.enum(["shadow", "enforce"]).optional()
    ),
  })
  .superRefine((env, ctx) => {
    // 빌드 phase(NEXT_PHASE=phase-production-build)는 실 runtime이 아니다.
    // 운영자는 CI에서 빌드, Vercel/배포 환경에 시크릿 주입하는 패턴이 일반적이므로
    // 빌드 단계엔 required env가 부재해도 통과시키고, 실제 production runtime에서만
    // 강제한다. NO-REAL-MONEY 강제(live_ 키 차단)는 빌드/runtime 모두 적용.
    const isBuildPhase =
      process.env.NEXT_PHASE === "phase-production-build";

    if (env.NODE_ENV === "production" && !isBuildPhase) {
      for (const key of [
        "TOSS_CLIENT_KEY",
        "TOSS_SECRET_KEY",
        "CRON_SECRET",
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required in production`,
          });
        }
      }
    }

    // 🛑 NO-REAL-MONEY 런타임 강제 (CLAUDE.md §5, ADR-0009 → ADR-0014로 격상).
    // (1) 결제 키는 `test_` 화이트리스트만 허용한다 — 어떤 환경(production 포함)에서도
    //     `test_` 가 아닌 prefix는 부팅 자체를 막는다. ADR-0009의 블랙리스트(live_만 거부)
    //     를 화이트리스트로 격상해 운영 키·임의 prefix·placeholder 혼입을 모두 fail-fast.
    //     client/secret 2종 모두 대칭. (webhook secret 은 ADR-0016 cross-check 채택으로
    //     env 자체가 제거되어 대상에서 제외.)
    for (const key of [
      "TOSS_CLIENT_KEY",
      "TOSS_SECRET_KEY",
    ] as const) {
      const val = env[key];
      if (val && !val.startsWith("test_")) {
        const prefixHint = val.startsWith("live_") ? "live(실거래) 키" : `'${val.slice(0, 8)}…'`;
        ctx.addIssue({
          code: "custom",
          path: [key],
          message:
            `${key}: test_ 샌드박스 키만 허용됩니다 (NO-REAL-MONEY, ADR-0014). ` +
            `현재 ${prefixHint} — live_ 등 운영/임의 prefix는 부팅에서 차단됩니다.`,
        });
      }
    }

    // (3) OAuth provider 페어/포맷 검증 (PRD §4.2 — Social Login).
    //     ID/SECRET 중 한쪽만 설정되면 NextAuth 부팅 시 의미 없는(half-configured)
    //     provider가 노출되거나 콜백 시 cryptic 에러를 던지므로 부팅에서 차단.
    //     Google ID는 표준 포맷(*.apps.googleusercontent.com)을 강제해 placeholder/
    //     잘못된 키 혼입을 즉시 잡는다.
    const oauthPairs = [
      { name: "KAKAO", id: env.AUTH_KAKAO_ID, secret: env.AUTH_KAKAO_SECRET },
      { name: "GOOGLE", id: env.AUTH_GOOGLE_ID, secret: env.AUTH_GOOGLE_SECRET },
    ] as const;
    for (const { name, id, secret } of oauthPairs) {
      if (!!id !== !!secret) {
        ctx.addIssue({
          code: "custom",
          path: [id ? `AUTH_${name}_SECRET` : `AUTH_${name}_ID`],
          message:
            `AUTH_${name}_ID 와 AUTH_${name}_SECRET 은 항상 함께 설정되어야 합니다 ` +
            `(현재 한쪽만 설정됨 — provider half-config 차단).`,
        });
      }
    }
    if (env.AUTH_GOOGLE_ID && !env.AUTH_GOOGLE_ID.endsWith(".apps.googleusercontent.com")) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_GOOGLE_ID"],
        message:
          "AUTH_GOOGLE_ID: Google OAuth 표준 포맷(*.apps.googleusercontent.com)이 아닙니다. " +
          "Google Cloud Console에서 발급된 client ID 전체를 사용하세요.",
      });
    }

    // (2) 테스트 환경(NODE_ENV=test)에서는 외부 결제 IO 자체를 차단한다.
    //     feedback_dev_external_io 원칙 — 테스트는 항상 Mock(localhost),
    //     PAYMENT_FORCE_REAL이나 운영 토스 도메인 호출은 테스트 신뢰성을 깨뜨림.
    //     dev 환경은 토스 샌드박스 실거래 검증 용도로 두 옵션 모두 허용.
    if (env.NODE_ENV === "test") {
      if (env.PAYMENT_FORCE_REAL) {
        ctx.addIssue({
          code: "custom",
          path: ["PAYMENT_FORCE_REAL"],
          message:
            "PAYMENT_FORCE_REAL: NODE_ENV=test에서는 활성화 불가 " +
            "(테스트는 Mock 폴백만 허용 — NO-REAL-MONEY).",
        });
      }
      if (/(^|\/\/)([^/]+\.)?tosspayments\.com($|\/)/i.test(env.TOSS_API_BASE_URL)) {
        ctx.addIssue({
          code: "custom",
          path: ["TOSS_API_BASE_URL"],
          message:
            "TOSS_API_BASE_URL: NODE_ENV=test에서는 운영 토스 도메인 호출 금지 " +
            "(localhost Mock만 허용).",
        });
      }
    }

    // 🔐 SENTRY_AUTH_TOKEN: build-time only invariant.
    // - NEXT_PHASE=phase-production-build (Vercel 빌드 단계)에서만 통과 허용
    // - 그 외 runtime(serverless function cold start / edge)에서는 부재해야 함
    // - 잘못 주입되어 있으면 부팅 자체를 차단 → sourcemap upload key leak 방어선
    const isBuildPhaseForAuth =
      process.env.NEXT_PHASE === "phase-production-build";

    if (env.SENTRY_AUTH_TOKEN && !isBuildPhaseForAuth) {
      ctx.addIssue({
        code: "custom",
        path: ["SENTRY_AUTH_TOKEN"],
        message:
          "SENTRY_AUTH_TOKEN은 빌드 단계(NEXT_PHASE=phase-production-build)에서만 " +
          "노출되어야 합니다. 런타임(serverless function / edge)에 주입되면 즉시 " +
          "부팅을 차단합니다 — Vercel 환경 변수의 'Build' scope만 체크하고 " +
          "'Production'·'Preview' runtime scope에서는 해제하세요. " +
          "(sourcemap upload token leak 방어 — ADR-0014 NEXT_PHASE 분기 패턴 참조)",
      });
    }
  });

export const env = envSchema.parse(process.env);
