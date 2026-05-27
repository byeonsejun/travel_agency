import type { NextConfig } from "next";

// next.config.mjs default export 는 withSentryConfig(nextConfig, opts) 의 반환값이다.
// wrapper 는 inner NextConfig 의 모든 키(headers 포함)를 보존한다는 contract 를 신뢰한다 —
// Sentry SDK 가 이 contract 를 깨면 next-config-headers.test.ts 의 런타임 호출이 즉시 실패한다.
declare const config: NextConfig;
export default config;
