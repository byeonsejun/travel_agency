/**
 * 예약확정 메일 데이터 단일쿼리 조립.
 * 워커가 발송 직전 호출. include로 N+1 차단. booking/payment 부재 시 null.
 */

import { db } from "@/shared/lib/db";
import type { BookingConfirmationEmailProps } from "@/shared/email";

export interface BookingConfirmationEmailData {
  recipientEmail: string;
  props: BookingConfirmationEmailProps;
}

export async function getBookingConfirmationEmailData(
  bookingId: string,
): Promise<BookingConfirmationEmailData | null> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      adultCount: true,
      childCount: true,
      infantCount: true,
      totalPrice: true,
      user: { select: { email: true, name: true } },
      departure: {
        select: {
          departureDate: true,
          product: { select: { title: true } },
        },
      },
      payments: {
        where: { status: "PAID" },
        select: { receiptUrl: true },
        take: 1,
      },
    },
  });

  if (!booking) return null;

  return {
    recipientEmail: booking.user.email,
    props: {
      customerName: booking.user.name ?? "고객",
      bookingId: booking.id,
      productTitle: booking.departure.product.title,
      departureDate: booking.departure.departureDate.toISOString().slice(0, 10),
      travelerCount:
        booking.adultCount + booking.childCount + booking.infantCount,
      totalPrice: booking.totalPrice,
      receiptUrl: booking.payments[0]?.receiptUrl ?? null,
    },
  };
}
