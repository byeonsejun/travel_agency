import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/shared/lib/db";
import { PenaltyTiersSchema, type PenaltyTier } from "../model/tiers";

export interface CreatePenaltyPolicyVersionInput {
  key: string;
  name: string;
  tiers: PenaltyTier[];
  actor: string;
}

/** 새 정책 버전 생성: 이전 활성 버전 isActive=false, version+1 새 행 isActive=true (단일 Tx). */
export async function createPenaltyPolicyVersion(
  input: CreatePenaltyPolicyVersionInput,
): Promise<{ id: string; key: string; version: number }> {
  const tiers = PenaltyTiersSchema.parse(input.tiers); // 불변식 강제
  return db.$transaction(async (tx) => {
    const latest = await tx.penaltyPolicy.findFirst({
      where: { key: input.key },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;
    await tx.penaltyPolicy.updateMany({
      where: { key: input.key, isActive: true },
      data: { isActive: false },
    });
    return tx.penaltyPolicy.create({
      data: {
        key: input.key,
        version: nextVersion,
        name: input.name,
        tiers: tiers as unknown as Prisma.InputJsonValue,
        isActive: true,
        createdBy: input.actor,
      },
      select: { id: true, key: true, version: true },
    });
  });
}
