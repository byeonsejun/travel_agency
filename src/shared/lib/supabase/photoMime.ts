import { env } from "@/shared/lib/env";

// 리뷰 사진 후기 — 순수 MIME·path 헬퍼.
//
// **client-safe**: `import "server-only"` 없음. 클라이언트 폼이 파일 선택 직후
// MIME 검사·미리보기 path 계산 등에 사용. server-side 가드(`storage.ts`)와 동일
// 상수·로직을 공유해 client/server drift를 0으로 유지하는 단일 진실의 원천.
//
// MIME whitelist는 보안 + UX 양면의 게이트:
//   - 보안: HEIC·SVG·임의 binary 차단 → 브라우저 호환 + XSS 폴리글랏 회피.
//   - UX: PDP에서 next/image 호환 포맷만 허용해 사후 변환 비용 0.
// gif/avif는 의도적 제외 — 애니메이션 사진 후기는 본 plan 범위 밖.

export const REVIEW_PHOTO_BUCKET = "product-images";

export const ALLOWED_REVIEW_PHOTO_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AllowedReviewPhotoMime = (typeof ALLOWED_REVIEW_PHOTO_MIMES)[number];

export function isAllowedReviewPhotoMime(
  mime: string,
): mime is AllowedReviewPhotoMime {
  return (ALLOWED_REVIEW_PHOTO_MIMES as readonly string[]).includes(mime);
}

const MIME_TO_EXT: Record<AllowedReviewPhotoMime, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function mimeToExt(
  mime: AllowedReviewPhotoMime,
): "jpg" | "png" | "webp" {
  return MIME_TO_EXT[mime];
}

export function buildReviewPhotoPath(
  reviewId: string,
  idx: number,
  mime: AllowedReviewPhotoMime,
): string {
  return `review-photos/${reviewId}/${idx}.${mimeToExt(mime)}`;
}

// PDP·라이트박스·admin 이 공유하는 client-safe public URL 빌더.
// Supabase public object URL 은 결정적 문자열이라 SDK(server-only) 불필요.
// server-only 인 storage.ts 의 getReviewPhotoPublicUrl 과 동일 결과를 내되,
// 클라이언트 컴포넌트에서도 import 가능 (drift 0).
export function reviewPhotoPublicUrl(path: string): string {
  const base = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/${REVIEW_PHOTO_BUCKET}/${path}`;
}
