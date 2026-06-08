/**
 * 위약금 tier 도메인 — 순수. 외부 IO 0. now 주입으로 테스트 결정성 보장.
 * (기존 entities/payment/model/penaltyPolicy.ts에서 이전, tiers 주입식으로 일반화.)
 */
import { z } from "zod";

export const DEFAULT_POLICY_KEY = "standard_overseas";

export interface PenaltyTier {
  minDaysBefore: number;
  rate: number;
}

/** 시스템 기본 폴백 tiers (국외여행 표준약관). JSON-safe: 마지막 행 minDaysBefore=-99999(catch-all). */
export const OVERSEAS_PENALTY_TIERS: PenaltyTier[] = [
  { minDaysBefore: 30, rate: 0.0 },
  { minDaysBefore: 20, rate: 0.1 },
  { minDaysBefore: 10, rate: 0.15 },
  { minDaysBefore: 8, rate: 0.2 },
  { minDaysBefore: 1, rate: 0.3 },
  { minDaysBefore: -99999, rate: 0.5 },
];

export const PenaltyTierSchema = z.object({
  minDaysBefore: z.number().int(),
  rate: z.number().min(0).max(1), // D4: 0~100% 허용
});

/** 최소 1행 + minDaysBefore 엄격 내림차순. (find가 내림차순 첫 매칭에 의존) */
export const PenaltyTiersSchema = z
  .array(PenaltyTierSchema)
  .min(1)
  .superRefine((tiers, ctx) => {
    for (let i = 1; i < tiers.length; i++) {
      if (tiers[i].minDaysBefore >= tiers[i - 1].minDaysBefore) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `minDaysBefore must be strictly descending (index ${i})`,
        });
      }
    }
  });

export function resolvePenaltyPolicyKey(
  productKey: string | null,
  departureKey: string | null,
): string {
  return departureKey ?? productKey ?? DEFAULT_POLICY_KEY;
}

export interface PenaltyInput {
  baseAmount: number;
  departureDate: Date;
  now: Date;
  tiers: PenaltyTier[];
}
export interface PenaltyResult {
  daysBefore: number;
  rate: number;
  penaltyAmount: number;
  refundAmount: number;
}

const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;

function daysUntil(departureDate: Date, now: Date): number {
  const departKstMidnightUtcMs = departureDate.getTime() - KST_OFFSET_MS;
  return Math.ceil((departKstMidnightUtcMs - now.getTime()) / DAY_MS);
}

export function computePenalty(input: PenaltyInput): PenaltyResult {
  const { baseAmount, departureDate, now, tiers } = input;
  const daysBefore = daysUntil(departureDate, now);
  const tier = tiers.find((t) => daysBefore >= t.minDaysBefore) ?? tiers[tiers.length - 1];
  const penaltyAmount = Math.floor(baseAmount * tier.rate);
  return { daysBefore, rate: tier.rate, penaltyAmount, refundAmount: baseAmount - penaltyAmount };
}
