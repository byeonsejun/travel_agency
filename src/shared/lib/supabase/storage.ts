// Supabase Storage — 리뷰 사진 후기 server-only wrapper.
//
// 순수 MIME·path 헬퍼는 `./photoMime` 로 분리되어 있다 (client-safe 단일 source).
// 본 모듈은 service-role 자격증명이 필요한 SDK 호출만 담당:
//   - createReviewPhotoSignedUploadUrl: 클라이언트 직접 PUT용 단발 URL 발급
//   - getReviewPhotoPublicUrl: PDP·마이페이지 노출용 영구 URL 조회
//
// 버킷(`product-images`)·MIME whitelist·path 컨벤션은 photoMime.ts 참조.

import "server-only";

import {
  REVIEW_PHOTO_BUCKET,
  buildReviewPhotoPath,
  type AllowedReviewPhotoMime,
} from "./photoMime";
import { createServerSupabase } from "./server";

export {
  REVIEW_PHOTO_BUCKET,
  ALLOWED_REVIEW_PHOTO_MIMES,
  isAllowedReviewPhotoMime,
  mimeToExt,
  buildReviewPhotoPath,
  type AllowedReviewPhotoMime,
} from "./photoMime";

export type CreateSignedUploadResult = {
  path: string;
  signedUrl: string;
  token: string;
};

// 클라이언트가 PUT 으로 직접 파일을 올릴 때 사용하는 단발성 업로드 URL.
// Vercel function payload 4.5MB 우회 + 서버 stream-through 비용 0이 목적.
export async function createReviewPhotoSignedUploadUrl(
  pendingReviewId: string,
  idx: number,
  mime: AllowedReviewPhotoMime,
): Promise<CreateSignedUploadResult> {
  const path = buildReviewPhotoPath(pendingReviewId, idx, mime);
  const supabase = createServerSupabase();
  const { data, error } = await supabase.storage
    .from(REVIEW_PHOTO_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    throw new Error(
      `[supabase] createSignedUploadUrl failed for ${path}: ${
        error?.message ?? "unknown"
      }`,
    );
  }

  return { path: data.path, signedUrl: data.signedUrl, token: data.token };
}

// 업로드 완료 후 PDP·마이페이지에 노출할 때 사용. 버킷이 public read이므로
// 서명 없이 영구 URL 반환. (private 버킷으로 전환 시 getSignedUrl 로 교체)
export function getReviewPhotoPublicUrl(path: string): string {
  const supabase = createServerSupabase();
  const { data } = supabase.storage
    .from(REVIEW_PHOTO_BUCKET)
    .getPublicUrl(path);
  return data.publicUrl;
}
