# Phase 4-C — Review System Completion (Design Spec)

> 작성일: 2026-06-02 · 브랜치: `feat/b3-admin-cms` 후속
> 상태: 설계 승인 대기 → 승인 후 `writing-plans`로 플랜 분해

---

## 0. 배경 — "신규"가 아니라 "완성"

리뷰 시스템의 **읽기/쓰기 경로는 이미 구현되어 있다.** 본 Phase는 백지 신규가 아니라 **남은 3개 구멍을 메우는 완성 작업**이다.

| 영역 | 기존 상태 | 본 스펙에서 다루는가 |
|---|---|---|
| PDP 리뷰 노출 (`ReviewStatsBar`/`ReviewList` + ISR `revalidate=3600`) | ✅ 완료 | 부분 — 통계 그래프·라이트박스·더보기로 **확장** |
| 작성 폼 (`features/review-upload`, 2-step presigned, 자격 게이트, 멱등) | ✅ 완료 | 변경 없음 |
| Supabase 사진 스토리지 (`createReviewPhotoSignedUploadUrl` 등) | ✅ 완료 | 변경 없음 (client-safe URL 빌더만 추가) |
| **어드민 모더레이션 (PUBLISHED↔HIDDEN)** | ❌ 전무 | **신규 — 핵심** |
| **PDP 더보기 페이지네이션 (`nextCursor` 소비)** | ⚠️ 쿼리만 존재, UI 미배선 | **신규** |
| 사용자 신고(`REPORTED`) 경로 | ❌ 전무 | **범위 외 — 다음 Phase로 연기** |

### 확정 범위 (사용자 승인)
1. **어드민 모더레이션** — admin 리뷰 목록/상세 + PUBLISHED↔HIDDEN 토글 + **PDP ISR 무효화 계약**
2. **PDP 더보기** — `nextCursor`를 소비하는 client island (끊김 없는 추가 로드)
3. **통계/품질 보강** — 별점 분포 막대그래프 + 다중 사진 라이트박스

`REPORTED` 신고 경로는 본 스펙에서 제외(enum 값은 보존, 진입점 미구현).

---

## 1. 핵심 설계 결정 (요약)

| # | 결정 | 이유 |
|---|---|---|
| D1 | 리뷰 status 전이는 **경량 가드 함수** `assertReviewTransition`로. 풀 state machine 미도입 | 상태 3개·전이 단순(PUBLISHED↔HIDDEN, REPORTED→*). booking 수준 머신은 과설계 |
| D2 | status 변경 시 **`revalidatePath('/products/${productId}')`** 즉시 호출 | PDP는 ISR(`revalidate=3600`). submit 액션과 **동일 무효화 계약** 재사용 — 숨김 즉시 PDP에서 사라짐 |
| D3 | 사진 public URL을 **client-safe 순수 빌더**(`reviewPhotoPublicUrl`)로 통일 | 기존 `getReviewPhotoPublicUrl`은 `server-only`(SDK). 더보기 client island·라이트박스가 동일 URL을 생성하려면 순수 helper 필요. Supabase public URL은 결정적 문자열이라 SDK 불필요 |
| D4 | 더보기 추가 로드는 **Server Action**(`loadMoreReviewsAction`)으로. route handler 미사용 | 기존 `listReviewsByProduct` 재사용 + 타입 안전 직접 호출. 별도 API 표면 불필요 |
| D5 | 라이트박스·사진 그리드는 **`shared/ui`의 도메인 무지 컴포넌트** | PDP 피드와 admin 상세 **양쪽**이 소비. FSD상 features·app 모두 shared를 import 가능 |
| D6 | 별점 분포는 **`groupBy(rating)` 단일 집계 쿼리** + 1~5 키 정규화 | row 페치 0건. 누락 별점도 0으로 채워 UI 분기 최소화 |

---

## 2. 아키텍처 — FSD 레이어별 변경

```
app/(site)/products/[id]/page.tsx   ← ReviewList(widget) 제거, ReviewFeed(feature)로 교체 + RatingDistribution 추가
app/(admin)/admin/reviews/page.tsx        [신규] 모더레이션 목록 (force-dynamic, status 필터)
app/(admin)/admin/reviews/[id]/page.tsx   [신규] 상세 — 사진 그리드 + 토글
app/(admin)/admin/layout.tsx        ← nav "리뷰 관리" 링크 추가

widgets/review-list/
  ui/ReviewStatsBar.tsx             ← 유지 (변경 없음)
  ui/RatingDistribution.tsx         [신규] RSC 별점 분포 막대
  ui/ReviewList.tsx                 ← 폐기(ReviewFeed로 대체). 마이그레이션 노트 §6

features/review-feed/               [신규 feature — PDP 더보기 + 라이트박스 island]
  server/loadMore.ts                  "use server" loadMoreReviewsAction(productId, cursor)
  ui/ReviewFeed.tsx                   "use client" 누적 목록 + 더보기 버튼 + 라이트박스 트리거
  ui/ReviewCard.tsx                   presentational 카드 (RSC·client 공용 가능한 순수 prop 컴포넌트)
  index.ts

features/admin-review-moderation/   [신규 feature — admin 토글]
  model/schemas.ts                    Zod: { reviewId, next: 'PUBLISHED'|'HIDDEN' }
  server/actions.ts                   "use server" setReviewStatusAction (ADMIN 가드 + 무효화)
  ui/ReviewStatusToggle.tsx           "use client" useActionState 토글 버튼
  index.ts

entities/review/
  model/transitions.ts              [신규] assertReviewTransition + ALLOWED_REVIEW_TRANSITIONS (순수, TDD)
  model/ratingDistribution.ts       [신규] normalizeRatingDistribution (순수, TDD)
  api/queries.ts                    ← + getReviewRatingDistribution, + listReviewsForAdmin, + getReviewForAdmin
  api/mutations.ts                  [신규] setReviewStatus(id, next) → { productId }
  index.ts                          ← 신규 export 추가

shared/ui/
  Lightbox.tsx                      [신규] "use client" 모달 이미지 뷰어 (키보드·focus trap·scroll lock·cleanup)
  PhotoGrid.tsx                     [신규] "use client" 썸네일 그리드 → Lightbox 오픈 (images:{id,url,alt}[])

shared/lib/supabase/photoMime.ts    ← + reviewPhotoPublicUrl(path) (client-safe 순수 빌더, TDD)
```

**FSD 단방향 준수**: `app → widgets → features → entities → shared`.
- `ReviewCard`/`Lightbox`/`PhotoGrid`를 **shared 또는 feature 내부**에 두는 이유: features는 widgets를 import할 수 없으므로(역방향), 피드가 쓰는 presentational 컴포넌트를 widget에 둘 수 없다. 라이트박스/그리드는 도메인 무지라 `shared/ui`로, `ReviewCard`는 review-feed feature 내부로 귀속.
- PDP(app)는 widget(`RatingDistribution`)과 feature(`ReviewFeed`)를 **동시에** 조합 — 현재도 `CompareToggleButton`(feature) + `ProductDetail`(widget)을 섞어 쓰는 기존 패턴과 동일.

---

## 3. 컴포넌트별 상세 설계

### 3.1 어드민 모더레이션

**목록 페이지** `app/(admin)/admin/reviews/page.tsx` (RSC, `dynamic = "force-dynamic"`)
- `listReviewsForAdmin({ status?, cursor? })` 호출. `searchParams.status`로 PUBLISHED/HIDDEN/REPORTED/전체 필터 (refund-jobs 페이지의 `FILTER_OPTIONS` 패턴 그대로).
- 각 row: 상품명·작성자(마스킹된 displayName)·별점·status 뱃지·작성일·사진 개수·`[상세]` 링크.
- status 뱃지 색상 맵(PUBLISHED=green, HIDDEN=gray, REPORTED=amber) — 기존 `STATUS_BADGE_COLORS` 컨벤션.

**상세 페이지** `app/(admin)/admin/reviews/[id]/page.tsx` (RSC, force-dynamic)
- `getReviewForAdmin(id)` → 본문·별점·작성자·상품 컨텍스트·**사진 전체**.
- 사진은 `<PhotoGrid images=… />`(shared) 로 **다중 격자 + 클릭 확대** 렌더 (PDP와 동일 컴포넌트 재사용).
- 하단에 `<ReviewStatusToggle reviewId status={current} />`.

**토글 서버 액션** `features/admin-review-moderation/server/actions.ts`
```
setReviewStatusAction(prev, { reviewId, next }):
  1. auth() + role==='ADMIN' 가드          (admin-booking-cancel 패턴 동일)
  2. Zod 검증 (next ∈ {PUBLISHED, HIDDEN})
  3. entities setReviewStatus(reviewId, next)  // 내부에서 assertReviewTransition
        → 반환 productId
  4. 캐시 무효화 계약 (D2):
        revalidatePath(`/products/${productId}`)   // PDP ISR — 숨김 즉시 반영
        revalidatePath('/admin/reviews')
        revalidatePath(`/admin/reviews/${reviewId}`)
  5. 반환 { type:'success', status:next }  (discriminated union)
```
- `assertReviewTransition` 위반 시 `InvalidReviewTransitionError` → `{ type:'error' }`로 변환.
- 멱등: 같은 status로의 토글은 가드에서 no-op 거부 또는 동일 결과 반환(스펙: PUBLISHED→PUBLISHED 거부 = INVALID).

### 3.2 PDP 더보기 (client island)

**서버 액션** `features/review-feed/server/loadMore.ts`
```
loadMoreReviewsAction(productId: string, cursor: string): Promise<ReviewListPage>
  → listReviewsByProduct(productId, { limit:10, cursor })   // PUBLISHED only 그대로
```
- 입력은 Zod 검증(productId cuid, cursor 길이). PUBLISHED 필터는 쿼리에 내장 → admin이 숨긴 리뷰는 더보기로도 안 나옴(일관성).

**클라이언트 island** `features/review-feed/ui/ReviewFeed.tsx` (`'use client'`)
- props: `productId`, `initialItems: ReviewListItem[]`, `initialCursor: string | null` (PDP가 RSC에서 첫 페이지 fetch 후 전달 — Date는 RSC→client 직렬화 지원).
- 상태: `items`(useState, 누적), `cursor`, `isPending`(useTransition).
- "더보기" 클릭 → `startTransition(async ()=> { const page = await loadMoreReviewsAction(productId, cursor); setItems(prev=>[...prev, ...page.items]); setCursor(page.nextCursor); })`.
- `cursor === null`이면 버튼 숨김. 빈 목록이면 `null` 렌더(기존 ReviewList 동작 보존).
- 각 항목은 `<ReviewCard review=… />`. ReviewFeed는 라이트박스 상태를 보유하지 않는다 — 카드 내부의 자기완결형 `PhotoGrid`가 자체적으로 처리(D5, §3.3).

**presentational** `features/review-feed/ui/ReviewCard.tsx`
- 기존 `ReviewList`의 카드 마크업(별점·작성자·본문)을 단일 카드로 추출. 사진은 `<PhotoGrid images=… />`(shared)에 위임 — URL은 `reviewPhotoPublicUrl(path)`(client-safe)로 매핑.

### 3.3 라이트박스 & 별점 분포

**`shared/ui/Lightbox.tsx`** (`'use client'`, 도메인 무지)
- props: `images:{id,url,alt}[]`, `index`, `onClose`, `onIndexChange`.
- 백드롭 + 중앙 확대 이미지, 좌/우 네비 버튼, 인덱스 표시.
- **프론트엔드 영구 수칙 (메모리 누수 차단)**:
  - `useEffect`로 `keydown`(Esc=닫기, ←/→=이동) 리스너 등록 → **cleanup에서 반드시 removeEventListener**.
  - 열림 동안 `document.body.style.overflow='hidden'` → cleanup에서 원복.
  - 첫 마운트 focus 이동 + focus trap(Tab 순환). `aria-modal`, `role="dialog"`.
- 부드러운 확대: Tailwind `transition`/`scale` + `data-state` 또는 간단한 opacity/scale enter. 외부 애니메이션 라이브러리 미도입(YAGNI).

**`shared/ui/PhotoGrid.tsx`** (`'use client'`)
- props: `images:{id,url,alt}[]`. 썸네일 grid(`next/image fill`), 클릭 시 내부 state로 Lightbox 오픈. 자체 완결형(admin 상세에서 콜백 없이 사용).

**`widgets/review-list/ui/RatingDistribution.tsx`** (RSC)
- props: `distribution: Record<1|2|3|4|5, number>`, `total: number`.
- 5→1 역순 막대. 각 별점 비율 = `count/total*100%` 폭. `total===0`이면 `ReviewStatsBar`가 이미 "후기 없음"을 처리하므로 분포는 렌더 생략.
- 데이터: `getReviewRatingDistribution(productId)` → `normalizeRatingDistribution(rows)` (1~5 키 보장).

---

## 4. 데이터 계층 — entities/review

### 4.1 순수 로직 (TDD 우선)
- **`model/transitions.ts`**: `ALLOWED_REVIEW_TRANSITIONS: Record<ReviewStatus, ReviewStatus[]>` + `assertReviewTransition(from,to)`.
  - 허용: `PUBLISHED↔HIDDEN`, `REPORTED→PUBLISHED`, `REPORTED→HIDDEN`. 동일 상태 전이·미허용 전이는 throw.
- **`model/ratingDistribution.ts`**: `normalizeRatingDistribution(rows:{rating:number,_count}[]) → Record<1..5,number>` (누락 별점 0).
- **`shared/lib/supabase/photoMime.ts`**: `reviewPhotoPublicUrl(path)` = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${REVIEW_PHOTO_BUCKET}/${path}`. env 미설정 시 빈 prefix fallback(테스트·로컬). 순수 → 단위 테스트.

### 4.2 쿼리/뮤테이션
- `getReviewRatingDistribution(productId)`: `groupBy({ by:['rating'], where:{productId,status:'PUBLISHED'}, _count:true })`.
- `listReviewsForAdmin({status?,cursor?,limit?})`: status 무관(또는 필터) 목록 + 상품명 + 마스킹 displayName + 사진 개수. 커서 동일 `(createdAt desc, id desc)`.
- `getReviewForAdmin(id)`: 단건 + photos + product 컨텍스트.
- `api/mutations.ts` `setReviewStatus(id,next)`: 단일 트랜잭션 — 현재 status 조회 → `assertReviewTransition` → `update` → `productId` 반환. (TOCTOU 무관: 돈·좌석 아님, admin 단독 작업이라 race 비크리티컬. 단순 update로 충분.)

---

## 5. 캐시 무효화 계약 (SSOT 확인)

| 트리거 | 무효화 대상 | 비고 |
|---|---|---|
| `submitReview` (기존) | `/products/${id}`, `/mypage` | 변경 없음 |
| `setReviewStatusAction` (신규) | `/products/${id}`, `/admin/reviews`, `/admin/reviews/${id}` | **PDP ISR 즉시 무효화 (D2)** |

- PDP의 `listReviewsByProduct`·`getProductReviewStats`·`getReviewRatingDistribution`는 모두 `status:'PUBLISHED'` 필터 → revalidate 후 재생성 시 숨긴 리뷰는 자동 제외. 별도 캐시 키 조작 불필요.
- 더보기 액션은 매 호출 실시간 쿼리(캐시 비대상)라 무효화 무관.

---

## 6. 마이그레이션 / 정리

- `widgets/review-list/ui/ReviewList.tsx`는 `ReviewFeed`(feature)로 대체 → **삭제**하고 `widgets/review-list/index.ts`에서 export 제거. `ReviewStatsBar`·`RatingDistribution`만 widget에 잔류.
- PDP `page.tsx`: import 교체(`ReviewList` → `ReviewFeed`), `reviewsSection` 조립부에 `RatingDistribution` 추가. `getReviewRatingDistribution`를 기존 `Promise.all`에 합류.
- `getReviewPhotoPublicUrl`(server-only)는 호출부가 사라지면 제거 또는 잔류 — 본 스펙은 **잔류**(다른 server 경로 대비), 신규 렌더는 전부 client-safe `reviewPhotoPublicUrl` 사용.

---

## 7. 테스트 전략 (QA — 증거 기반)

- **단위(TDD 선행)**: `assertReviewTransition`(허용/거부 매트릭스), `normalizeRatingDistribution`(누락 별점·빈 입력), `reviewPhotoPublicUrl`(경로 조립·env fallback).
- **서버 액션**: `setReviewStatusAction` — 비-admin 거부, INVALID 전이 거부, 성공 시 productId 반환 + revalidatePath 호출(mock 검증). `loadMoreReviewsAction` — cursor 전달·PUBLISHED 필터.
- **typecheck/lint/test** 전체 통과 후 보고. PDP 더보기·라이트박스·admin 토글은 자동화 불가 항목만 수동 확인 절차 명시.

---

## 8. 범위 외 (명시)

- 사용자 신고(`REPORTED`) 진입점 — 다음 Phase.
- 리뷰 수정/삭제(사용자), 답글, 도움돼요 추천, 정렬 옵션(최신/별점순) — 본 Phase 제외.
- orphan storage 청소 cron — 기존 미구현 그대로(범위 밖).
- 반쪽 별(half-star) 렌더 — 별도 PR(기존 주석 유지).
