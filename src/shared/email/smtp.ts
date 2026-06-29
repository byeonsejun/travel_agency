/**
 * smtp.ts — 매직링크 로그인 메일 발송 transport (Gmail SMTP via nodemailer).
 *
 * 매직링크 전용 transport. 아웃박스(예약/환불) 메일은 별도로 Resend SDK
 * (provider.ts)를 쓴다 — 이 모듈과 무관.
 *
 * 왜 Gmail SMTP인가: Resend 샌드박스(onboarding@resend.dev)는 계정 본인
 * 이메일로만 발송돼 임의 사용자에게 매직링크가 가지 않는다. 도메인 인증 없이
 * 누구에게나 발송하기 위해 Gmail SMTP로 교체. 인증·토큰·URL 생성은 Auth.js
 * 책임이며 여기선 렌더된 메일을 전송만 한다.
 *
 * 호출 컨텍스트: dev/test는 auth.ts의 useDevConsoleFallback이 먼저 return하므로
 * 이 모듈은 production 발송 경로에서만 실행된다 → env 가드가 throw해도 dev 무영향.
 */

import "server-only";

import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/shared/lib/env";
import { brandedFrom } from "./magicLink";
import type { RenderedEmail } from "./render";

// nodemailer transporter는 재사용 가능한 연결 풀 — 모듈 스코프 싱글턴으로 캐시.
let transporter: Transporter | null = null;

/**
 * Gmail SMTP transporter를 lazy하게 생성·반환한다.
 * GMAIL_USER/GMAIL_APP_PASSWORD는 env에서 optional이라 string 보장이 필요 →
 * 미설정 시 명확한 에러로 즉시 실패(production required, dev는 호출 자체가 없음).
 *
 * @returns transporter와 인증 계정 user(발신 표시명 브랜딩용, string 보장)
 */
function getTransporter(): { transporter: Transporter; user: string } {
  const user = env.GMAIL_USER;
  const pass = env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      "GMAIL_USER / GMAIL_APP_PASSWORD가 설정되지 않았습니다. " +
        "매직링크 메일 발송에는 Gmail SMTP 자격증명이 필요합니다 " +
        "(Google 앱 비밀번호, production required).",
    );
  }
  // service: "gmail"이 host/port/secure를 내부적으로 설정(smtp.gmail.com:465).
  transporter ??= nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
  return { transporter, user };
}

/**
 * 렌더된 매직링크 메일을 Gmail SMTP로 발송한다.
 * 발신자는 Gmail SMTP 특성상 인증 계정으로 강제되므로 from은 항상
 * `Nextour <GMAIL_USER>` (brandedFrom)로 브랜딩한다.
 */
export async function sendMagicLinkEmail(
  to: string,
  email: RenderedEmail,
): Promise<void> {
  const { transporter, user } = getTransporter();
  await transporter.sendMail({
    from: brandedFrom(user),
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
}
