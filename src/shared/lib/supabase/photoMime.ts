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
//
// ⚠️ `env`(@/shared/lib/env)를 import하지 않는다 — env.ts 는 로드 시점에
// DATABASE_URL/AUTH_SECRET 등 서버 전용 변수를 parse 하므로, 이 모듈이 client
// 번들에 포함되면 브라우저에서 ZodError 가 난다(client-safe 계약 파괴, ADR-0029).
// NEXT_PUBLIC_ 변수는 Next 가 빌드 타임에 클라이언트 번들로 인라인하므로
// process.env 직접 접근이 유일하고 안전한 경로(CLAUDE.md §5 env.X 규칙의 의도된 예외).
export function reviewPhotoPublicUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/${REVIEW_PHOTO_BUCKET}/${path}`;
}

// 시드 상품 대표 이미지의 결정적 저장 prefix (마이그레이션·재시드 공유).
export const HERO_SEED_PREFIX = "product-hero/seed";

// 홈 테마 벤토 타일 이미지의 저장 prefix (seed/ 와 형제 — 상품 자산과 경로 분리).
export const THEME_IMAGE_PREFIX = "product-hero/themes";

/**
 * 버킷 내부 `<prefix>/<slug>.jpg` 의 env-portable public URL 빌더 (client-safe).
 * env.ts 미사용(client-safe 규칙) — NEXT_PUBLIC_SUPABASE_URL 직접 접근.
 * 로컬/운영이 같은 Supabase 프로젝트라면 동일 URL 로 양쪽에서 해석된다.
 */
export function buildBucketPublicUrl(prefix: string, slug: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/${REVIEW_PHOTO_BUCKET}/${prefix}/${slug}.jpg`;
}

/**
 * 시드 상품 hero 이미지의 public URL. (출력·시그니처 불변 — 기존 호출부 무영향)
 */
export function buildHeroSeedPublicUrl(slug: string): string {
  return buildBucketPublicUrl(HERO_SEED_PREFIX, slug);
}

/**
 * 홈 테마 벤토 타일 이미지의 public URL (product-hero/themes/<slug>.jpg).
 */
export function buildThemeImageUrl(slug: string): string {
  return buildBucketPublicUrl(THEME_IMAGE_PREFIX, slug);
}
