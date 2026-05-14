import { Prisma } from "@prisma/client";

export class InsufficientCapacityError extends Error {
  constructor(public readonly departureId: string) {
    super(`Departure ${departureId} has insufficient capacity`);
    this.name = "InsufficientCapacityError";
  }
}

// R1: 좌석 차감은 raw SQL CAS — findUnique→검사→update(TOCTOU) 패턴 금지
export async function reserveSeats(
  tx: Prisma.TransactionClient,
  departureId: string,
  totalSeats: number
): Promise<void> {
  const affected = await tx.$executeRaw`
    UPDATE "Departure"
    SET "bookedSeats" = "bookedSeats" + ${totalSeats},
        "version" = "version" + 1,
        "updatedAt" = NOW()
    WHERE id = ${departureId}
      AND status IN ('SCHEDULED', 'CONFIRMED')
      AND capacity >= "bookedSeats" + ${totalSeats}
  `;
  if (affected === 0) {
    throw new InsufficientCapacityError(departureId);
  }
}

export async function releaseSeats(
  tx: Prisma.TransactionClient,
  departureId: string,
  totalSeats: number
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "Departure"
    SET "bookedSeats" = GREATEST("bookedSeats" - ${totalSeats}, 0),
        "version" = "version" + 1,
        "updatedAt" = NOW()
    WHERE id = ${departureId}
  `;
}
