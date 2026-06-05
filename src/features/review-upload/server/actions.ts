"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { ReviewInputSchema } from "@/entities/review";
import { auth } from "@/features/auth/server/auth";
import { db } from "@/shared/lib/db";
import {
  ALLOWED_REVIEW_PHOTO_MIMES,
  createReviewPhotoSignedUploadUrl,
} from "@/shared/lib/supabase/storage";
import { withRateLimitAction } from "@/shared/lib/rate-limit";

import { MAX_REVIEW_PHOTOS } from "../model/photoSlots";

// ───────────────────────────────────────────────────────────────────────────
// Input schemas — 클라이언트 신뢰 0. 모든 외부 입력은 본 schema 통과 후에만 사용.
// ───────────────────────────────────────────────────────────────────────────

const PhotoMetaSchema = z.object({
  idx: z.number().int().min(0).max(MAX_REVIEW_PHOTOS - 1),
  mime: z.enum(ALLOWED_REVIEW_PHOTO_MIMES),
});

const SignInputSchema = z.object({
  bookingId: z.string().cuid(),
  photoMetas: z.array(PhotoMetaSchema).max(MAX_REVIEW_PHOTOS),
});

// pendingReviewId 는 server 가 발급한 식별자라 정확한 포맷 제약 대신 길이 범위로
// 가드. UUID(36) / cuid(~25) / nanoid 등 어떤 형식이든 수용.
const SubmitInputSchema = z
  .object({
    pendingReviewId: z.string().min(20).max(64),
    bookingId: z.string().cuid(),
    paths: z
      .array(
        z.object({
          path: z.string().min(1),
          order: z.number().int().min(0).max(MAX_REVIEW_PHOTOS - 1),
          width: z.number().int().positive().optional(),
          height: z.number().int().positive().optional(),
        }),
      )
      .max(MAX_REVIEW_PHOTOS),
  })
  .merge(ReviewInputSchema); // rating + content 재사용 (entities/review canonical)

// ───────────────────────────────────────────────────────────────────────────
// Response types — discriminated union. 클라이언트가 error 분기를 명시적으로 처리.
// ───────────────────────────────────────────────────────────────────────────

export type ReviewActionError =
  | "NOT_OWNER"
  | "NOT_COMPLETED"
  | "ALREADY_REVIEWED"
  | "INVALID"
  | "UNAUTHORIZED"
  | "RATE_LIMITED";

export type SignSlot = {
  idx: number;
  path: string;
  signedUrl: string;
  token: string;
};

export type SignResult =
  | { ok: true; pendingReviewId: string; slots: SignSlot[] }
  | { ok: false; error: ReviewActionError };

export type SubmitResult =
  | { ok: true; reviewId: string; productId: string }
  | { ok: false; error: ReviewActionError };

// ───────────────────────────────────────────────────────────────────────────
// 자격 게이트 — 두 action 이 동일 정책으로 호출. existence/ownership 누설 차단
// 위해 not-found 도 NOT_OWNER 로 일원화. productId 는 submit 의 Review.create
// + revalidatePath 에 쓰이므로 함께 fetch.
// ───────────────────────────────────────────────────────────────────────────

type GateOk = {
  ok: true;
  productId: string;
};
type GateErr = { ok: false; error: Exclude<ReviewActionError, "UNAUTHORIZED" | "INVALID"> };

async function checkReviewGate(
  userId: string,
  bookingId: string,
): Promise<GateOk | GateErr> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      userId: true,
      status: true,
      review: { select: { id: true } },
      departure: { select: { productId: true } },
    },
  });

  if (!booking || booking.userId !== userId) {
    return { ok: false, error: "NOT_OWNER" };
  }
  if (booking.status !== "COMPLETED") {
    return { ok: false, error: "NOT_COMPLETED" };
  }
  if (booking.review) {
    return { ok: false, error: "ALREADY_REVIEWED" };
  }
  return { ok: true, productId: booking.departure.productId };
}

// ───────────────────────────────────────────────────────────────────────────
// Step 1: 사진 업로드용 Presigned URL 발급.
// ───────────────────────────────────────────────────────────────────────────
//
// DB 행은 만들지 않음 — 사용자가 사진 PUT 도중 이탈해도 orphan storage 파일만
// 남고 DB 정합성 손상 0건 (별도 cron 으로 미-finalize 경로 청소: Out of Scope).
//
// photoMetas 비어 있으면 Supabase 호출 없이 pendingReviewId 만 반환 — 사진 없는
// 후기 케이스의 round-trip 최소화.
async function signReviewPhotoUploadsImpl(input: {
  bookingId: string;
  photoMetas: Array<{ idx: number; mime: string }>;
}): Promise<SignResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "UNAUTHORIZED" };
  }
  const userId = session.user.id;

  const parsed = SignInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "INVALID" };
  }
  const { bookingId, photoMetas } = parsed.data;

  // idx 중복 차단 — 같은 슬롯에 두 번 업로드 path 발급되면 마지막이 이전을 덮어쓴다.
  const idxSet = new Set(photoMetas.map((m) => m.idx));
  if (idxSet.size !== photoMetas.length) {
    return { ok: false, error: "INVALID" };
  }

  const gate = await checkReviewGate(userId, bookingId);
  if (!gate.ok) return { ok: false, error: gate.error };

  const pendingReviewId = crypto.randomUUID();

  if (photoMetas.length === 0) {
    return { ok: true, pendingReviewId, slots: [] };
  }

  // 병렬 발급 — 각 URL 은 독립적이라 N개 PUT 라운드트립을 동시 시작.
  const slots = await Promise.all(
    photoMetas.map(async ({ idx, mime }) => {
      const r = await createReviewPhotoSignedUploadUrl(
        pendingReviewId,
        idx,
        mime as (typeof ALLOWED_REVIEW_PHOTO_MIMES)[number],
      );
      return { idx, path: r.path, signedUrl: r.signedUrl, token: r.token };
    }),
  );

  return { ok: true, pendingReviewId, slots };
}

// ───────────────────────────────────────────────────────────────────────────
// Step 2: 사진 PUT 완료 후, Review + ReviewPhoto[] 원자적 생성.
// ───────────────────────────────────────────────────────────────────────────
//
// 가드 3중:
//  1) Zod — 모든 입력의 형식·범위
//  2) checkReviewGate — 소유자 / COMPLETED / 기존 리뷰 부재
//  3) DB unique(bookingId) — 동시 호출 race 시 두 번째 트랜잭션이 P2002 throw →
//     ALREADY_REVIEWED 로 변환 (가드 (2) 와 (3) 사이 윈도우 보강)
//
// path 변조 가드: 클라이언트가 전달한 paths[*].path 가 실제로 본 pendingReviewId
// prefix 인지 확인 — Storage signed URL 자체가 path 별 단일 토큰이라 임의 경로로
// 업로드는 못 하지만, DB 에 거짓 path 를 저장해 타 리뷰 사진을 가리키는 표시
// 위조 공격은 차단해야 한다.
async function submitReviewImpl(input: {
  pendingReviewId: string;
  bookingId: string;
  rating: number;
  content: string;
  paths: Array<{
    path: string;
    order: number;
    width?: number;
    height?: number;
  }>;
}): Promise<SubmitResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "UNAUTHORIZED" };
  }
  const userId = session.user.id;

  const parsed = SubmitInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "INVALID" };
  }
  const { pendingReviewId, bookingId, rating, content, paths } = parsed.data;

  // path 변조 가드 — 모든 path 가 pendingReviewId 디렉터리 하위인지 확인.
  const expectedPrefix = `review-photos/${pendingReviewId}/`;
  if (paths.some((p) => !p.path.startsWith(expectedPrefix))) {
    return { ok: false, error: "INVALID" };
  }

  // order 중복 차단 — DB unique(reviewId, order) 가 있긴 하지만 사전 거부.
  const orderSet = new Set(paths.map((p) => p.order));
  if (orderSet.size !== paths.length) {
    return { ok: false, error: "INVALID" };
  }

  const gate = await checkReviewGate(userId, bookingId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const { productId } = gate;

  try {
    const created = await db.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          id: pendingReviewId,
          bookingId,
          userId,
          productId,
          rating,
          content,
          status: "PUBLISHED",
        },
        select: { id: true },
      });

      if (paths.length > 0) {
        await tx.reviewPhoto.createMany({
          data: paths.map((p) => ({
            reviewId: review.id,
            storagePath: p.path,
            order: p.order,
            width: p.width,
            height: p.height,
          })),
        });
      }

      return review;
    });

    revalidatePath(`/products/${productId}`);
    revalidatePath("/mypage");

    return { ok: true, reviewId: created.id, productId };
  } catch (e) {
    // unique(bookingId) 또는 unique(reviewId, order) 충돌 — 동시 호출 race.
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return { ok: false, error: "ALREADY_REVIEWED" };
    }
    throw e;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Rate-limit 래퍼 — mutation tier (20 req / 1 min, userFirst).
// 인증 여부를 이 레이어에서 알 수 없으므로 userFirst(IP 폴백)로 idStrategy를
// 내린다. 미인증 사용자는 내부 auth() 가드에서 UNAUTHORIZED를 반환.
// ───────────────────────────────────────────────────────────────────────────

export const signReviewPhotoUploads = withRateLimitAction<
  [Parameters<typeof signReviewPhotoUploadsImpl>[0]],
  SignResult
>(
  {
    tier: "mutation",
    resolveUserId: async () => (await auth())?.user?.id ?? null,
    onBlock: (): SignResult => ({ ok: false, error: "RATE_LIMITED" as const }),
  },
  signReviewPhotoUploadsImpl,
);

export const submitReview = withRateLimitAction<
  [Parameters<typeof submitReviewImpl>[0]],
  SubmitResult
>(
  {
    tier: "mutation",
    resolveUserId: async () => (await auth())?.user?.id ?? null,
    onBlock: (): SubmitResult => ({ ok: false, error: "RATE_LIMITED" as const }),
  },
  submitReviewImpl,
);
