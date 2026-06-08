"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/features/auth/server/auth";
import { createPenaltyPolicyVersion } from "@/entities/penalty-policy";
import { SavePenaltyPolicySchema } from "../model/schemas";
import type { SavePenaltyPolicyInput } from "../model/schemas";

export type SavePenaltyPolicyState =
  | { type: "success"; key: string; version: number }
  | { type: "error"; message: string };

/**
 * 관리자 위약금 정책 버전 생성 Server Action.
 *
 * 보안 책임:
 *   1) auth() + role === "ADMIN" 가드 (middleware /admin/* 보호와 belt-and-suspenders)
 *   2) Zod 입력 검증 (tiers 불변식은 PenaltyTiersSchema SSOT 재사용)
 *   3) createPenaltyPolicyVersion 위임 — append-only version flip (단일 Tx)
 *
 * Rate-limit 미적용: 다른 admin 액션(admin-booking-cancel/admin-product)과 동일.
 * admin 면은 ADR-0040 에서 의도적 미적용(YAGNI) — auth 가드 + middleware 가 보호선.
 */
export async function savePenaltyPolicyAction(
  _prev: SavePenaltyPolicyState | null,
  input: SavePenaltyPolicyInput,
): Promise<SavePenaltyPolicyState> {
  // 1. ADMIN role 가드
  const session = await auth();
  if (!session?.user?.id) {
    return { type: "error", message: "관리자 로그인이 필요합니다" };
  }
  if (session.user.role !== "ADMIN") {
    return { type: "error", message: "관리자 권한이 필요합니다" };
  }

  // 2. Zod 검증
  const parsed = SavePenaltyPolicySchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요";
    return { type: "error", message: first };
  }

  // 3. 도메인 위임 — 새 버전 생성 (이전 활성 버전 isActive=false flip)
  let res: { id: string; key: string; version: number };
  try {
    res = await createPenaltyPolicyVersion({
      ...parsed.data,
      actor: `admin:${session.user.id}`,
    });
  } catch {
    return {
      type: "error",
      message: "정책 저장에 실패했습니다. 잠시 후 다시 시도해 주세요",
    };
  }

  // 4. 캐시 무효화 — admin 정책 목록 (force-dynamic 이지만 명시적 무효화로 일관성)
  revalidatePath("/admin/penalty-policies");

  return { type: "success", key: res.key, version: res.version };
}
