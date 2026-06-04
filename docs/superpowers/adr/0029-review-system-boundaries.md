# ADR-0029: 리뷰 시스템 경계 — client-safe URL 빌더 + 모더레이션 무효화 SSOT 재사용

- **상태**: Accepted
- **결정일**: 2026-06-03
- **영향 범위**: `src/shared/lib/supabase/photoMime.ts`, `src/features/review-feed/**`, `src/features/admin-review-moderation/server/actions.ts`, `src/entities/review/api/mutations.ts`, `src/app/(site)/products/[id]/page.tsx`
- **관련 commit**: `f7bd8e8`(client-safe URL 빌더), `b04e2c1`(모더레이션 액션 + 무효화 계약), `eea82cb`(setReviewStatus 뮤테이션)

## Context (배경)

Phase 4-C는 이미 동작하는 리뷰 읽기/쓰기 위에 ① 어드민 모더레이션(PUBLISHED↔HIDDEN) ② PDP 더보기 client island ③ 별점 분포·라이트박스를 얹는 "완성" 작업이었다. 두 지점에서 **서버/클라이언트(또는 admin/PDP) 경계를 가로지르는 동일 진실을 어떻게 한 벌로 유지할 것인가**가 핵심 설계 문제로 떠올랐다.

1. **사진 public URL.** 기존 `getReviewPhotoPublicUrl`은 `import "server-only"` Supabase SDK 경로에 묶여 있었다. 그러나 PDP 더보기 island(`ReviewCard`, `'use client'`)와 라이트박스는 **클라이언트에서** 동일한 사진 URL을 만들어야 한다. server-only helper를 client에 import하면 빌드가 깨지고, client에 별도 URL 조립 로직을 두면 server와 **drift**(버킷명·경로 규칙이 어긋날 위험)가 발생한다.

2. **모더레이션 후 캐시 일관성.** PDP는 1시간 ISR(`revalidate=3600`)로 prerender된다. admin이 악성 리뷰를 "숨김" 처리해도 무효화 없이는 **최대 1시간 동안 구버전 HTML이 그대로 노출**되는 일관성 사고가 난다. 새 무효화 메커니즘을 발명할 것인가, 기존 것을 재사용할 것인가.

## Decision (결정)

**경계를 가로지르는 진실은 "지도 한 장"으로 모은다 — 양쪽이 각자 구현하지 않고 단일 출처를 본다.**

**(1) client-safe 순수 URL 빌더.** Supabase public object URL이 결정적 문자열(`{base}/storage/v1/object/public/{bucket}/{path}`)이라는 점을 이용해 SDK 없는 순수 함수를 `shared/lib/supabase/photoMime.ts`(`server-only` 아님)에 둔다.

```ts
export function reviewPhotoPublicUrl(path: string): string {
  const base = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/${REVIEW_PHOTO_BUCKET}/${path}`;
}
```
server·client 어느 쪽에서 호출해도 글자 하나 다르지 않은 URL을 낸다. 버킷 상수(`REVIEW_PHOTO_BUCKET`)도 같은 모듈에서 공유 → drift 0.

**(2) 모더레이션 무효화 = submit 액션과 동일 계약 재사용.** `setReviewStatusAction`은 새 캐시 키를 발명하지 않고, 기존 `submitReview`가 쓰던 것과 **같은 `revalidatePath('/products/{productId}')`** 를 호출한다. "어느 PDP를 폐기할지"는 `setReviewStatus` 뮤테이션이 반환한 `productId`가 알려준다.

```ts
const result = await setReviewStatus(reviewId, next); // → { productId } | null
revalidatePath(`/products/${result.productId}`); // submit 액션과 동일 SSOT
revalidatePath("/admin/reviews");
revalidatePath(`/admin/reviews/${reviewId}`);
```
PDP의 리뷰/통계/분포 쿼리는 모두 `status:'PUBLISHED'` 필터 → 재생성 시 HIDDEN은 자동 제외. 별도 캐시 키 조작 불필요.

## Consequences (결과)

**얻은 것:**
- client island·라이트박스·admin 상세가 **server SDK 의존 없이** 동일 사진 URL 생성 — 프론트/백 결합도↓, drift 구조적 0.
- 숨김/복원 양방향이 **단일 무효화 계약**으로 즉시 일관성 수렴. 새 메커니즘 학습·유지 비용 0.
- `productId`를 뮤테이션이 반환하게 한 덕에 무효화 대상이 **정밀 타격**(전체 PDP flush 아님).

**포기한 것 / 미해결:**
- `getReviewPhotoPublicUrl`(server-only)와 `reviewPhotoPublicUrl`(client-safe)가 **공존** — 동일 결과를 내는 함수가 둘. 신규 렌더는 전부 후자를 쓰되, 기존 server 경로 대비 전자는 잔류(즉시 삭제하지 않음). 미래에 server 경로도 순수 빌더로 통일하면 단일화 가능.
- `env.NEXT_PUBLIC_SUPABASE_URL` 미설정 시 빈 prefix로 fallback → 로컬/테스트에선 상대경로 URL. 운영에선 env 필수(상위 가드가 별도로 보장).

## Alternatives Considered (대안 — 가장 중요한 섹션)

### (1)에 대한 대안 A: server-only helper를 client에 그대로 주입
- 기존 `getReviewPhotoPublicUrl`을 client component에서 import.
- **거부:** `import "server-only"` 모듈을 client에서 참조하면 빌드 에러. Supabase SDK를 client 번들에 끌고 들어와 번들 비대.

### (1)에 대한 대안 B: client 쪽에 별도 URL 조립 로직 작성
- client용 URL 빌더를 review-feed feature 내부에 따로 둔다.
- **거부:** 버킷명·경로 규칙이 server와 **두 곳에 중복** → 한쪽만 바뀌면 사일런트 drift(사진 깨짐). "단일 진실" 원칙 위배. 순수 함수를 shared에 한 벌만 두는 것이 정답.

### (2)에 대한 대안 A: 리뷰 전용 새 캐시 태그/키 도입
- `revalidateTag('review-{productId}')` 등 리뷰 전용 무효화 표면 신설.
- **거부:** PDP 리뷰 데이터는 이미 페이지 단위 ISR에 묶여 있어 `revalidatePath`로 충분. 새 태그는 submit·moderation 두 경로가 **서로 다른 무효화 계약**을 갖게 만들어 회귀 위험↑. 동일 SSOT 재사용이 단순·안전.

### (2)에 대한 대안 B: status를 admin 액션에서 직접 할당(가드 우회)
- `db.review.update({ status })`를 액션에서 바로.
- **거부:** 잘못된 전이(예: 동일 상태, 역방향 →REPORTED)를 막을 수 없음. 반드시 `entities` 뮤테이션 내부 `assertReviewTransition`(ADR 본 Phase T2) 통과 후 update. 도메인 규칙은 entities에 박제, 액션은 게이트(auth)만.

## Notes

- 후속: `REPORTED` 신고 진입점은 다음 Phase. enum 값·전이 규칙(`REPORTED→*`)은 보존돼 있어 진입점만 추가하면 됨.
- 모니터링: "숨김이 PDP에 반영 안 됨" 신고가 들어오면 ① `setReviewStatus`의 `productId` 매핑 ② `revalidatePath` 호출 누락을 우선 의심.
- 6개월 뒤 의심 포인트: "URL 빌더가 왜 두 벌?" → 본 ADR Consequences 참조(server-only 잔류는 의도, drift 0은 client-safe 단일 사용으로 보장).
