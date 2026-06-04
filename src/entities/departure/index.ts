export type {
  DepartureWithAvailability,
  DepartureCalendarItem,
  DepartureStatus,
  DepartureSummary,
  DepartureCheckoutInfo,
  DepartureLiveSeat,
  AdminDepartureRow,
} from "./model/types";

export {
  DEPARTURE_STATUS_LABEL,
  ALMOST_FULL_THRESHOLD,
  DEPARTURE_BADGE_THRESHOLD,
} from "./model/constants";

export { departureSchema } from "./model/schema";
export type { DepartureFormData } from "./model/schema";

export {
  assertDepartureTransition,
  allowedNextStatuses,
  requiresEmptySeats,
  ALLOWED_DEPARTURE_TRANSITIONS,
  InvalidDepartureTransitionError,
} from "./model/transitions";

export {
  createDeparture,
  updateDeparture,
  transitionDepartureStatus,
  CapacityBelowBookedError,
  DepartureDateConflictError,
  DepartureHasBookingsError,
  StaleDepartureStatusError,
  DepartureNotFoundError,
} from "./api/mutations";

export {
  getDeparturesByProduct,
  getDepartureById,
  listDepartureSeats,
  tagDeparturesByProduct,
  listAdminDepartures,
  getAdminDepartureById,
} from "./api/queries";
export { computeRemainingSeats } from "./api/remainingSeats";

export { DepartureList } from "./ui/DepartureList";
