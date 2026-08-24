"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/features/auth/server";
import { db } from "@/shared/lib/db";
import { passportProfileSchema } from "@/entities/user";
import { withRateLimitAction } from "@/shared/lib/rate-limit";
import { encrypt } from "@/shared/lib/crypto";

export type PassportActionState =
  | { success: true }
  | { success: false; error: string }
  | null;

async function updatePassportProfileImpl(
  _prev: PassportActionState,
  formData: FormData
): Promise<PassportActionState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "로그인이 필요합니다." };
  }

  const raw = {
    lastNameEn: formData.get("lastNameEn"),
    firstNameEn: formData.get("firstNameEn"),
    gender: formData.get("gender"),
    birthDate: formData.get("birthDate"),
    passportNo: formData.get("passportNo"),
    expireDate: formData.get("expireDate"),
    nationality: formData.get("nationality") || "KR",
  };

  const parsed = passportProfileSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { success: false, error: first?.message ?? "입력값을 확인해주세요." };
  }

  // passportNo는 AES-256-GCM으로 암호화하여 저장한다 (lazy 마이그레이션, enc:v1: prefix).
  const data = { ...parsed.data, passportNo: encrypt(parsed.data.passportNo) };
  await db.passportProfile.upsert({
    where: { userId: session.user.id },
    create: { ...data, userId: session.user.id },
    update: data,
  });

  revalidatePath("/mypage");
  return { success: true };
}

// ── Rate-limit 래퍼 ─────────────────────────────────────────────
// mutation tier (20 req / 1 min, userFirst).
export const updatePassportProfile = withRateLimitAction<
  [PassportActionState, FormData],
  PassportActionState
>(
  {
    tier: "mutation",
    resolveUserId: async () => (await auth())?.user?.id ?? null,
    onBlock: (): PassportActionState => ({
      success: false,
      error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
    }),
  },
  updatePassportProfileImpl,
);
