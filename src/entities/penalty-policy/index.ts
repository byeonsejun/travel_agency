// ── 순수 도메인 모델 (client-safe) ──
export {
  computePenalty, resolvePenaltyPolicyKey, PenaltyTiersSchema, PenaltyTierSchema,
  OVERSEAS_PENALTY_TIERS, DEFAULT_POLICY_KEY,
} from "./model/tiers";
export type { PenaltyTier, PenaltyInput, PenaltyResult } from "./model/tiers";

// ── 서버 전용 조회 로더 (DB) ──
export { getActivePenaltyTiers, getTiersBySnapshot, getActivePenaltyPolicies } from "./api/queries";

// ── 서버 전용 mutation (DB) ──
export { createPenaltyPolicyVersion } from "./api/mutations";
export type { CreatePenaltyPolicyVersionInput } from "./api/mutations";
