export { renderEmail } from "./render";
export type { RenderedEmail, EmailPropsByType } from "./render";
export { sendEmail } from "./provider";
export type { SendEmailInput, SendEmailResult } from "./provider";
export type {
  BookingConfirmationEmailProps,
  RefundCompletedEmailProps,
  PartialRefundCompletedEmailProps,
} from "./templates/types";
