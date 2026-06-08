import "server-only";
import { db } from "@/shared/lib/db";
import { logger } from "@/shared/lib/observability";
import { OVERSEAS_PENALTY_TIERS, PenaltyTiersSchema, type PenaltyTier } from "../model/tiers";

/** tiers JSON을 검증·파싱. 실패 시 시스템 기본 상수로 graceful 폴백. */
function parseTiers(raw: unknown): PenaltyTier[] {
  const parsed = PenaltyTiersSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn("penalty-policy.tiers.parse_failed", {
      error: parsed.error.message,
    });
    return OVERSEAS_PENALTY_TIERS;
  }
  return parsed.data;
}

/** key의 활성 버전 tiers + version. 없으면 시스템 기본 상수(version 0). */
export async function getActivePenaltyTiers(
  key: string,
): Promise<{ version: number; tiers: PenaltyTier[] }> {
  const row = await db.penaltyPolicy.findFirst({
    where: { key, isActive: true },
    select: { version: true, tiers: true },
  });
  if (!row) return { version: 0, tiers: OVERSEAS_PENALTY_TIERS };
  return { version: row.version, tiers: parseTiers(row.tiers) };
}

/** 예약 스냅샷 (key, version)으로 정확한 tiers 복원. legacy(null) → 시스템 기본. */
export async function getTiersBySnapshot(
  key: string | null,
  version: number | null,
): Promise<PenaltyTier[]> {
  if (!key || version == null || version === 0) return OVERSEAS_PENALTY_TIERS;
  const row = await db.penaltyPolicy.findFirst({
    where: { key, version },
    select: { tiers: true },
  });
  return row ? parseTiers(row.tiers) : OVERSEAS_PENALTY_TIERS;
}

/** admin 목록 — key별 활성 버전. */
export async function getActivePenaltyPolicies() {
  return db.penaltyPolicy.findMany({
    where: { isActive: true },
    orderBy: { key: "asc" },
    select: { id: true, key: true, version: true, name: true, tiers: true, createdAt: true },
  });
}
