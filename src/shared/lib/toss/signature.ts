import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Toss 웹훅 서명 검증 (HMAC-SHA256, base64).
 * timingSafeEqual로 타이밍 공격 방어.
 * secret이 undefined이면 throw — 운영 환경에서 키 미설정 사고 차단.
 */
export function verifyTossSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string
): boolean {
  if (secret === undefined || secret === null) {
    throw new Error("TOSS_WEBHOOK_SECRET is not configured");
  }
  if (!signature) return false;

  const expected = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const expectedBuf = Buffer.from(expected);
  let actualBuf: Buffer;
  try {
    actualBuf = Buffer.from(signature);
  } catch {
    return false;
  }

  if (expectedBuf.length !== actualBuf.length) return false;

  return timingSafeEqual(expectedBuf, actualBuf);
}
