import { Prisma, type DepartureStatus } from "@prisma/client";
import { db } from "@/shared/lib/db";
import type { DepartureFormData } from "../model/schema";
import {
  assertDepartureTransition,
  requiresEmptySeats,
} from "../model/transitions";

// ── 도메인 에러 ────────────────────────────────────────────────────

export class CapacityBelowBookedError extends Error {
  constructor(public readonly departureId: string) {
    super(
      `Cannot set capacity below bookedSeats for departure ${departureId}`,
    );
    this.name = "CapacityBelowBookedError";
  }
}

export class DepartureDateConflictError extends Error {
  constructor(public readonly productId: string) {
    super(`Duplicate departureDate for product ${productId}`);
    this.name = "DepartureDateConflictError";
  }
}

export class DepartureHasBookingsError extends Error {
  constructor(
    public readonly departureId: string,
    public readonly bookedSeats: number,
  ) {
    super(
      `Departure ${departureId} has ${bookedSeats} active seats; cannot cancel`,
    );
    this.name = "DepartureHasBookingsError";
  }
}

export class StaleDepartureStatusError extends Error {
  constructor(public readonly departureId: string) {
    super(`Departure ${departureId} status changed concurrently`);
    this.name = "StaleDepartureStatusError";
  }
}

export class DepartureNotFoundError extends Error {
  constructor(public readonly departureId: string) {
    super(`Departure ${departureId} not found`);
    this.name = "DepartureNotFoundError";
  }
}

// ── 내부 헬퍼 ─────────────────────────────────────────────────────

function isP2002(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
  );
}

// ── create ────────────────────────────────────────────────────────
// status=SCHEDULED(default) / bookedSeats=0(default).
// 날짜 unique 충돌(@@unique([productId, departureDate]))은 P2002로 매핑.
export async function createDeparture(
  productId: string,
  data: DepartureFormData,
): Promise<string> {
  try {
    const created = await db.departure.create({
      data: {
        productId,
        departureDate: data.departureDate,
        returnDate: data.returnDate,
        priceAdult: data.priceAdult,
        priceChild: data.priceChild,
        priceInfant: data.priceInfant,
        capacity: data.capacity,
        minPax: data.minPax,
      },
      select: { id: true },
    });
    return created.id;
  } catch (e) {
    if (isP2002(e)) throw new DepartureDateConflictError(productId);
    throw e;
  }
}

// ── update (capacity 축소 race-free CAS, D3) ───────────────────────
// bookedSeats <= newCapacity 리터럴 가드 → updateMany count===0 이면 거부.
// status는 여기서 바꾸지 않는다(전이는 transitionDepartureStatus 전담).
export async function updateDeparture(
  departureId: string,
  data: DepartureFormData,
): Promise<void> {
  try {
    const result = await db.departure.updateMany({
      where: { id: departureId, bookedSeats: { lte: data.capacity } },
      data: {
        departureDate: data.departureDate,
        returnDate: data.returnDate,
        priceAdult: data.priceAdult,
        priceChild: data.priceChild,
        priceInfant: data.priceInfant,
        capacity: data.capacity,
        minPax: data.minPax,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) {
      // edit 페이지가 존재를 보장하므로 count===0 == 현재 예약 > 새 정원.
      throw new CapacityBelowBookedError(departureId);
    }
  } catch (e) {
    if (e instanceof CapacityBelowBookedError) throw e;
    if (isP2002(e)) throw new DepartureDateConflictError(departureId);
    throw e;
  }
}

// ── status 전이 (TOCTOU + 낙관적 동시전이 방어) ────────────────────
// 패턴: findUnique(현재 status) → assertTransition → updateMany(status 가드)
// count===0이면 사유 분기: CANCELED + bookedSeats>0 → DepartureHasBookingsError,
// 그 외(동시 전이) → StaleDepartureStatusError.
export async function transitionDepartureStatus(
  departureId: string,
  to: DepartureStatus,
): Promise<void> {
  const current = await db.departure.findUnique({
    where: { id: departureId },
    select: { status: true, bookedSeats: true },
  });
  if (!current) throw new DepartureNotFoundError(departureId);

  // 화이트리스트 검사 — DB UPDATE 전 친절한 에러 우선.
  assertDepartureTransition(current.status, to);

  const result = await db.departure.updateMany({
    where: {
      id: departureId,
      status: current.status, // 낙관적 가드: 그새 다른 요청이 전이했으면 count 0
      ...(requiresEmptySeats(to) ? { bookedSeats: 0 } : {}), // D1 취소 가드
    },
    data: { status: to, version: { increment: 1 } },
  });

  if (result.count === 0) {
    // 사유 분기: 취소인데 예약 발생 vs 동시 전이.
    const fresh = await db.departure.findUnique({
      where: { id: departureId },
      select: { bookedSeats: true },
    });
    if (requiresEmptySeats(to) && fresh && fresh.bookedSeats > 0) {
      throw new DepartureHasBookingsError(departureId, fresh.bookedSeats);
    }
    throw new StaleDepartureStatusError(departureId);
  }
}
