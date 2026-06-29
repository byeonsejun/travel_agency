/**
 * 매직링크 메일 정적 HTML 미리보기 생성기 (개발용 — 발송 없음).
 * 실행: npx tsx scripts/preview-magic-link-email.ts
 * 출력: /tmp/magic-link-email-preview.html (브라우저로 열어 확인)
 */
import { writeFileSync } from "node:fs";
import { renderMagicLinkEmail } from "../src/shared/email/magicLink";

const SAMPLE_URL =
  "https://nextour.example/api/auth/callback/resend?token=SAMPLE_TOKEN_NOT_REAL&email=traveler%40example.com";

async function main() {
  const { subject, html, text } = await renderMagicLinkEmail(SAMPLE_URL);
  const out = "/tmp/magic-link-email-preview.html";
  writeFileSync(out, html, "utf8");
  console.log("subject:", subject);
  console.log("preview HTML written to:", out);
  console.log("\n--- plaintext fallback ---\n" + text);
}

main();
