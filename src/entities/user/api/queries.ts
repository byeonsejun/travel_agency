import { auth } from "@/features/auth/server/auth";
import { db } from "@/shared/lib/db";
import type { SafeUser, SafePassportProfile } from "../model/types";
import { maskPassportNo } from "../model/mask";
import { decrypt } from "@/shared/lib/crypto";

const SAFE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
  role: true,
} as const;

export async function getCurrentUser(): Promise<SafeUser | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  return db.user.findUnique({
    where: { id: userId },
    select: SAFE_USER_SELECT,
  });
}

export async function getUserById(id: string): Promise<SafeUser | null> {
  return db.user.findUnique({
    where: { id },
    select: SAFE_USER_SELECT,
  });
}

export async function getPassportProfile(
  userId: string
): Promise<SafePassportProfile | null> {
  const row = await db.passportProfile.findUnique({ where: { userId } });
  if (!row) return null;
  return { ...row, passportNo: maskPassportNo(decrypt(row.passportNo)) };
}
