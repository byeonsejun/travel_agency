"use server";

import { z } from "zod";

import { auth } from "@/features/auth/server";
import {
  ALLOWED_REVIEW_PHOTO_MIMES,
  createProductHeroSignedUploadUrl,
} from "@/shared/lib/supabase/storage";

const InputSchema = z.object({
  mime: z.enum(ALLOWED_REVIEW_PHOTO_MIMES),
});

export type HeroUploadResult =
  | { ok: true; signedUrl: string; publicUrl: string; path: string; token: string }
  | { ok: false; error: "UNAUTHORIZED" | "INVALID_MIME" | "STORAGE_ERROR" };

export async function getHeroUploadUrl(mime: string): Promise<HeroUploadResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "UNAUTHORIZED" };
  }
  if (session.user.role !== "ADMIN") {
    return { ok: false, error: "UNAUTHORIZED" };
  }

  const parsed = InputSchema.safeParse({ mime });
  if (!parsed.success) {
    return { ok: false, error: "INVALID_MIME" };
  }

  try {
    const result = await createProductHeroSignedUploadUrl(parsed.data.mime);
    return { ok: true, ...result };
  } catch {
    return { ok: false, error: "STORAGE_ERROR" };
  }
}
