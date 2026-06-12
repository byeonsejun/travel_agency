import { cacheTag, cacheLife } from "next/cache";
import { db } from "@/shared/lib/db";
import { computeRemainingSeats } from "./remainingSeats";
import type {
  DepartureSummary,
  DepartureCheckoutInfo,
  DepartureLiveSeat,
  AdminDepartureRow,
} from "../model/types";

// 좌석 잔여 정보는 booking 생성/취소로 즉시 무효화되어야 한다 — features 레이어가
// revalidateTag(tagDeparturesByProduct(productId))로 호출.
export const tagDeparturesByProduct = (productId: string) =>
  `product:${productId}:departures`;

/**
 * 폴링용 uncached 쿼리 — 매 호출 신선한 좌석 정보.
 *
 * 의도적으로 unstable_cache를 사용하지 않는다. 폴링은 "캐시 무효화 신호를
 * 못 받은 클라이언트가 직접 신선도를 확인"하기 위한 안전망인데, 폴링조차
 * 캐시 hit이면 화면 갱신이 캐시 TTL에 묶여 의미가 사라진다.
 *
 * 페이로드도 동적 필드(id/status/remainingSeats/capacity)로 압축 — 매 20초
 * 호출에도 트래픽 영향 최소화.
 */
export async function listDepartureSeats(
  productId: string
): Promise<DepartureLiveSeat[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows = await db.departure.findMany({
    where: {
      productId,
      departureDate: { gte: today },
      status: { not: "CANCELED" },
    },
    select: {
      id: true,
      status: true,
      capacity: true,
      bookedSeats: true,
    },
    orderBy: { departureDate: "asc" },
  });

  return rows.map((d) => ({
    id: d.id,
    status: d.status,
    capacity: d.capacity,
    remainingSeats: computeRemainingSeats(d.capacity, d.bookedSeats),
  }));
}

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

// use cache + per-product 태그: PDP는 ISR-style로 1시간 TTL, 좌석 변경 시
// revalidateTag로 즉각 무효화. 캐시 hit 시 DB query 0회 → 트래픽 부하 압축.
// productId 인자가 자동 캐시 키.
export async function getDeparturesByProduct(
  productId: string
): Promise<DepartureSummary[]> {
  "use cache";
  cacheTag(tagDeparturesByProduct(productId));
  cacheLife({ revalidate: 3600 });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const departures = await db.departure.findMany({
    where: {
      productId,
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
}

// admin 목록 — 미래/과거/CANCELED 전부, 최신 출발일 순. 캐시하지 않음(운영 즉시성).
export async function listAdminDepartures(
  productId: string,
): Promise<AdminDepartureRow[]> {
  const rows = await db.departure.findMany({
    where: { productId },
    orderBy: { departureDate: "desc" },
  });
  return rows.map((d) => ({
    ...d,
    remainingSeats: computeRemainingSeats(d.capacity, d.bookedSeats),
  }));
}

// admin 편집 단건 — 전이 가드 표시(bookedSeats)·폼 초기값.
export async function getAdminDepartureById(
  departureId: string,
): Promise<AdminDepartureRow | null> {
  const d = await db.departure.findUnique({ where: { id: departureId } });
  if (!d) return null;
  return { ...d, remainingSeats: computeRemainingSeats(d.capacity, d.bookedSeats) };
}
