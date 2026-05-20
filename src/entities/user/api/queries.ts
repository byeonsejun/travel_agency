import { auth } from "@/features/auth/server/auth";
import { db } from "@/shared/lib/db";
import type { SafeUser } from "../model/types";
import type { PassportProfile } from "@prisma/client";

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
): Promise<PassportProfile | null> {
  return db.passportProfile.findUnique({ where: { userId } });
}
