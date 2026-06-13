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
  // [Phase 5-C / ADR-0053] Cache Components 전역 전환. 앱 전체가 PPR(정적 셸 +
  // Suspense 동적 스트리밍) 모델. 'use cache' 지시어 활성화의 전제 플래그.
  // Suspense 미격리 동적 읽기(cookies/headers/searchParams/auth/uncached db)는 빌드 에러.
  cacheComponents: true,
  // [Next 16] images.qualities 기본 [75], minimumCacheTTL 기본 4h 수용.
  // remotePatterns만 사용(images.domains는 deprecated, 우리는 미사용).
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
  // hideSourceMaps: Sentry v9에서 무대체 삭제됨 — SDK가 기본으로 hidden sourcemap 방출.
});
