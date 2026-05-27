export const CSP_NONCE_HEADER = "x-nonce" as const;

export type CspBuildInput = {
  nonce: string;
  reportOnly: boolean;
};

export type CspBuildOutput = {
  headerName: "Content-Security-Policy" | "Content-Security-Policy-Report-Only";
  value: string;
};

export function buildCspHeader({ nonce, reportOnly }: CspBuildInput): CspBuildOutput {
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
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
    headerName: reportOnly
      ? "Content-Security-Policy-Report-Only"
      : "Content-Security-Policy",
    value: directives.join("; "),
  };
}
