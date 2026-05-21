"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/features/auth/server/auth";
import { db } from "@/shared/lib/db";
import { safeReturnTo } from "@/entities/wishlist";

const ToggleSchema = z.object({
  productId: z.string().min(1),
  returnTo: z.string().min(1),
});

/**
 * 하트 토글 Server Action.
 *
 * - 비로그인: callbackUrl 을 `/api/wishlist/resume?productId=...&returnTo=...`
 *   로 감싸 /login 으로 리다이렉트. 로그인 성공 후 해당 API 라우트가 idempotent
 *   upsert(add-only)로 찜 처리 후 returnTo 로 redirect.
 *   → RSC 페이지에 searchParams 의존을 만들지 않아 PDP/홈 ISR 정책을 보존.
 * - 로그인: 기존 row 있으면 delete, 없으면 create.
 * - revalidatePath(returnTo) 로 같은 페이지 SSR 재실행 → inWishlist props 동기화.
 */
export async function toggleWishlistAction(formData: FormData): Promise<void> {
  const parsed = ToggleSchema.safeParse({
    productId: formData.get("productId"),
    returnTo: formData.get("returnTo"),
  });
  if (!parsed.success) {
    redirect("/");
  }

  const productId = parsed.data.productId;
  const returnTo = safeReturnTo(parsed.data.returnTo);

  const session = await auth();
  if (!session?.user?.id) {
    const resumeUrl = `/api/wishlist/resume?productId=${encodeURIComponent(productId)}&returnTo=${encodeURIComponent(returnTo)}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(resumeUrl)}`);
  }

  const userId = session.user.id;

  const existing = await db.wishlist.findUnique({
    where: { userId_productId: { userId, productId } },
    select: { id: true },
  });

  if (existing) {
    await db.wishlist.delete({ where: { id: existing.id } });
  } else {
    await db.wishlist.create({ data: { userId, productId } });
  }

  revalidatePath(returnTo);
}
