import { unstable_cache } from "next/cache";
import { db } from "@/shared/lib/db";
import { computeRemainingSeats } from "./remainingSeats";
import type { DepartureSummary, DepartureCheckoutInfo } from "../model/types";

// 좌석 잔여 정보는 booking 생성/취소로 즉시 무효화되어야 한다 — features 레이어가
// revalidateTag(tagDeparturesByProduct(productId))로 호출.
export const tagDeparturesByProduct = (productId: string) =>
  `product:${productId}:departures`;

// checkout 페이지(force-dynamic)에서 좌석 차감 직전 가장 신선한 값을 봐야 하므로
// 캐시하지 않는다. 잔여 좌석 race를 줄이기 위함.
export async function getDepartureById(
  id: string
): Promise<DepartureCheckoutInfo | null> {
  const dep = await db.departure.findUnique({
    where: { id },
    select: {
      id: true,
      departureDate: true,
      returnDate: true,
      priceAdult: true,
      priceChild: true,
      priceInfant: true,
      status: true,
      capacity: true,
      bookedSeats: true,
    },
  });
  if (!dep) return null;
  return {
    ...dep,
    remainingSeats: computeRemainingSeats(dep.capacity, dep.bookedSeats),
  };
}

// unstable_cache + per-product 태그: PDP는 ISR-style로 1시간 TTL, 좌석 변경 시
// revalidateTag로 즉각 무효화. 캐시 hit 시 DB query 0회 → 트래픽 부하 압축.
export async function getDeparturesByProduct(
  productId: string
): Promise<DepartureSummary[]> {
  return unstable_cache(
    async (pid: string): Promise<DepartureSummary[]> => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const departures = await db.departure.findMany({
        where: {
          productId: pid,
          departureDate: { gte: today },
          status: { not: "CANCELED" },
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
        orderBy: { departureDate: "asc" },
      });

      return departures.map((departure) => ({
        ...departure,
        remainingSeats: computeRemainingSeats(
          departure.capacity,
          departure.bookedSeats
        ),
      }));
    },
    ["departures-by-product"],
    { revalidate: 3600, tags: [tagDeparturesByProduct(productId)] }
  )(productId);
}
