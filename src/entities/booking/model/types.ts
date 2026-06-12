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
  RefundJob,
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

// 취소·환불 내역 명세에 필요한 RefundJob 부분필드 (금액·위약금·상태).
export type BookingRefundJob = Pick<
  RefundJob,
  "amount" | "penaltyAmount" | "kind" | "status" | "reason" | "createdAt"
>;

// 마이페이지 상세: traveler·payments·events·refundJobs 포함
export type BookingDetail = Booking & {
  travelers: Traveler[];
  terms: BookingTerms[];
  payments: Payment[];
  events: BookingEvent[];
  refundJobs: BookingRefundJob[];
  departure: { departureDate: Date; returnDate: Date; product: { title: string } };
};

// 마이페이지 목록: 출발 정보(제목·출발일·귀국일·productId) 포함.
// productId는 상세 페이지로 갈 필요 없이 카드에서 PDP로 되돌아가는 경로용.
export type BookingListItem = Pick<
  Booking,
  "id" | "status" | "totalPrice" | "adultCount" | "childCount" | "infantCount" | "createdAt" | "canceledAt" | "cancelReason"
> & {
  departure: {
    departureDate: Date;
    returnDate: Date;
    product: { id: string; title: string };
  };
};

// 취소 가능한 상태 타입
export type CancelableBookingStatus =
  | "RECEIVED"
  | "AWAITING_GROUP"
  | "DEPARTURE_CONFIRMED"
  | "PAID";
