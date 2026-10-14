/**
 * `_ga` 쿠키 → GA4 client_id 파싱 (ADR-0062). 순수 함수 — 서버 action 과 테스트에서 사용.
 * 쿠키 포맷: `GA1.<domainLevel>.<random>.<timestamp>` → client_id = `<random>.<timestamp>`.
 * 서버 MP 발송(purchase/refund)을 브라우저 세션에 귀속시키는 키.
 */
const GA_COOKIE_RE = /^GA\d+\.\d+\.(\d+\.\d+)$/;

export function parseGaClientId(cookieValue: string | undefined | null): string | null {
  if (!cookieValue) return null;
  const m = GA_COOKIE_RE.exec(cookieValue);
  return m ? m[1] : null;
}
