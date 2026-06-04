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
  // 결제 페이지는 nested 경로(/products/[id]/checkout)라 prefix startsWith 로는
  // 안 잡힌다. 결제는 force-dynamic 보안 도메인이므로 nonce CSP(strict-dynamic)를
  // 받아야 토스 SDK 가 동적 삽입하는 script 가 propagation 으로 통과한다.
  // (PDP `/products/[id]` 는 ISR 이라 static CSP 유지 — checkout segment 만 승격.)
  if (pathname.endsWith("/checkout")) return true;
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
  // static 모드의 'unsafe-inline' 은 Next 15 App Router 의 RSC hydration payload 지원용.
  // Next 가 정적/ISR 페이지에도 `self.__next_f.push([...])` flight chunk 를 다수의
  // 인라인 <script> 로 emit 하므로 'self' 만으로는 framework script 가 전부 차단된다.
  // 외부 origin script 는 여전히 'self' 가 차단 — 인라인 XSS 방어선은 포기, 외부
  // 악성 도메인 로딩 차단은 유지하는 트레이드오프 (ADR-0025 Addendum).
  const scriptSrc =
    input.mode === "dynamic"
      ? `script-src 'self' 'nonce-${input.nonce}' 'strict-dynamic'`
      : `script-src 'self' 'unsafe-inline'`;

  const directives = [
    `default-src 'self'`,
    scriptSrc,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https://*.supabase.co https://picsum.photos`,
    `font-src 'self' data:`,
    // 토스 결제: SDK script(js.) + 결제 iframe(payment-gateway-sandbox.) + API 서브도메인을
    // 와일드카드 하나로 통일 — enforce 모드 전환 시에도 결제 경로가 깨지지 않게 한다.
    `connect-src 'self' https://*.ingest.sentry.io https://*.tosspayments.com https://*.supabase.co`,
    `frame-src 'self' https://*.tosspayments.com`,
    `frame-ancestors 'none'`,
    `form-action 'self' https://*.tosspayments.com`,
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
