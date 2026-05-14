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

// 민감정보(travelers 등) 제외한 Booking 기본 필드
export type SafeBooking = Pick<
  Booking,
  | "id"
  | "userId"
  | "departureId"
  | "adultCount"
  | "childCount"
  | "infantCount"
  | "totalPrice"
  | "status"
  | "notes"
  | "createdAt"
  | "updatedAt"
  | "canceledAt"
  | "cancelReason"
>;

// 마이페이지 상세: traveler·payments·events 포함
export type BookingDetail = Booking & {
  travelers: Traveler[];
  terms: BookingTerms[];
  payments: Payment[];
  events: BookingEvent[];
  departure: { departureDate: Date; returnDate: Date; product: { title: string } };
};

// 마이페이지 목록: 출발 정보(제목·출발일) 포함
export type BookingListItem = Pick<
  Booking,
  "id" | "status" | "totalPrice" | "adultCount" | "childCount" | "infantCount" | "createdAt" | "canceledAt"
> & {
  departure: { departureDate: Date; product: { title: string } };
};

// 취소 가능한 상태 타입
export type CancelableBookingStatus =
  | "RECEIVED"
  | "AWAITING_GROUP"
  | "DEPARTURE_CONFIRMED"
  | "PAID";
