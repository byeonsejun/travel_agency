"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { auth } from "@/features/auth/server/auth";
import {
  tagProductDetail,
  TAG_PRODUCTS_FEATURED,
  TAG_PRODUCTS_LIST,
  TAG_DESTINATIONS_LIST,
} from "@/entities/product";
import { db } from "@/shared/lib/db";
import { enqueueProductEmbeddingJob } from "@/shared/lib/embedding-job/enqueue";
import {
  productInputSchema,
  updateProductInputSchema,
  productIdSchema,
} from "../model/schemas";
import type { ProductInput, UpdateProductInput, ProductIdInput } from "../model/schemas";

// ── 반환 타입 — discriminated union ──────────────────────────────

export type CreateProductState =
  | { type: "success"; productId: string }
  | { type: "error"; message: string; fieldErrors?: Record<string, string[]> };

export type UpdateProductState =
  | { type: "success"; productId: string }
  | { type: "error"; message: string; fieldErrors?: Record<string, string[]> };

export type PublishProductState =
  | { type: "success"; productId: string }
  | { type: "error"; message: string };

export type ArchiveProductState =
  | { type: "success"; productId: string }
  | { type: "error"; message: string };

// ── 3중 권한 가드 helper ──────────────────────────────────────────

/**
 * Server Action 3차 가드 — 1차(middleware), 2차(admin layout) 뒤의 마지막 방어선.
 * 세션 없음 → { ok: false, error } / CUSTOMER → { ok: false, error }
 * ADMIN → { ok: true, adminId }
 */
async function requireAdminSession(): Promise<
  | { ok: true; adminId: string }
  | { ok: false; error: { type: "error"; message: string } }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      ok: false,
      error: { type: "error", message: "관리자 로그인이 필요합니다" },
    };
  }
  if (session.user.role !== "ADMIN") {
    return {
      ok: false,
      error: { type: "error", message: "관리자 권한이 필요합니다" },
    };
  }
  return { ok: true, adminId: session.user.id };
}

// ── 캐시 무효화 helper ────────────────────────────────────────────

function invalidateProductCaches(productId: string) {
  revalidateTag(tagProductDetail(productId));
  revalidateTag(TAG_PRODUCTS_LIST);
  revalidateTag(TAG_DESTINATIONS_LIST);
  revalidateTag(TAG_PRODUCTS_FEATURED);
}

// ══════════════════════════════════════════════════════════════════
// createProductAction
// ══════════════════════════════════════════════════════════════════

/**
 * 상품 신규 등록 Server Action.
 *
 * 보안: 3중 가드(middleware → admin layout → 본 action)
 * 원자성: Product + 자식(tags/inclusions/itineraryDays/stops) + EmbeddingJob 단일 $transaction
 * 캐시: revalidateTag×4 — ADR-0020 무효화 컨트랙트 준수
 */
export async function createProductAction(
  _prev: CreateProductState | null,
  input: ProductInput,
): Promise<CreateProductState> {
  // 1. ADMIN 가드
  const guard = await requireAdminSession();
  if (!guard.ok) return guard.error;
  const { adminId } = guard;

  // 2. Zod 검증
  const parsed = productInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return {
      type: "error",
      message: parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요",
      fieldErrors,
    };
  }
  const data = parsed.data;

  // 3. $transaction — Product create + 자식 + EmbeddingJob enqueue
  let productId: string;
  try {
    const product = await db.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          title: data.title,
          summary: data.summary,
          destination: data.destination,
          destinationCode: data.destinationCode ?? null,
          durationNights: data.durationNights,
          durationDays: data.durationDays,
          heroImageUrl: data.heroImageUrl ?? null,
          basePriceAdult: data.basePriceAdult,
          status: data.status,
          tags: {
            create: data.tags.map((tag) => ({ tag })),
          },
          inclusions: {
            create: data.inclusions.map((inc) => ({
              kind: inc.kind,
              label: inc.label,
              note: inc.note ?? null,
            })),
          },
          itineraryDays: {
            create: data.itineraryDays.map((day) => ({
              dayNumber: day.dayNumber,
              title: day.title,
              accommodation: day.accommodation ?? null,
              meals: day.meals,
              stops: {
                create: day.stops.map((stop) => ({
                  order: stop.order,
                  time: stop.time ?? null,
                  place: stop.place,
                  description: stop.description ?? null,
                })),
              },
            })),
          },
        },
        select: { id: true },
      });

      await enqueueProductEmbeddingJob(tx, created.id, `admin:${adminId}`);

      return created;
    });

    productId = product.id;
  } catch {
    return { type: "error", message: "상품 등록에 실패했습니다. 잠시 후 다시 시도해 주세요" };
  }

  // 4. 캐시 무효화
  invalidateProductCaches(productId);
  revalidatePath("/admin/products");

  return { type: "success", productId };
}

// ══════════════════════════════════════════════════════════════════
// updateProductAction
// ══════════════════════════════════════════════════════════════════

/**
 * 상품 수정 Server Action.
 *
 * 중첩 itinerary/tags/inclusions: delete-then-create 패턴 (ADR에 박제된 단순 전략)
 * 원자성: deleteMany + createMany + product.update + enqueue 단일 $transaction
 */
export async function updateProductAction(
  _prev: UpdateProductState | null,
  input: UpdateProductInput,
): Promise<UpdateProductState> {
  // 1. ADMIN 가드
  const guard = await requireAdminSession();
  if (!guard.ok) return guard.error;
  const { adminId } = guard;

  // 2. Zod 검증
  const parsed = updateProductInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return {
      type: "error",
      message: parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요",
      fieldErrors,
    };
  }
  const { productId, ...data } = parsed.data;

  // 3. 상품 존재 여부 확인
  const existing = await db.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!existing) {
    return { type: "error", message: "상품을 찾을 수 없습니다" };
  }

  // 4. $transaction — delete-then-create + product.update + enqueue
  try {
    await db.$transaction(async (tx) => {
      // 중첩 관계 삭제 (stops → days → tags → inclusions 순)
      await tx.itineraryStop.deleteMany({
        where: { day: { productId } },
      });
      await tx.itineraryDay.deleteMany({ where: { productId } });
      await tx.productTag.deleteMany({ where: { productId } });
      await tx.inclusion.deleteMany({ where: { productId } });

      // itineraryDays + stops 재생성
      await tx.itineraryDay.createMany({
        data: data.itineraryDays.map((day) => ({
          productId,
          dayNumber: day.dayNumber,
          title: day.title,
          accommodation: day.accommodation ?? null,
          meals: day.meals,
        })),
      });

      // stops 재생성 — day id를 조회 후 매핑
      const createdDays = await tx.itineraryDay.findMany({
        where: { productId },
        select: { id: true, dayNumber: true },
        orderBy: { dayNumber: "asc" },
      });
      const dayIdByNumber = new Map(
        createdDays.map((d) => [d.dayNumber, d.id]),
      );

      for (const day of data.itineraryDays) {
        if (day.stops.length === 0) continue;
        const itineraryDayId = dayIdByNumber.get(day.dayNumber);
        if (!itineraryDayId) continue;

        await tx.itineraryStop.createMany({
          data: day.stops.map((stop) => ({
            itineraryDayId,
            order: stop.order,
            time: stop.time ?? null,
            place: stop.place,
            description: stop.description ?? null,
          })),
        });
      }

      // tags 재생성
      if (data.tags.length > 0) {
        await tx.productTag.createMany({
          data: data.tags.map((tag) => ({ productId, tag })),
        });
      }

      // inclusions 재생성
      if (data.inclusions.length > 0) {
        await tx.inclusion.createMany({
          data: data.inclusions.map((inc) => ({
            productId,
            kind: inc.kind,
            label: inc.label,
            note: inc.note ?? null,
          })),
        });
      }

      // 상품 메타 업데이트
      await tx.product.update({
        where: { id: productId },
        data: {
          title: data.title,
          summary: data.summary,
          destination: data.destination,
          destinationCode: data.destinationCode ?? null,
          durationNights: data.durationNights,
          durationDays: data.durationDays,
          heroImageUrl: data.heroImageUrl ?? null,
          basePriceAdult: data.basePriceAdult,
          status: data.status,
        },
      });

      await enqueueProductEmbeddingJob(tx, productId, `admin:${adminId}`);
    });
  } catch {
    return { type: "error", message: "상품 수정에 실패했습니다. 잠시 후 다시 시도해 주세요" };
  }

  // 5. 캐시 무효화
  invalidateProductCaches(productId);
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}/edit`);

  return { type: "success", productId };
}

// ══════════════════════════════════════════════════════════════════
// publishProductAction
// ══════════════════════════════════════════════════════════════════

/**
 * 상품 게시 Server Action — DRAFT → PUBLISHED 전이.
 *
 * 임베딩 재색인 트리거: publish 시 콘텐츠가 검색 노출되므로 enqueue 필요.
 */
export async function publishProductAction(
  _prev: PublishProductState | null,
  input: ProductIdInput,
): Promise<PublishProductState> {
  // 1. ADMIN 가드
  const guard = await requireAdminSession();
  if (!guard.ok) return guard.error;
  const { adminId } = guard;

  // 2. Zod 검증 — Server Action 입력은 wire 경계라 타입스크립트 타입은 erase됨.
  //    CLAUDE.md §5: Server Action 입력 Zod 검증 누락 금지.
  const parsed = productIdSchema.safeParse(input);
  if (!parsed.success) {
    return {
      type: "error",
      message: parsed.error.issues[0]?.message ?? "올바른 상품 ID를 입력하세요",
    };
  }
  const { productId } = parsed.data;

  // 3. 상품 조회
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { id: true, status: true },
  });
  if (!product) {
    return { type: "error", message: "상품을 찾을 수 없습니다" };
  }

  // 3. 상태 전이 검증 — DRAFT만 publish 가능
  if (product.status === "PUBLISHED") {
    return { type: "error", message: "이미 게시된 상품입니다" };
  }
  if (product.status !== "DRAFT") {
    return { type: "error", message: "현재 상태에서는 게시할 수 없습니다" };
  }

  // 4. $transaction — status 변경 + enqueue
  try {
    await db.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: { status: "PUBLISHED" },
      });
      await enqueueProductEmbeddingJob(tx, productId, `admin:${adminId}`);
    });
  } catch {
    return { type: "error", message: "상품 게시에 실패했습니다. 잠시 후 다시 시도해 주세요" };
  }

  // 5. 캐시 무효화
  invalidateProductCaches(productId);
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}/edit`);

  return { type: "success", productId };
}

// ══════════════════════════════════════════════════════════════════
// archiveProductAction
// ══════════════════════════════════════════════════════════════════

/**
 * 상품 보관 Server Action — PUBLISHED → CLOSED 전이.
 *
 * 임베딩 재색인 없음: CLOSED 상품은 검색 노출이 차단되므로 기존 임베딩 유지.
 */
export async function archiveProductAction(
  _prev: ArchiveProductState | null,
  input: ProductIdInput,
): Promise<ArchiveProductState> {
  // 1. ADMIN 가드
  const guard = await requireAdminSession();
  if (!guard.ok) return guard.error;

  // 2. Zod 검증 (CLAUDE.md §5)
  const parsed = productIdSchema.safeParse(input);
  if (!parsed.success) {
    return {
      type: "error",
      message: parsed.error.issues[0]?.message ?? "올바른 상품 ID를 입력하세요",
    };
  }
  const { productId } = parsed.data;

  // 3. 상품 조회
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { id: true, status: true },
  });
  if (!product) {
    return { type: "error", message: "상품을 찾을 수 없습니다" };
  }

  // 4. 상태 전이 검증 — PUBLISHED만 archive 가능
  if (product.status !== "PUBLISHED") {
    return { type: "error", message: "현재 상태에서는 보관할 수 없습니다" };
  }

  // 5. status 변경 (enqueue 없음 — CLOSED 상품은 검색 노출 불필요)
  try {
    await db.product.update({
      where: { id: productId },
      data: { status: "CLOSED" },
    });
  } catch {
    return { type: "error", message: "상품 보관에 실패했습니다. 잠시 후 다시 시도해 주세요" };
  }

  // 6. 캐시 무효화
  invalidateProductCaches(productId);
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}/edit`);

  return { type: "success", productId };
}
