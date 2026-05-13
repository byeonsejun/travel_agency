export type {
  DepartureWithAvailability,
  DepartureCalendarItem,
  DepartureStatus,
  DepartureSummary,
} from "./model/types";

export {
  DEPARTURE_STATUS_LABEL,
  ALMOST_FULL_THRESHOLD,
  DEPARTURE_BADGE_THRESHOLD,
} from "./model/constants";

export { departureSchema } from "./model/schema";
export type { DepartureFormData } from "./model/schema";

export { getDeparturesByProduct } from "./api/queries";
export { computeRemainingSeats } from "./api/remainingSeats";
