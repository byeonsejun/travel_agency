// 리뷰 사진 업로드 — features 레이어 헬퍼.
//
// shared/lib/supabase/photoMime 의 client-safe pure 헬퍼를 features 컨벤션
// 이름(isAllowedMime, mimeToExt, buildPhotoPath)으로 재노출하고, **이 feature
// 고유의 상수**(MAX_REVIEW_PHOTOS)를 함께 export 한다.
//
// FSD 단방향: features → shared. shared는 본 모듈을 import 하지 않는다.

export {
  ALLOWED_REVIEW_PHOTO_MIMES,
  REVIEW_PHOTO_BUCKET,
  buildReviewPhotoPath as buildPhotoPath,
  isAllowedReviewPhotoMime as isAllowedMime,
  mimeToExt,
  type AllowedReviewPhotoMime,
} from "@/shared/lib/supabase/photoMime";

// 사진 최대 슬롯 수 (PRD §4.2). UI(file picker)·Server Action·Storage 모두
// 동일 상한을 참조하도록 단일 상수로 박제.
export const MAX_REVIEW_PHOTOS = 5;
