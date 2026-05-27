/**
 * sentry.edge.config.ts — Edge runtime용 Sentry.init.
 *
 * Edge 부팅 안정성을 위해 env.ts(Zod) 의존성을 우회하고 bare process.env만 사용
 * (env.ts는 Prisma adapter 등 Node API에 transitively 묶일 수 있어 Edge에서 부팅 실패 위험).
 */

import * as Sentry from "@sentry/nextjs";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}
