/**
 * magicLink.ts — 매직링크 로그인 메일 렌더링 + 발신 표시명 헬퍼.
 *
 * EmailJob 아웃박스(renderEmail/EmailType)와 분리: 매직링크는 Prisma EmailType이
 * 아니라 Auth.js가 sendVerificationRequest에서 동기 발송하는 인증 메일이므로 전용
 * 렌더 경로를 둔다. 토큰·URL 생성은 Auth.js 책임 — 여기선 받은 `url`을 연결만 한다.
 */

import { render } from "@react-email/render";
import { MagicLinkEmail } from "./templates/MagicLinkEmail";
import type { RenderedEmail } from "./render";

// Auth.js Resend provider 기본 maxAge = 24 * 60 * 60초. 우리 config가 override하지
// 않으므로 실제 매직링크 토큰 만료는 24시간이다(본문 안내와 동기화 SSOT).
export const MAGIC_LINK_EXPIRY_HOURS = 24;

/**
 * 발신 표시명을 Nextour로 보장한다. RESEND_FROM_EMAIL이 이미 `이름 <주소>` 형태면
 * 그대로 두고, 순수 주소(`addr@domain`)면 `Nextour <addr@domain>`으로 감싼다.
 * 발신 주소 자체는 바꾸지 않는다(도메인 인증 불요 — 표시명만 브랜드화).
 */
export function brandedFrom(from: string): string {
  return from.includes("<") ? from : `Nextour <${from}>`;
}

export async function renderMagicLinkEmail(url: string): Promise<RenderedEmail> {
  const node = MagicLinkEmail({ url, expiresInHours: MAGIC_LINK_EXPIRY_HOURS });
  return {
    subject: "[Nextour] 로그인 링크",
    html: await render(node),
    text: await render(node, { plainText: true }),
  };
}
