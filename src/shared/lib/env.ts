import { z } from "zod";

const envSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    DIRECT_URL: z.string().url(),
    AUTH_SECRET: z.string().min(32),
    AUTH_KAKAO_ID: z.string().optional(),
    AUTH_KAKAO_SECRET: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM_EMAIL: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    TOSS_CLIENT_KEY: z.string().optional(),
    TOSS_SECRET_KEY: z.string().optional(),
    TOSS_WEBHOOK_SECRET: z.string().optional(),
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
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production") {
      for (const key of [
        "TOSS_CLIENT_KEY",
        "TOSS_SECRET_KEY",
        "TOSS_WEBHOOK_SECRET",
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

    // 🛑 NO-REAL-MONEY 런타임 강제 (CLAUDE.md §5).
    // 라이브 키(live_)는 어떤 환경에서도 부팅 자체를 막는다 — 문서 규칙을
    // 코드로 못박아, 실수로라도 실거래 경로가 활성화되지 않게 한다.
    for (const key of ["TOSS_CLIENT_KEY", "TOSS_SECRET_KEY"] as const) {
      const val = env[key];
      if (val && val.startsWith("live_")) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message:
            `${key}: live(실거래) 키는 금지됩니다 (NO-REAL-MONEY). ` +
            `test_ 샌드박스 키만 허용.`,
        });
      }
    }
  });

export const env = envSchema.parse(process.env);
