export { ReviewInputSchema } from "./model/validation";
export type { ReviewInput } from "./model/validation";

export {
  assertReviewTransition,
  InvalidReviewTransitionError,
  ALLOWED_REVIEW_TRANSITIONS,
} from "./model/transitions";
export {
  normalizeRatingDistribution,
  type RatingDistribution,
} from "./model/ratingDistribution";

export type {
  ReviewListItem,
  ReviewListPage,
  ReviewStats,
  ReviewWithPhotos,
  AdminReviewListItem,
  AdminReviewListPage,
  AdminReviewDetail,
} from "./model/types";

export {
  getProductReviewStats,
  getReviewByBooking,
  getReviewedBookingIds,
  listReviewsByProduct,
  getReviewRatingDistribution,
  listReviewsForAdmin,
  getReviewForAdmin,
} from "./api/queries";

export { setReviewStatus } from "./api/mutations";
