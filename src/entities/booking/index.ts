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

export {
  ALLOWED_TRANSITIONS,
  assertTransition,
  shouldReturnSeats,
  InvalidTransitionError,
} from "./model/transitions";

export { CreateBookingSchema, TravelerSchema } from "./model/schemas";
export type { CreateBookingInput, TravelerInput } from "./model/schemas";

export {
  createBooking,
  transitionStatus,
  cancelBookingByUser,
} from "./api/mutations";

export {
  getBookingById,
  listMyBookings,
  getBookingDetail,
} from "./api/queries";

export {
  InsufficientCapacityError,
  reserveSeats,
  releaseSeats,
} from "./api/seatLock";

export { ForbiddenError, PriceMismatchError } from "./api/errors";
