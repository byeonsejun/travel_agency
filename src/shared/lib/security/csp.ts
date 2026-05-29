export const CSP_NONCE_HEADER = "x-nonce" as const;

/**
 * Nonce + 'strict-dynamic' 를 강제할 경로 prefix.
 *
 * 분기 이유: 본 프로젝트의 캐시 정책상 `/`, `/products/[id]` 등은 ISR/static prerender
 * 로 응답되어 HTML 본문이 캐시된다. middleware 는 요청마다 새 nonce 를 발급하므로
 * 캐시된 HTML 의 `<script>` 태그 nonce 와 응답 헤더의 nonce 가 매 요청 불일치하여
 * 'strict-dynamic' 이 모든 framework script 를 차단한다.
 *
 * 따라서 nonce 모델은 (a) 매 요청 렌더 (force-dynamic) 인 보안 민감 경로에만 적용하고
 * (b) 정적/ISR 경로는 'self' 기반 완화 CSP 로 대체한다.
 *
 * 본 목록은 `force-dynamic` 도메인(결제·예약·admin·auth 류) 과 모든 `/api/*` 를 포함.
 * `/api/csp-report` 는 middleware matcher 에서 이미 제외되어 본 분기 대상이 아님.
 *
 * SSOT: 새 force-dynamic 도메인 추가 시 본 배열도 함께 갱신해야 한다.
 */
const DYNAMIC_CSP_PREFIXES = [
  "/admin",
  "/checkout",
  "/payment",
  "/api",
  "/login",
  "/signup",
  "/booking",
  "/bookings",
  "/mypage",
] as const;

export function isDynamicCspPath(pathname: string): boolean {
  return DYNAMIC_CSP_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export type CspBuildInput =
  | { mode: "dynamic"; nonce: string; reportOnly: boolean }
  | { mode: "static"; reportOnly: boolean };

export type CspBuildOutput = {
  headerName: "Content-Security-Policy" | "Content-Security-Policy-Report-Only";
  value: string;
};

export function buildCspHeader(input: CspBuildInput): CspBuildOutput {
  const scriptSrc =
    input.mode === "dynamic"
      ? `script-src 'self' 'nonce-${input.nonce}' 'strict-dynamic'`
      : `script-src 'self'`;

  const directives = [
    `default-src 'self'`,
    scriptSrc,
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
    headerName: input.reportOnly
      ? "Content-Security-Policy-Report-Only"
      : "Content-Security-Policy",
    value: directives.join("; "),
  };
}
