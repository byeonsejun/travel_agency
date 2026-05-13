# Product 표시 모듈 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Product 표시 레이어(카드 목록, PDP, 홈 추천 섹션) + 검증용 시드 데이터를 Next.js 15 App Router + FSD 패턴으로 구현한다.

**Architecture:** 모든 페이지는 RSC. 데이터는 `entities/{product,departure}/api/queries.ts`에서 Prisma 직접 호출. 클라이언트 컴포넌트는 `SortSelect` 1개. 위젯이 entity UI를 조합하는 FSD 단방향 의존성(`app → widgets → entities → shared`). `force-dynamic`으로 캐시 비활성화(Phase 2에서 튜닝).

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma 5, PostgreSQL, Tailwind CSS, Zod 3, Vitest 2

**Spec:** `docs/superpowers/specs/2026-05-12-product-display-design.md`

---

## 파일 맵

### 신규 생성
| 파일 | 역할 |
|------|------|
| `src/entities/departure/api/remainingSeats.ts` | `computeRemainingSeats` 순수 함수 |
| `src/entities/departure/api/__tests__/remainingSeats.test.ts` | 단위 테스트 |
| `src/entities/departure/api/queries.ts` | `getDeparturesByProduct` Prisma 쿼리 |
| `src/entities/departure/ui/DepartureList.tsx` | 월별 그룹화 + 배지 |
| `src/entities/product/api/parseListParams.ts` | zod 기반 searchParams 파서 |
| `src/entities/product/api/__tests__/parseListParams.test.ts` | 단위 테스트 |
| `src/entities/product/api/mapping.ts` | `pickLowestPrice` 순수 함수 |
| `src/entities/product/api/__tests__/mapping.test.ts` | 단위 테스트 |
| `src/entities/product/api/queries.ts` | 4개 Prisma 쿼리 함수 |
| `src/entities/product/ui/ProductImage.tsx` | 이미지 null 폴백 |
| `src/entities/product/ui/ProductCard.tsx` | 단일 카드 |
| `src/entities/product/ui/InclusionList.tsx` | 포함/불포함 분리 UI |
| `src/entities/product/ui/ItineraryTimeline.tsx` | 일정 타임라인 |
| `src/shared/ui/EmptyState.tsx` | 재사용 빈 결과 컴포넌트 |
| `src/widgets/product-card-list/ui/SortSelect.tsx` | `'use client'` 정렬 드롭다운 |
| `src/widgets/product-card-list/ui/ProductCardList.tsx` | 카드 그리드 |
| `src/widgets/product-card-list/ui/ProductFilterBar.tsx` | 목적지 탭 + SortSelect |
| `src/widgets/product-card-list/ui/Pagination.tsx` | Link 기반 페이지네이션 |
| `src/widgets/product-detail/ui/ProductDetail.tsx` | PDP 전체 레이아웃 |
| `src/app/(site)/products/page.tsx` | /products 목록 페이지 |
| `src/app/(site)/products/[id]/page.tsx` | PDP 페이지 |
| `src/app/(site)/products/[id]/not-found.tsx` | PDP 404 |
| `src/app/(site)/error.tsx` | (site) 공통 에러 바운더리 |
| `prisma/seed.ts` | Product 10건 + Departure 시드 |

### 수정
| 파일 | 변경 내용 |
|------|-----------|
| `src/entities/departure/model/types.ts` | `DepartureSummary` 타입 추가 |
| `src/entities/departure/model/constants.ts` | `DEPARTURE_BADGE_THRESHOLD = 0.1` 추가 |
| `src/entities/departure/index.ts` | 신규 타입·함수·컴포넌트 re-export |
| `src/entities/product/index.ts` | 신규 함수·컴포넌트 re-export |
| `src/app/(site)/page.tsx` | 홈 추천 섹션 추가 |
| `next.config.mjs` | `picsum.photos` remotePatterns 추가 |

---

## 태스크 목록

### Task 1: DepartureSummary 타입 & 배지 상수

**Files:**
- Modify: `src/entities/departure/model/types.ts`
- Modify: `src/entities/departure/model/constants.ts`

- [x] `types.ts`에 `DepartureSummary` 타입 추가 — `Departure`에서 `id, departureDate, returnDate, priceAdult, priceChild, capacity, bookedSeats, minPax, status` Pick + `remainingSeats: number` 추가
- [x] `constants.ts`에 `DEPARTURE_BADGE_THRESHOLD = 0.1` 상수 추가 (기존 `ALMOST_FULL_THRESHOLD`는 달력용이므로 유지)
- [x] `npm run typecheck` — 타입 오류 없음 확인
- [x] `git add -p && git commit -m "feat(departure): add DepartureSummary type and badge threshold constant"`

---

### Task 2: computeRemainingSeats (TDD)

**Files:**
- Create: `src/entities/departure/api/remainingSeats.ts`
- Create: `src/entities/departure/api/__tests__/remainingSeats.test.ts`

- [x] 테스트 파일 작성 — `(10,3)→7`, `(10,15)→0`, `(0,0)→0`, `(10,0)→10` 케이스
- [x] `npx vitest run src/entities/departure/api/__tests__/remainingSeats.test.ts` — FAIL 확인
- [x] `remainingSeats.ts` 구현 — `Math.max(0, capacity - bookedSeats)` 반환
- [x] `npx vitest run src/entities/departure/api/__tests__/remainingSeats.test.ts` — PASS 확인
- [x] `git commit -m "feat(departure): add computeRemainingSeats"`

---

### Task 3: parseProductListParams (TDD)

**Files:**
- Create: `src/entities/product/api/parseListParams.ts`
- Create: `src/entities/product/api/__tests__/parseListParams.test.ts`

- [x] 테스트 작성 — `sort=invalid→"latest"`, `page=-1→1`, `page="abc"→1`, `destination` 누락→`undefined`, 정상 케이스
- [x] `npx vitest run src/entities/product/api/__tests__/parseListParams.test.ts` — FAIL 확인
- [x] `parseListParams.ts` 구현 — `zod` schema + `.catch()` 폴백, `ProductListParams` 타입 export
- [x] `npx vitest run src/entities/product/api/__tests__/parseListParams.test.ts` — PASS 확인
- [x] `git commit -m "feat(product): add parseProductListParams with zod fallbacks"`

---

### Task 4: pickLowestPrice (TDD)

**Files:**
- Create: `src/entities/product/api/mapping.ts`
- Create: `src/entities/product/api/__tests__/mapping.test.ts`

- [x] 테스트 작성 — 빈 배열→`null`, 1건→`priceAdult`, 오름차순 첫 항목만 사용 확인
- [x] `npx vitest run src/entities/product/api/__tests__/mapping.test.ts` — FAIL 확인
- [x] `mapping.ts` 구현 — `RawDepartureForPrice` 입력 타입 + `pickLowestPrice` 반환 `number | null`
- [x] `npx vitest run src/entities/product/api/__tests__/mapping.test.ts` — PASS 확인
- [x] `npm run test` — 전체 3개 테스트 파일 모두 PASS
- [x] `git commit -m "feat(product): add pickLowestPrice mapping function"`

---

### Task 5: getDeparturesByProduct 쿼리

**Files:**
- Create: `src/entities/departure/api/queries.ts`

- [x] `db.departure.findMany` — `productId` 필터, `departureDate ≥ today`, `status ≠ CANCELED`, `departureDate ASC`
- [x] 각 행에 `computeRemainingSeats` 적용해서 `DepartureSummary[]` 반환
- [x] `npm run typecheck` — 오류 없음
- [x] `git commit -m "feat(departure): add getDeparturesByProduct query"`

---

### Task 6: Product 쿼리 4종

**Files:**
- Create: `src/entities/product/api/queries.ts`

- [x] `getDistinctDestinations` — `product.groupBy(destinationCode)`, PUBLISHED만, count DESC 정렬
- [x] `getFeaturedProducts(limit)` — PUBLISHED + `createdAt DESC`, departures LEFT JOIN(미래 1건, `priceAdult ASC`)으로 `lowestPrice` 계산, `ProductCard[]` 반환
- [x] `getProductById(id)` — `findUnique` + tags/inclusions/itineraryDays+stops include, `DRAFT`이면 `null` 반환, `ProductDetail | null` 반환
- [x] `getProductList(params)` — `sort==="latest"`는 Prisma `orderBy: {createdAt:"desc"}`, `price_asc`/`departure_soon`은 `db.$queryRaw` Prisma.sql 태그드 템플릿으로 sort_key 서브쿼리 → 정렬된 ID 조회 → 두 번째 Prisma 쿼리로 전체 데이터 조회 → ID 순서 복원. `total`은 `db.product.count`. `{items: ProductCard[], total: number}` 반환
- [x] `PAGE_SIZE = 12` 상수를 파일 상단에 정의, export
- [x] `npm run typecheck` — 오류 없음
- [x] `git commit -m "feat(product): add product queries (list/detail/featured/destinations)"`

---

### Task 7: Entity index re-export 업데이트

**Files:**
- Modify: `src/entities/departure/index.ts`
- Modify: `src/entities/product/index.ts`

- [x] `departure/index.ts`에 추가 — `DepartureSummary`(types), `DEPARTURE_BADGE_THRESHOLD`(constants), `getDeparturesByProduct`(api/queries), `computeRemainingSeats`(api/remainingSeats)
- [x] `product/index.ts`에 추가 — `parseProductListParams`, `ProductListParams`(api/parseListParams), `getProductList`, `getProductById`, `getFeaturedProducts`, `getDistinctDestinations`, `PAGE_SIZE`(api/queries)
- [x] `npm run typecheck` — 오류 없음
- [x] `git commit -m "chore: update entity index exports for product display module"`

---

### Task 8: next.config.mjs + EmptyState

**Files:**
- Modify: `next.config.mjs`
- Create: `src/shared/ui/EmptyState.tsx`

- [x] `next.config.mjs` — 기존 `remotePatterns` 배열에 `{protocol:"https", hostname:"picsum.photos"}` 추가
- [x] `EmptyState.tsx` — `{title, description?, action?}` props, 중앙 정렬 레이아웃
- [x] `npm run typecheck` — 오류 없음
- [x] `git commit -m "feat(shared): add EmptyState + picsum.photos image domain"`

---

### Task 9: ProductImage + ProductCard entity UI

**Files:**
- Create: `src/entities/product/ui/ProductImage.tsx`
- Create: `src/entities/product/ui/ProductCard.tsx`

- [x] `ProductImage` — `{src?: string | null, alt, className?}`, src 없으면 회색 div + alt 텍스트 표시, 있으면 `next/image`
- [x] `ProductCard` — `{product: ProductCard}`, `Link href="/products/{id}"`, 이미지/목적지/제목/기간/태그 3개/가격 레이아웃, `lowestPrice ?? basePriceAdult` 표시, `lowestPrice===null`이면 "출발일 미정" 배지
- [x] `npm run typecheck` — 오류 없음
- [x] `git commit -m "feat(product): add ProductImage and ProductCard entity UI"`

---

### Task 10: InclusionList + ItineraryTimeline entity UI

**Files:**
- Create: `src/entities/product/ui/InclusionList.tsx`
- Create: `src/entities/product/ui/ItineraryTimeline.tsx`

- [x] `InclusionList` — `{inclusions: Inclusion[]}`, INCLUDED(초록 박스)/EXCLUDED(빨간 박스) 분리
- [x] `ItineraryTimeline` — `{days: (ItineraryDay & {stops: ItineraryStop[]})[]}`, 일차 원형 배지 + 방문지/식사/숙소 표시, `meals` 필드는 `day.meals as Record<string, string>`으로 캐스팅
- [x] `npm run typecheck` — 오류 없음
- [x] `git commit -m "feat(product): add InclusionList and ItineraryTimeline entity UI"`

---

### Task 11: DepartureList entity UI

**Files:**
- Create: `src/entities/departure/ui/DepartureList.tsx`

- [x] `{departures: DepartureSummary[]}` props
- [x] 빈 배열이면 "현재 모객 중인 출발일이 없습니다." 박스 표시
- [x] `groupByMonth` 헬퍼 — `departureDate`를 `"YYYY년 M월"` 키로 그룹화
- [x] 배지 로직 — `CONFIRMED→"출발확정"`, `CLOSED||remainingSeats===0→"마감"`, `remainingSeats ≤ ceil(capacity * DEPARTURE_BADGE_THRESHOLD)→"마감임박"`, `bookedSeats < minPax && SCHEDULED→"모객 중"` 보조 텍스트
- [x] 테이블 형식 — 출발일/성인가/아동가/잔여석/상태 컬럼
- [x] `npm run typecheck` — 오류 없음
- [x] `git commit -m "feat(departure): add DepartureList entity UI"`

---

### Task 12: SortSelect 클라이언트 위젯

**Files:**
- Create: `src/widgets/product-card-list/ui/SortSelect.tsx`

- [x] `"use client"` 선언
- [x] `{current: string}` props
- [x] `useRouter` + `useSearchParams` — `sort` 변경 시 `page` 파라미터 삭제 + `router.push`
- [x] 옵션 3종 — `latest/최신순`, `price_asc/최저가`, `departure_soon/출발임박`
- [x] `npm run typecheck` — 오류 없음
- [x] `git commit -m "feat(widgets): add SortSelect client component"`

---

### Task 13: ProductCardList + ProductFilterBar + Pagination 위젯

**Files:**
- Create: `src/widgets/product-card-list/ui/ProductCardList.tsx`
- Create: `src/widgets/product-card-list/ui/ProductFilterBar.tsx`
- Create: `src/widgets/product-card-list/ui/Pagination.tsx`

- [x] `ProductCardList` — `{items: ProductCard[]}`, 3열 그리드, `ProductCard` 반복 렌더
- [x] `ProductFilterBar` — `{destinations, activeCode?, activeSort}`, 목적지 탭은 `<Link href="/products?destination=...&sort=...">`, SortSelect는 `<Suspense>` 래핑 후 자식으로 렌더 (Next.js 15 `useSearchParams` Suspense 필수)
- [x] `Pagination` — `{total, pageSize, currentPage, searchParams: Record<string,string>}`, `<Link>` 기반, `totalPages ≤ 1`이면 `null` 반환
- [x] `npm run typecheck` — 오류 없음
- [x] `git commit -m "feat(widgets): add ProductCardList, ProductFilterBar, Pagination"`

---

### Task 14: ProductDetail 위젯

**Files:**
- Create: `src/widgets/product-detail/ui/ProductDetail.tsx`

- [x] `{product: ProductDetail, departures: DepartureSummary[]}` props
- [x] 레이아웃 순서 — Hero 이미지 → 헤더(목적지/제목/기간/태그) → AI 요약 박스(`product.aiSummary` 있을 때만) → 기준가 카드 → 출발일 섹션(`DepartureList`) → 포함/불포함(`InclusionList`) → 일정(`ItineraryTimeline`)
- [x] `product.status === "CLOSED"` 이면 Hero 위에 "판매종료" 오버레이 + `DepartureList`에 빈 배열 전달
- [x] `npm run typecheck` — 오류 없음
- [x] `git commit -m "feat(widgets): add ProductDetail widget"`

---

### Task 15: error.tsx + not-found.tsx

**Files:**
- Create: `src/app/(site)/error.tsx`
- Create: `src/app/(site)/products/[id]/not-found.tsx`

- [x] `error.tsx` — `"use client"`, `{reset}` props, 한국어 메시지 + 재시도 버튼
- [x] `not-found.tsx` — 한국어 메시지 + `/products`로 돌아가기 `<Link>`
- [x] `npm run typecheck` — 오류 없음
- [x] `git commit -m "feat(app): add error boundary and product not-found page"`

---

### Task 16: 홈 페이지 추천 섹션

**Files:**
- Modify: `src/app/(site)/page.tsx`

- [x] `export const dynamic = "force-dynamic"` 추가
- [x] `getFeaturedProducts(6)` 호출 (async 서버 컴포넌트)
- [x] 기존 헤더 유지, 하단에 "추천 여행 상품" 섹션 + `ProductCardList` + "전체보기" 링크(`/products`) 추가
- [x] `featured.length === 0`이면 "등록된 상품이 없습니다." 텍스트
- [x] `npm run typecheck` — 오류 없음
- [x] `git commit -m "feat(home): add featured products section"`

---

### Task 17: /products 목록 페이지

**Files:**
- Create: `src/app/(site)/products/page.tsx`

- [x] `export const dynamic = "force-dynamic"`
- [x] `searchParams: Promise<...>` await (Next.js 15) → `parseProductListParams`
- [x] `Promise.all([getProductList(params), getDistinctDestinations()])` 병렬 조회
- [x] `items.length === 0`이면 `EmptyState` — 필터 활성 여부에 따라 메시지 분기
- [x] 결과 있으면 `ProductFilterBar` + `ProductCardList` + `Pagination` 렌더
- [x] `Pagination`에 전달할 `searchParams` 객체 구성 — `destination`, `sort` 포함 (page 제외)
- [x] `npm run typecheck` — 오류 없음
- [x] `git commit -m "feat(app): add /products list page with filter and pagination"`

---

### Task 18: /products/[id] PDP 페이지

**Files:**
- Create: `src/app/(site)/products/[id]/page.tsx`

- [x] `export const dynamic = "force-dynamic"`
- [x] `params: Promise<{id:string}>` await (Next.js 15)
- [x] `Promise.all([getProductById(id), getDeparturesByProduct(id)])` 병렬 조회
- [x] `product === null`이면 `notFound()` 호출
- [x] `<ProductDetail product={product} departures={departures} />` 렌더
- [x] `npm run typecheck` — 오류 없음
- [x] `git commit -m "feat(app): add /products/[id] PDP page"`

---

### Task 19: 시드 데이터

**Files:**
- Create: `prisma/seed.ts`

- [x] 파일 상단에 `addDays(base, n)` 헬퍼 정의
- [x] `main()` 시작 시 `prisma.$transaction([itineraryStop, itineraryDay, inclusion, productTag, departure, product].map(t => t.deleteMany()))` 순서대로 삭제 (FK 역순)
- [x] **Product 1** `JP-OSA` PUBLISHED — 오사카·교토 3박4일, `#노쇼핑 #자유시간 #도심`, basePriceAdult 1,290,000, Departure +30d·+60d
- [x] **Product 2** `JP-TYO` PUBLISHED — 도쿄·하코네 온천 4박5일, `#온천 #부모님 #료칸`, 1,590,000, Departure +45d·+75d
- [x] **Product 3** `VN-DAD` PUBLISHED — 다낭·호이안 5박6일 노쇼핑, `#노쇼핑 #가족`, 1,190,000, Departure +30d·+60d·+90d
- [x] **Product 4** `TH-HKT` PUBLISHED — 푸켓 풀빌라 허니문 5박7일, `#허니문 #프리미엄`, 2,490,000, Departure +30d·+60d
- [x] **Product 5** `EU-FR-IT` PUBLISHED — 파리·로마 8박9일, `#유럽 #역사`, 3,990,000, Departure +60d·+90d
- [x] **Product 6** `EU-CH` PUBLISHED — 스위스 알프스 9박10일, `#알프스 #프리미엄`, 4,990,000, Departure +60d·+90d
- [x] **Product 7** `ID-DPS` PUBLISHED — 발리 가성비 4박6일, `#가성비 #휴양`, 990,000, Departure +14d(최저가·출발임박)·+45d
- [x] **Product 8** `PH-CEB` PUBLISHED — 세부 가족여행 4박5일, `#가족 #해양스포츠`, 1,390,000, **Departure 없음** (폴백 검증용)
- [x] **Product 9** `JP-FUK` CLOSED — 후쿠오카 미식 3박4일, `#미식 #당일치기`, 1,090,000, Departure 1건(-30d 과거), 1건(CANCELED)
- [x] **Product 10** `PH-MNL` DRAFT — 보라카이 5박6일(작성중), `#휴양`, 1,690,000, Departure 없음
- [x] 각 Product에 `ItineraryDay` `durationDays`만큼 + `ItineraryStop` 일별 3개 이상 추가
- [x] 각 Product에 Inclusion INCLUDED 5개 + EXCLUDED 3개 추가
- [x] `heroImageUrl`은 `https://picsum.photos/seed/{slug}/800/500` 패턴 (slug는 영문 소문자 약칭)
- [x] `aiSummary`는 각 상품에 맞는 자연스러운 한국어 3줄 (직접 작성)
- [x] Product 7 Departure +14d의 `bookedSeats`는 `capacity - 2` (마감임박 배지 검증)
- [x] `npm run db:seed` — 성공 확인 (DB 연결 환경 필요)
- [x] `git commit -m "feat(seed): add 10 products with departures for product display testing"`

---

## 완료 후 수동 검증 체크리스트

- [x] `/` — 추천 6건 카드, picsum 이미지 정상
- [x] `/products` — 전체 목록, 페이지네이션
- [x] `/products?destination=JP-OSA` — 목적지 필터
- [x] `/products?sort=price_asc` — raw SQL 경로 최저가 정렬
- [x] `/products?sort=departure_soon` — raw SQL 경로 출발임박 정렬
- [x] `/products?sort=latest` — Prisma 경로 최신순
- [x] 정렬 드롭다운 변경 → URL 갱신 + 1페이지 리셋
- [x] `/products/{id}` — AI 요약, 일정 타임라인, Departure 리스트
- [x] `/products/존재하지않는ID` — not-found.tsx
- [x] DRAFT 상품 직접 URL → 404
- [x] CLOSED 상품(Product 9) PDP → "판매종료" 배지 + 빈 Departure
- [x] Product 8 카드 → "출발일 미정" 배지 + basePriceAdult 폴백
- [x] Product 7 Departure → "마감임박" 배지
- [x] `npm run typecheck` 통과
- [x] `npm run test` 통과
