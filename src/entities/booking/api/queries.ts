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
  userId: string,
  opts?: { page?: number; pageSize?: number }
): Promise<{ items: BookingListItem[]; total: number }> {
  const pageSize = opts?.pageSize ?? 5;
  const page = Math.max(1, opts?.page ?? 1);
  const skip = (page - 1) * pageSize;

  const [items, total] = await Promise.all([
    db.booking.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: pageSize,
      skip,
      select: {
        id: true,
        status: true,
        totalPrice: true,
        adultCount: true,
        childCount: true,
        infantCount: true,
        createdAt: true,
        canceledAt: true,
        cancelReason: true,
        departure: {
          select: {
            departureDate: true,
            returnDate: true,
            product: { select: { id: true, title: true } },
          },
        },
      },
    }),
    db.booking.count({ where: { userId } }),
  ]);

  return { items, total };
}

export async function getBookingForRetry(
  id: string,
  userId: string
): Promise<{ id: string; departureId: string; departure: { productId: string } } | null> {
  return db.booking.findUnique({
    where: { id, userId },
    select: {
      id: true,
      departureId: true,
      departure: { select: { productId: true } },
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
      refundJobs: {
        select: { amount: true, penaltyAmount: true, kind: true, status: true, reason: true, createdAt: true },
      },
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

// ─── Admin-scope queries ──────────────────────────────────────────
// userId 필터 없이 전체 booking을 조회. 권한 검증은 호출 측(admin 페이지)이
// session.user.role === "ADMIN" 게이트로 보장 (middleware /admin/* 보호 + 페이지 가드).

export type AdminBookingListItem = BookingListItem & {
  user: { id: string; name: string | null; email: string | null };
};

export async function listAllBookings(opts?: {
  limit?: number;
  skip?: number;
}): Promise<{ items: AdminBookingListItem[]; total: number }> {
  const limit = Math.min(opts?.limit ?? 50, 200);
  const skip = opts?.skip ?? 0;
  const [items, total] = await Promise.all([
    db.booking.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
      select: {
        id: true,
        status: true,
        totalPrice: true,
        adultCount: true,
        childCount: true,
        infantCount: true,
        createdAt: true,
        canceledAt: true,
        cancelReason: true,
        departure: {
          select: {
            departureDate: true,
            returnDate: true,
            product: { select: { id: true, title: true } },
          },
        },
        user: { select: { id: true, name: true, email: true } },
      },
    }),
    db.booking.count(),
  ]);
  return { items, total };
}

export async function getAdminBookingDetail(
  id: string
): Promise<(BookingDetail & { user: { id: string; name: string | null; email: string | null } }) | null> {
  return db.booking.findUnique({
    where: { id },
    include: {
      travelers: true,
      terms: true,
      payments: true,
      events: { orderBy: { createdAt: "asc" } },
      refundJobs: {
        select: { amount: true, penaltyAmount: true, kind: true, status: true, reason: true, createdAt: true },
      },
      departure: {
        select: {
          departureDate: true,
          returnDate: true,
          product: { select: { title: true } },
        },
      },
      user: { select: { id: true, name: true, email: true } },
    },
  });
}
