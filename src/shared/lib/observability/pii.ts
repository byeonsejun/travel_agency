/**
 * pii.ts — 로그·에러 페이로드의 개인정보(PII) 마스킹 순수 함수.
 *
 * 사용 시점: logger v2(Task 4)·errorTracker(Task 5)가 직렬화 직전에 호출.
 *
 * 정책:
 *  - 민감 키(`password`, `token`, `authorization`, `cookie`, `secret`,
 *    `tossPaymentKey`, `paymentKey`, `apiKey`, `accessToken`, `refreshToken`,
 *    `cardNumber`, `ssn`, `passportNo`, `*_SECRET` suffix)는 대소문자 무시로 `[REDACTED]` 치환
 *  - 문자열 값에 이메일·전화·카드번호 패턴이 보이면 해당 부분만 마스킹
 *  - 원본 mutate 금지 (공통 절대 규칙 — 입력 배열·객체 변이 금지)
 *  - maxDepth 초과 시 `[MAX_DEPTH]` 마커, 순환 참조는 `[CIRCULAR]` 마커
 */

const DEFAULT_MAX_DEPTH = 6;

const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /^password$/i,
  /^token$/i,
  /^authorization$/i,
  /^cookie$/i,
  /^secret$/i,
  /secret$/i, // `*_SECRET` (AUTH_SECRET, CRON_SECRET 등)
  /^paymentkey$/i,
  /^tosspaymentkey$/i,
  /^apikey$/i,
  /^accesstoken$/i,
  /^refreshtoken$/i,
  /^cardnumber$/i,
  /^ssn$/i,
  /^passportno$/i,
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));
}

// 이메일 RFC 단순화 — 로깅 맥락에선 false-positive 허용, 누출 차단이 우선
const EMAIL_RE = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-])[A-Za-z0-9.-]*\.[A-Za-z]{2,}/g;
// KR 휴대전화: 010 + 8자리. 하이픈 유무 모두 허용.
const PHONE_KR_RE = /\b010-?\d{4}-?\d{4}\b/g;
// 16~19 연속 숫자(공백/하이픈 허용) — 카드번호 가능성
const CARD_RE = /\b(?:\d[ -]?){15,18}\d\b/g;

function maskString(value: string): string {
  let out = value;
  // 카드번호가 가장 먼저 — 길이가 길어 다른 패턴과 충돌 가능
  out = out.replace(CARD_RE, "[REDACTED:CARD]");
  out = out.replace(PHONE_KR_RE, "010-****-****");
  out = out.replace(EMAIL_RE, (_match, localFirst, domainFirst) => {
    return `${localFirst}***@${domainFirst}***`;
  });
  return out;
}

interface MaskOptions {
  maxDepth?: number;
}

type Json = unknown;

function maskInternal(
  value: Json,
  depth: number,
  maxDepth: number,
  seen: WeakSet<object>
): Json {
  if (value === null || value === undefined) return value;

  const t = typeof value;
  if (t === "string") return maskString(value as string);
  if (t === "number" || t === "boolean" || t === "bigint") return value;
  if (t === "function" || t === "symbol") return `[${t.toUpperCase()}]`;

  if (depth >= maxDepth) return "[MAX_DEPTH]";

  // 객체 / 배열
  if (typeof value === "object") {
    if (seen.has(value as object)) return "[CIRCULAR]";
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.map((item) => maskInternal(item, depth + 1, maxDepth, seen));
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        out[k] = "[REDACTED]";
        continue;
      }
      out[k] = maskInternal(v, depth + 1, maxDepth, seen);
    }
    return out;
  }

  return value;
}

/**
 * PII 마스킹된 새 페이로드를 반환한다. 원본은 변경하지 않는다.
 *
 * @example
 *   maskPii({ password: "x", email: "a@b.co" })
 *   // → { password: "[REDACTED]", email: "a***@b***" }
 */
export function maskPii<T>(data: T, options?: MaskOptions): T {
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const seen = new WeakSet<object>();
  return maskInternal(data, 0, maxDepth, seen) as T;
}
