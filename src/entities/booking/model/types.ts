import type {
  Booking,
  BookingStatus,
  Traveler,
  TravelerRole,
  BookingTerms,
  BookingEvent,
  Payment,
  PaymentStatus,
  PaymentMethod,
} from "@prisma/client";

export type {
  BookingStatus,
  TravelerRole,
  PaymentStatus,
  PaymentMethod,
};

// 마이페이지에서 사용하는 전체 예약 정보
export type BookingWithDetails = Booking & {
  travelers: Traveler[];
  terms: BookingTerms[];
  payments: Payment[];
  events: BookingEvent[];
};

// 어드민 예약 목록용
export type BookingListItem = Pick<
  Booking,
  "id" | "adultCount" | "childCount" | "infantCount" | "totalPrice" | "status" | "createdAt"
> & {
  user: { name: string | null; email: string };
  departure: { departureDate: Date; product: { title: string } };
};

// 취소 가능한 상태 타입
export type CancelableBookingStatus =
  | "RECEIVED"
  | "AWAITING_GROUP"
  | "DEPARTURE_CONFIRMED"
  | "PAID";
