/**
 * provider.ts — 메일 발송 어댑터.
 *
 * Dev 폴백: NODE_ENV !== "production" 이면 실제 Resend를 호출하지 않고 콘솔로 출력한다.
 * auth.ts(매직링크)의 useDevConsoleFallback과 동일 기준 — @nextour.test 시드 계정에
 * 실메일이 나가 바운스되는 것을 차단한다.
 *
 * 멱등: production 발송 시 Resend idempotencyKey=dedupeKey 전달 →
 * at-least-once 재시도가 고객 메일함에서 effectively-once가 된다.
 */

import { Resend } from "resend";
import { env } from "@/shared/lib/env";
import { logger } from "@/shared/lib/observability";

const useDevConsoleFallback = env.NODE_ENV !== "production";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}

export interface SendEmailResult {
  id: string | null;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (useDevConsoleFallback) {
    logger.info("email.dev_fallback", { to: input.to, subject: input.subject });
    console.log(
      `\n📧 [DEV] Email to ${input.to}\n  subject: ${input.subject}\n  ${input.text.slice(0, 200)}\n`,
    );
    return { id: `dev-${input.idempotencyKey}` };
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send(
    {
      from: env.RESEND_FROM_EMAIL ?? "Nextour <noreply@nextour.example>",
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    },
    { idempotencyKey: input.idempotencyKey },
  );

  if (error) {
    throw new Error(`resend send failed: ${error.message}`);
  }
  return { id: data?.id ?? null };
}
