/**
 * 국외여행 표준약관(소비자분쟁해결기준) 기준 시간경과 위약금 정책 — 순수 함수.
 * 외부 IO 0. now를 주입받아 테스트 결정성을 보장한다. (spec §3)
 */

/** 출발일까지 남은 일수(minDaysBefore) 하한 이상이면 해당 rate. 내림차순 첫 매칭. */
export const OVERSEAS_PENALTY_TIERS = [
  { minDaysBefore: 30, rate: 0.0 },
  { minDaysBefore: 20, rate: 0.1 },
  { minDaysBefore: 10, rate: 0.15 },
  { minDaysBefore: 8, rate: 0.2 },
  { minDaysBefore: 1, rate: 0.3 },
  { minDaysBefore: Number.NEGATIVE_INFINITY, rate: 0.5 }, // 당일(D≤0) 포함
] as const;

export interface PenaltyInput {
  /** 위약금 산정 기준액(원 단위 정수) = 결제 금액. */
  baseAmount: number;
  /** 출발일(@db.Date). Prisma 역직렬화 기준 UTC 자정. KST 자정 = UTC 전날 15:00. */
  departureDate: Date;
  /** 취소 통보 시각(주입). */
  now: Date;
}

export interface PenaltyResult {
  daysBefore: number;
  rate: number;
  penaltyAmount: number;
  refundAmount: number;
}

const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000; // UTC+9

/**
 * 출발일 KST 자정까지 남은 일수를 계산한다.
 *
 * Prisma @db.Date는 UTC 자정으로 직렬화되므로, KST 자정은 UTC 전날 15:00이다.
 * now가 당일 정오(noon)처럼 일 경계로부터 떨어진 시각이면 Math.ceil이 올바른 일수를 반환한다.
 *
 * 예: D=N 정오 → (N*DAY - 12h) / DAY = N - 0.5 → ceil = N
 */
function daysUntil(departureDate: Date, now: Date): number {
  // Prisma @db.Date → UTC 자정. KST 자정 = UTC 전날 15:00 = UTC 자정 - 9h.
  const departKstMidnightUtcMs = departureDate.getTime() - KST_OFFSET_MS;
  return Math.ceil((departKstMidnightUtcMs - now.getTime()) / DAY_MS);
}

export function computePenalty(input: PenaltyInput): PenaltyResult {
  const { baseAmount, departureDate, now } = input;
  const daysBefore = daysUntil(departureDate, now);
  const tier =
    OVERSEAS_PENALTY_TIERS.find((t) => daysBefore >= t.minDaysBefore) ??
    OVERSEAS_PENALTY_TIERS[OVERSEAS_PENALTY_TIERS.length - 1];
  const penaltyAmount = Math.floor(baseAmount * tier.rate);
  return {
    daysBefore,
    rate: tier.rate,
    penaltyAmount,
    refundAmount: baseAmount - penaltyAmount,
  };
}
