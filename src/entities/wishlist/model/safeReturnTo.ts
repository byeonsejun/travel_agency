// callbackUrl / returnTo 파라미터를 신뢰할 수 없는 사용자 입력으로 간주하고
// 같은 origin 의 절대 경로만 허용. protocol-relative("//evil.com") 와
// 절대 URL("http://...", "https://...") 모두 open-redirect 공격 벡터이므로
// "/" 로 폴백.
export function safeReturnTo(input: string | undefined | null): string {
  if (typeof input !== "string" || input.length === 0) return "/";
  if (input.startsWith("//")) return "/";
  if (!input.startsWith("/")) return "/";
  return input;
}
