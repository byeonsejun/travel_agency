/**
 * render.ts — EmailType + props → { subject, html, text }.
 * 워커가 발송 직전 호출. 템플릿은 평문 props만 받는 순수 컴포넌트.
 */

import { render } from "@react-email/render";
import type { EmailType } from "@prisma/client";
import { BookingConfirmationEmail } from "./templates/BookingConfirmationEmail";
import { RefundCompletedEmail } from "./templates/RefundCompletedEmail";
import type {
  BookingConfirmationEmailProps,
  RefundCompletedEmailProps,
} from "./templates/types";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export type EmailPropsByType = {
  BOOKING_CONFIRMATION: BookingConfirmationEmailProps;
  REFUND_COMPLETED: RefundCompletedEmailProps;
};

export async function renderEmail<T extends EmailType>(
  type: T,
  props: EmailPropsByType[T],
): Promise<RenderedEmail> {
  if (type === "BOOKING_CONFIRMATION") {
    const p = props as BookingConfirmationEmailProps;
    const node = BookingConfirmationEmail(p);
    return {
      subject: `[Nextour] 예약이 확정되었습니다 — ${p.productTitle}`,
      html: await render(node),
      text: await render(node, { plainText: true }),
    };
  }

  const p = props as RefundCompletedEmailProps;
  const node = RefundCompletedEmail(p);
  return {
    subject: `[Nextour] 환불이 완료되었습니다 — ${p.productTitle}`,
    html: await render(node),
    text: await render(node, { plainText: true }),
  };
}
