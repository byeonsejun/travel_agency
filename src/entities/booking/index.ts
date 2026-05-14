export type {
  BookingStatus,
  TravelerRole,
  PaymentStatus,
  PaymentMethod,
} from "@prisma/client";

export type {
  SafeBooking,
  BookingDetail,
  BookingListItem,
  CancelableBookingStatus,
} from "./model/types";

export {
  BOOKING_STATUS_LABEL,
  CANCEL_REASON_PRESETS,
  PAYMENT_METHOD_LABEL,
  BOOKING_PROGRESS_STEPS,
  TERM_KEYS,
} from "./model/constants";
export type { BookingProgressStep } from "./model/constants";
