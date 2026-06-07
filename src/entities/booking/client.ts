// booking 슬라이스의 **client-safe 공개 API**.
//
// `index.ts`(기본 배럴)는 `./api/*`(mutations·queries·seatLock 등 server 전용,
// 트랜잭션·Prisma·여권 암호화 `server-only` 모듈)를 함께 re-export 하므로,
// 'use client' 컴포넌트가 그걸 import 하면 server 코드(`node:crypto` 등)가 클라
// 번들로 끌려가 빌드가 깨진다. 클라이언트 컴포넌트는 server 의존이 전혀 없는
// 이 엔트리에서만 가져온다. (server 코드가 필요한 모듈은 계속 `@/entities/booking` 사용.)
//
// 여기서 re-export 하는 모듈은 모두 순수(zod/상수/타입/순수 로직)여야 한다.

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
  isCancelableByUser,
  InvalidTransitionError,
} from "./model/transitions";

export { CreateBookingSchema, TravelerSchema } from "./model/schemas";
export type { CreateBookingInput, TravelerInput } from "./model/schemas";

export { getBookingProgress } from "./model/progress";
export type {
  BookingProgress,
  BookingProgressStepState,
  BookingProgressStepView,
} from "./model/progress";
