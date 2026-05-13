import { db } from "@/shared/lib/db";
import { computeRemainingSeats } from "./remainingSeats";
import type { DepartureSummary } from "../model/types";

export async function getDeparturesByProduct(
  productId: string
): Promise<DepartureSummary[]> {
  // Get today's date at midnight (00:00:00)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const departures = await db.departure.findMany({
    where: {
      productId,
      departureDate: {
        gte: today,
      },
      status: {
        not: "CANCELED",
      },
    },
    select: {
      id: true,
      departureDate: true,
      returnDate: true,
      priceAdult: true,
      priceChild: true,
      capacity: true,
      bookedSeats: true,
      minPax: true,
      status: true,
    },
    orderBy: {
      departureDate: "asc",
    },
  });

  // Apply computeRemainingSeats to each departure
  return departures.map((departure) => ({
    ...departure,
    remainingSeats: computeRemainingSeats(
      departure.capacity,
      departure.bookedSeats
    ),
  }));
}
