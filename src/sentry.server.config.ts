/**
 * sentry.server.config.ts — Node runtime용 Sentry.init.
 *
 * instrumentation.ts의 register()에서 NEXT_RUNTIME=nodejs 분기로 dynamic import된다.
 * top-level side-effect (Sentry.init)만 수행하고 default export는 두지 않는다.
 */

import * as Sentry from "@sentry/nextjs";
import { env } from "@/shared/lib/env";

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: env.SENTRY_RELEASE ?? env.APP_VERSION,
    // performance traces — 별 PR (Phase 3 B2 non-goal)
    tracesSampleRate: 0,
    // PII는 errorTracker.maskPii로 1차 제거, SDK 단에서 이중 방어
    sendDefaultPii: false,
  });
}
