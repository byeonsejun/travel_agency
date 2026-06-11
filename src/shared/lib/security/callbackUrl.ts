/**
 * 인증 콜백 복귀 경로 정규화 — open-redirect 방어.
 *
 * 로그인/리다이렉트 흐름에서 `?callbackUrl=` 로 전달된 복귀 목적지를 검증한다.
 * **안전한 내부 절대경로(`/path`) 만 허용**하고, 그 외는 `fallback` 으로 강등:
 *   - 외부 URL(`https://evil.com`) → 강등 (open redirect 차단)
 *   - 프로토콜-상대 경로(`//evil.com`) → 강등 (브라우저가 외부로 해석)
 *   - 백슬래시 우회(`/\evil.com`) → 강등 (일부 브라우저가 `//` 로 정규화)
 *   - 제어문자/개행 포함 → 강등 (헤더/리다이렉트 인젝션)
 *   - 비어있음/누락 → 강등
 *
 * middleware(인증 사용자의 `/login` 진입)와 login 페이지가 **동일 판정**을
 * 공유하도록 SSOT 로 둔다 — 두 곳이 갈리면 복귀 경로/보안 경계가 어긋난다.
 */
export function safeCallbackPath(
  raw: string | null | undefined,
  fallback = "/",
): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.startsWith("/\\")) return fallback;
  // 제어문자(\x00-\x1f) 차단 — 리다이렉트/헤더 인젝션 방어.
  if (/[\x00-\x1f]/.test(raw)) return fallback;
  return raw;
}
