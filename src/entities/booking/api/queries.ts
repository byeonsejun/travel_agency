import { db } from "@/shared/lib/db";
import type { SafeBooking, BookingDetail, BookingListItem } from "../model/types";

export async function getBookingById(
  id: string,
  userId: string
): Promise<SafeBooking | null> {
  return db.booking.findUnique({
    where: { id, userId },
    select: {
      id: true,
      userId: true,
      departureId: true,
      adultCount: true,
      childCount: true,
      infantCount: true,
      totalPrice: true,
      status: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      canceledAt: true,
      cancelReason: true,
    },
  });
}

export async function listMyBookings(
  userId: string
): Promise<BookingListItem[]> {
  return db.booking.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      totalPrice: true,
      adultCount: true,
      childCount: true,
      infantCount: true,
      createdAt: true,
      canceledAt: true,
      departure: {
        select: {
          departureDate: true,
          product: { select: { title: true } },
        },
      },
    },
  });
}

export async function getBookingDetail(
  id: string,
  userId: string
): Promise<BookingDetail | null> {
  return db.booking.findUnique({
    where: { id, userId },
    include: {
      travelers: true,
      terms: true,
      payments: true,
      events: { orderBy: { createdAt: "asc" } },
      departure: {
        select: {
          departureDate: true,
          returnDate: true,
          product: { select: { title: true } },
        },
      },
    },
  });
}
