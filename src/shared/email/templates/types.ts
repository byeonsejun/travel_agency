/** 템플릿은 도메인 객체가 아닌 평문 props만 받는다 (도메인 무지·독립 테스트). */

export interface BookingConfirmationEmailProps {
  customerName: string;
  bookingId: string;
  productTitle: string;
  departureDate: string; // "2026-08-15"
  travelerCount: number;
  totalPrice: number; // 원
  receiptUrl: string | null;
}

export interface RefundCompletedEmailProps {
  customerName: string;
  bookingId: string;
  productTitle: string;
  refundAmount: number; // 원
  paymentMethod: string; // "카드"
}
