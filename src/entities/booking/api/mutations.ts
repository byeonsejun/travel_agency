import type { Booking, Prisma } from "@prisma/client";
import { db } from "@/shared/lib/db";
import { CreateBookingSchema } from "../model/schemas";
import type { CreateBookingInput } from "../model/schemas";
import { assertTransition, shouldReturnSeats } from "../model/transitions";
import type { BookingStatus } from "@prisma/client";
import { computeTotalPrice } from "./pricing";
import { reserveSeats, releaseSeats } from "./seatLock";
import { ForbiddenError, PriceMismatchError } from "./errors";
import { emailJobForTransition } from "../model/emailPolicy";
import { enqueueEmailJob } from "@/shared/lib/email-job/enqueue";
import { assignPaxTypes } from "../model/paxAssignment";

export async function createBooking(input: CreateBookingInput): Promise<Booking> {
  // R3-1: 입력 검증
  const data = CreateBookingSchema.parse(input);

  // R6: 가격 서버 재계산 — 클라이언트 입력값 신뢰 금지
  const departure = await db.departure.findUniqueOrThrow({
    where: { id: data.departureId },
    select: {
      priceAdult: true,
      priceChild: true,
      priceInfant: true,
    },
  });
  const totalPrice = computeTotalPrice({
    priceAdult: departure.priceAdult,
    priceChild: departure.priceChild,
    priceInfant: departure.priceInfant,
    adultCount: data.adultCount,
    childCount: data.childCount,
    infantCount: data.infantCount,
  });
  if (totalPrice !== data.expectedTotalPrice) {
    throw new PriceMismatchError(totalPrice, data.expectedTotalPrice);
  }

  // pax 배정 — index를 key로 assignPaxTypes 호출 후 역매핑
  const assignments = assignPaxTypes({
    travelers: data.travelers.map((t, i) => ({ key: String(i), birthDate: t.birthDate })),
    adultCount: data.adultCount,
    childCount: data.childCount,
    infantCount: data.infantCount,
    priceAdult: departure.priceAdult,
    priceChild: departure.priceChild,
    priceInfant: departure.priceInfant,
    totalPrice,
  });
  const assignByIndex = new Map(assignments.map((a) => [a.key, a]));

  // R1: 좌석 차감 + booking + travelers + event를 단일 트랜잭션
  const totalSeats = data.adultCount + data.childCount; // infant는 좌석 미차감
  return db.$transaction(async (tx) => {
    await reserveSeats(tx, data.departureId, totalSeats);

    const booking = await tx.booking.create({
      data: {
        userId: data.userId,
        departureId: data.departureId,
        adultCount: data.adultCount,
        childCount: data.childCount,
        infantCount: data.infantCount,
        totalPrice,
        status: "RECEIVED",
        notes: data.notes,
        travelers: {
          create: data.travelers.map((t, i) => ({
            role: t.role ?? "TRAVELER",
            lastNameEn: t.lastNameEn,
            firstNameEn: t.firstNameEn,
            gender: t.gender,
            birthDate: t.birthDate,
            passportNo: t.passportNo,
            expireDate: t.expireDate,
            phone: t.phone,
            email: t.email,
            paxType: assignByIndex.get(String(i))!.paxType,
            unitPrice: assignByIndex.get(String(i))!.unitPrice,
          })),
        },
        terms: {
          create: data.termKeys.map((key) => ({
            termKey: key,
            termVersion: "1",
          })),
        },
      },
    });

    // R8: BookingEvent append-only
    await tx.bookingEvent.create({
      data: {
        bookingId: booking.id,
        fromState: null,
        toState: "RECEIVED",
        actor: `user:${data.userId}`,
        reason: "booking created",
      },
    });

    return booking;
  });
}

interface TransitionStatusInput {
  bookingId: string;
  to: BookingStatus;
  actor: string;
  reason?: string;
  /** 사가가 좌석을 이미 정밀 환원한 경우 true — terminal 전이의 전체 환원 이중집행 방지. */
  skipSeatReturn?: boolean;
}

/**
 * tx 수용 코어 — 외부 트랜잭션(배치 fan-out 등)에 합류 가능. [ADR-0028]
 * Prisma 인터랙티브 트랜잭션은 중첩 불가이므로, 배치 단일 tx 안에서 booking
 * 전이를 수행하려면 자체 $transaction을 여는 transitionStatus 대신 이 코어를 쓴다.
 */
export async function transitionStatusTx(
  tx: Prisma.TransactionClient,
  { bookingId, to, actor, reason, skipSeatReturn }: TransitionStatusInput
): Promise<Booking> {
  const current = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
  });

  // R5: 화이트리스트 검증 — 직접 할당 금지
  assertTransition(current.status, to);

  // R7: 취소 전이 시 좌석 환원 (보상 트랜잭션). 사가가 정밀 환원했으면 스킵(이중환원 방지).
  if (!skipSeatReturn && shouldReturnSeats(current.status, to)) {
    await releaseSeats(
      tx,
      current.departureId,
      current.adultCount + current.childCount
    );
  }

  const cancelData =
    to === "CANCELED_BY_USER" || to === "CANCELED_BY_AGENCY"
      ? { canceledAt: new Date(), cancelReason: reason ?? null }
      : {};

  const updated = await tx.booking.update({
    where: { id: bookingId },
    data: { status: to, ...cancelData },
  });

  // R8: BookingEvent append
  await tx.bookingEvent.create({
    data: {
      bookingId,
      fromState: current.status,
      toState: to,
      actor,
      reason: reason ?? null,
    },
  });

  // 트랜잭셔널 아웃박스: 거래 종료 메일을 같은 Tx에 원자적으로 적재 (유실 0).
  const emailDescriptor = emailJobForTransition(current.status, to, bookingId);
  if (emailDescriptor) {
    await enqueueEmailJob(tx, { ...emailDescriptor, bookingId });
  }

  return updated;
}

// 자체 트랜잭션 래퍼 — 단건 전이 기존 호출부 동작 불변(DRY).
export async function transitionStatus(
  input: TransitionStatusInput
): Promise<Booking> {
  return db.$transaction((tx) => transitionStatusTx(tx, input));
}

/**
 * 배치 fan-out용 — 미결제 예약을 외부 tx 안에서 즉시 CANCELED_BY_AGENCY 전이.
 * actor는 전체 문자열("admin:<id>")을 그대로 받는다(오케스트레이터가 구성).
 */
export async function cancelBookingByAgencyTx(
  tx: Prisma.TransactionClient,
  { bookingId, actor, reason }: { bookingId: string; actor: string; reason?: string }
): Promise<Booking> {
  return transitionStatusTx(tx, {
    bookingId,
    to: "CANCELED_BY_AGENCY",
    actor,
    reason,
  });
}

interface CancelInput {
  bookingId: string;
  userId: string;
  reason?: string;
}

export async function cancelBookingByUser({
  bookingId,
  userId,
  reason,
}: CancelInput): Promise<Booking> {
  const booking = await db.booking.findUniqueOrThrow({
    where: { id: bookingId },
  });

  // 소유권 검증
  if (booking.userId !== userId) {
    throw new ForbiddenError("본인의 예약만 취소할 수 있습니다");
  }

  return transitionStatus({
    bookingId,
    to: "CANCELED_BY_USER",
    actor: `user:${userId}`,
    reason,
  });
}

interface AgencyCancelInput {
  bookingId: string;
  adminId: string; // 권한 검증은 features 레이어에서 이미 수행됨(R3-3) — actor 기록용
  reason?: string;
}

/**
 * 관리자 직권 예약 취소.
 *
 * 권한 게이트(ADMIN role) 검증은 호출 측(features/admin-booking-cancel)이
 * auth() 직후 수행한다. 이 함수는 검증 통과를 전제로 booking을
 * CANCELED_BY_AGENCY로 전이하고 BookingEvent를 append한다.
 * 좌석 환원은 transitionStatus 내 shouldReturnSeats가 자동 처리.
 */
export async function cancelBookingByAgency({
  bookingId,
  adminId,
  reason,
}: AgencyCancelInput): Promise<Booking> {
  return transitionStatus({
    bookingId,
    to: "CANCELED_BY_AGENCY",
    actor: `admin:${adminId}`,
    reason,
  });
}
