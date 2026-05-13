# Product 표시 모듈 설계

> **버전**: v1.0
> **작성일**: 2026-05-12
> **상위 문서**: [PRD](../../product/PRD.md), [ARCHITECTURE](../../technical/ARCHITECTURE.md)

## 0. 범위 및 비범위

### 범위 (이 spec)
- 고객용 Product **표시** 레이어 — PDP, 카드 목록, 홈 추천 섹션
- `/products` 목록 페이지 + 기본 필터(목적지) + 정렬(최저가/출발임박/최신순)
- `/products/[id]` 상세 페이지 (PDP)
- `/` 홈 페이지에 "추천 상품" 섹션 (최근 PUBLISHED 6건)
- Departure는 월별 그룹화 리스트로 readonly 표시
- 검증용 시드 데이터 (Product 10건 + Departure 다건)

### 비범위 (별도 spec)
- AI 시맨틱 검색 파이프라인 (자연어 쿼리, pgvector 임베딩)
- `Product.aiSummary` / `ProductEmbedding` **생성** 로직 — 시드의 손작성 값만 표시
- 어드민 상품 관리(등록/수정 폼) — 별도 어드민 spec
- 예약/결제 플로우 — 카드·PDP의 "예약" 버튼은 disabled 또는 표시 안 함
- 상품 검색 결과 페이지(`/search`) — AI 검색 spec에 귀속
- 캐싱 튜닝(`revalidate`, `unstable_cache`) — Phase 2

## 1. 아키텍처 & 라우팅

### 라우트 (App Router)
```
src/app/(site)/
├── page.tsx                    홈 + 추천 상품 6개 (기존 파일 확장)
├── products/
│   ├── page.tsx                /products 목록 (filter/sort searchParams)
│   ├── [id]/page.tsx           PDP
│   └── [id]/not-found.tsx      PDP 전용 404
└── error.tsx                   (site) 전체 공통 error boundary
```

### FSD 레이어 매핑
```
app/(site)/products/page.tsx          ← RSC, searchParams 읽고 query 호출
app/(site)/products/[id]/page.tsx     ← RSC, getProductById + notFound()
app/(site)/page.tsx                   ← RSC, getFeaturedProducts(6)

widgets/
├── product-card-list/
│   ├── ui/ProductCardList.tsx        ← 카드 그리드 (RSC, 표시 전용)
│   ├── ui/ProductFilterBar.tsx       ← 필터 탭(<Link>) + SortSelect 자식
│   ├── ui/SortSelect.tsx             ← 'use client', useRouter로 sort 갱신
│   └── ui/Pagination.tsx             ← <Link> 기반 RSC
├── product-detail/
│   └── ui/ProductDetail.tsx          ← PDP 전체 레이아웃 (RSC)

entities/product/
├── api/queries.ts                    ← getProductList / getProductById /
│                                       getFeaturedProducts / getDistinctDestinations
├── api/parseListParams.ts            ← zod 기반 searchParams 폴백 파서
├── api/mapping.ts                    ← pickLowestPrice / toProductCard 순수 함수
├── ui/ProductCard.tsx                ← 단일 카드 (RSC)
├── ui/ProductImage.tsx               ← heroImageUrl null 폴백 처리
├── ui/InclusionList.tsx              ← INCLUDED/EXCLUDED 분리 박스
├── ui/ItineraryTimeline.tsx          ← 일정 타임라인
└── model/* (기존 유지)

entities/departure/
├── api/queries.ts                    ← getDeparturesByProduct
├── api/remainingSeats.ts             ← computeRemainingSeats 순수 함수
├── model/types.ts                    ← DepartureSummary 타입 추가
└── ui/DepartureList.tsx              ← 월별 그룹화 + 잔여좌석/상태 배지

shared/ui/EmptyState.tsx              ← 재사용 가능 빈 결과 컴포넌트
```

### FSD import 규칙
- `app → widgets → entities → shared` (단방향)
- widgets끼리·entities끼리 import 금지 — widget에서 여러 entity UI를 조립
- 모든 페이지는 RSC. 클라이언트 컴포넌트는 `SortSelect` 1개로 한정.

### 필터 UI 전략
- **목적지 탭**: `<Link href="/products?destination=JP-OSA&...">` — SEO 친화, RSC
- **정렬 드롭다운**: `'use client'` `<SortSelect>` — `useRouter` + `useSearchParams`로 sort만 갱신

## 2. 컴포넌트 책임 & 시그니처

### Query 함수

```ts
// entities/product/api/queries.ts
type ListFilter = { destinationCode?: string };
type ListSort = "price_asc" | "departure_soon" | "latest";

getProductList(opts: {
  filter?: ListFilter;
  sort?: ListSort;
  page?: number;
  pageSize?: number;
}): Promise<{ items: ProductCard[]; total: number }>;
// PUBLISHED만. Departure 가장 가까운 미래 1건 join으로 lowestPrice 계산.

getProductById(id: string): Promise<ProductDetail | null>;
// tags / inclusions / itineraryDays + stops include. CLOSED 포함, DRAFT 제외.

getFeaturedProducts(limit: number): Promise<ProductCard[]>;
// MVP 룰: "PUBLISHED + createdAt DESC + limit". 큐레이션 로직은 Phase 2.

getDistinctDestinations(): Promise<{ code: string; label: string; count: number }[]>;
// 필터 탭 표시용.
```

```ts
// entities/departure/api/queries.ts
getDeparturesByProduct(productId: string): Promise<DepartureSummary[]>;
// 오늘 이후 출발일만, departureDate ASC. status=CANCELED 제외.
```

### Widget 컴포넌트

```ts
// widgets/product-card-list/
ProductCardList:    { items: ProductCard[] }                              // RSC
ProductFilterBar:   { destinations; activeCode?; activeSort }             // RSC, 자식으로 SortSelect
SortSelect:         { current: string }                                   // 'use client'
Pagination:         { total: number; pageSize: number; currentPage; baseHref; searchParams }

// widgets/product-detail/
ProductDetail:      { product: ProductDetail; departures: DepartureSummary[] }
// 레이아웃: Hero → AI 요약 박스(product.aiSummary) → 가격 카드 →
//           DepartureList → InclusionList → ItineraryTimeline
```

### Entity 레이어 UI

```ts
// entities/product/ui/
ProductCard:       { product: ProductCard }       // 단일 카드
ProductImage:      { src?: string; alt: string }  // null 폴백 처리
InclusionList:     { inclusions: Inclusion[] }    // INCLUDED/EXCLUDED 분리
ItineraryTimeline: { days: (ItineraryDay & { stops: ItineraryStop[] })[] }

// entities/departure/ui/
DepartureList:     { departures: DepartureSummary[] }  // 월별 그룹화 + 배지
```

### 추가 타입

```ts
// entities/departure/model/types.ts
export type DepartureSummary = Pick<Departure,
  | "id" | "departureDate" | "returnDate"
  | "priceAdult" | "priceChild"
  | "capacity" | "bookedSeats" | "minPax" | "status"
> & {
  remainingSeats: number;  // computeRemainingSeats(capacity, bookedSeats)
};
```

## 3. 데이터 흐름

### 라우트별 흐름

```
[1] /products?destination=JP-OSA&sort=price_asc&page=2
    ↓ App Router parses searchParams
    page.tsx (RSC)
    ↓ parseProductListParams(searchParams)
    ↓ Promise.all
    ├─ getProductList({ filter, sort, page })
    └─ getDistinctDestinations()
    ↓
    <ProductFilterBar destinations activeCode activeSort />
    <ProductCardList items />
    <Pagination total currentPage />

[2] /products/abc123
    ↓
    [id]/page.tsx (RSC)
    ↓ Promise.all
    ├─ getProductById("abc123")   ← null이면 notFound()
    └─ getDeparturesByProduct("abc123")
    ↓
    <ProductDetail product departures />

[3] /
    ↓ page.tsx (RSC)
    ↓ getFeaturedProducts(6)
    ↓ 홈 헤더 + <ProductCardList items />
```

### Prisma 쿼리 패턴 (N+1 회피)

```ts
// latest 정렬 경로
prisma.product.findMany({
  where: { status: "PUBLISHED", ...(destinationCode && { destinationCode }) },
  include: {
    tags: { select: { tag: true } },
    departures: {
      where: { departureDate: { gte: today }, status: { not: "CANCELED" } },
      orderBy: { priceAdult: "asc" },
      take: 1,
      select: { priceAdult: true, departureDate: true },
    },
  },
  orderBy: { createdAt: "desc" },
  take: pageSize, skip,
});
```

### 정렬 분기 (하이브리드)

- `latest` → Prisma 표준 `orderBy: { createdAt: "desc" }`
- `price_asc` / `departure_soon` → **raw SQL** (Prisma로 관계형 정렬 표현 어려움)
  ```sql
  SELECT p.*, (
    SELECT MIN(d."priceAdult")        -- price_asc
    -- SELECT MIN(d."departureDate")  -- departure_soon
    FROM "Departure" d
    WHERE d."productId" = p.id
      AND d."departureDate" >= $today
      AND d.status <> 'CANCELED'
  ) AS sort_key
  FROM "Product" p
  WHERE p.status = 'PUBLISHED'
    AND ($destinationCode IS NULL OR p."destinationCode" = $destinationCode)
  ORDER BY sort_key NULLS LAST
  LIMIT $limit OFFSET $offset;
  ```
  - `getProductList` 내부 분기. 외부 인터페이스는 단일.
  - 미래 Departure 없는 상품은 `NULLS LAST`로 결과 뒤에 배치.
  - 파라미터는 `$1`/`$2` 바인딩 (SQL 인젝션 차단).

### SortSelect 클라이언트 라우팅

```ts
'use client';
function SortSelect({ current }: { current: string }) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <select
      value={current}
      onChange={(e) => {
        const next = new URLSearchParams(params);
        next.set("sort", e.target.value);
        next.delete("page");                  // 정렬 변경 시 1페이지로
        router.push(`/products?${next.toString()}`);
      }}
    >
      <option value="latest">최신순</option>
      <option value="price_asc">최저가</option>
      <option value="departure_soon">출발임박</option>
    </select>
  );
}
```

### 캐싱 전략 (MVP)

- 모든 페이지 `export const dynamic = "force-dynamic"` — 시드 검증·디버깅 우선.
- 캐시 튜닝은 Phase 2 (예약/결제 모듈 안정화 이후).
- Prisma Client는 `shared/lib/db.ts` 싱글톤 사용.

## 4. 에러 처리 & 엣지 케이스

### 404 — 존재하지 않는 / 비공개 상품 (PDP)
- `getProductById` 결과 `null` 또는 `status === "DRAFT"` → `notFound()` 호출.
- `src/app/(site)/products/[id]/not-found.tsx` — 한국어 메시지 + "/products로 돌아가기" 링크.
- `CLOSED`는 표시하되 상단에 "판매종료" 배지 + Departure 섹션을 "현재 모객 중인 출발일이 없습니다"로 대체.

### 잘못된 searchParams 입력 검증

```ts
// entities/product/api/parseListParams.ts
const listParamsSchema = z.object({
  destination: z.string().optional(),
  sort: z.enum(["latest", "price_asc", "departure_soon"]).catch("latest"),
  page: z.coerce.number().int().min(1).catch(1),
});
```
- 알 수 없는 `sort` → `"latest"` 폴백
- 잘못된 `page` → `1`
- 모든 raw SQL은 `$1` 바인딩으로 SQL 인젝션 차단

### 빈 결과 (목록 0건)
- 빈 결과 분기는 **페이지 RSC가 담당** (`items.length === 0` 체크) — `<ProductCardList>`는 단순 렌더만.
- 필터 적용 중: "조건에 맞는 상품이 없습니다. 필터를 초기화해보세요." + `<Link href="/products">` 초기화 링크
- 필터 없음: "등록된 상품이 없습니다."
- `shared/ui/EmptyState.tsx`로 재사용 가능하게 분리 — `{ title; description?; action? }` props

### Departure 없는 상품
- 카드: `lowestPrice === null` → `Product.basePriceAdult` 폴백 표시 + "출발일 미정" 배지
- PDP `DepartureList`: 미래 Departure 0건 → "현재 모객 중인 출발일이 없습니다." 박스
- 정렬 시 `NULLS LAST`로 결과 뒤에 배치 (제외하지 않음)

### Departure 배지 규칙 (DepartureList)
명시적 분기 — UI에서 흩어지지 않게 한 곳에 모음.
- `status === "CONFIRMED"` → "출발확정" 배지
- `status === "CLOSED"` → "마감" 배지
- `remainingSeats === 0` (status=SCHEDULED 인데도) → "마감" 배지
- `0 < remainingSeats <= Math.ceil(capacity * 0.1)` → "마감임박" 배지
- 그 외 → 배지 없음
- `bookedSeats < minPax` 이고 `status === "SCHEDULED"` → 보조 텍스트 "모객 중 (최소 인원 미달)"
- 배지 라벨은 `entities/departure/model/constants.ts`에 상수로 정의

### 페이지네이션 범위 초과
- `page * pageSize > total`이면 EmptyState로 폴백. redirect 없음.
- `<Pagination>`은 마지막 페이지까지만 링크 노출 — 사용자가 URL 직접 조작한 경우만 발생.

### DB 에러 / 예상치 못한 예외
- query 함수·페이지에 별도 try/catch 없음 — throw 후 Next의 `error.tsx`가 처리.
- `src/app/(site)/error.tsx` 1개로 `(site)` 그룹 전체 커버.
- `'use client'`, "일시적 오류가 발생했습니다. 잠시 후 다시 시도해주세요." + 재시도 버튼.

### 좌석 음수 방어
- `computeRemainingSeats(capacity, bookedSeats)` = `Math.max(0, capacity - bookedSeats)`
- 표시 단계에서만 적용. 데이터 무결성 자체는 예약 모듈 책임.

### 이미지 로딩 실패
- `entities/product/ui/ProductImage.tsx`: `src`가 null/undefined면 회색 placeholder + 상품명 텍스트 표시.
- `next.config.mjs` `images.remotePatterns`에 `picsum.photos` 등록 (시드 이미지용).

### 명시적 비기능
- 카드·PDP의 가격은 **읽기 전용**. 가격 재계산/검증은 예약 모듈 책임.
- `bookedSeats` 실시간 정확성 보장 안 함 (동시성은 예약 모듈에서).
- 검색·필터는 자연어 처리 안 함 — `destinationCode` 정확 일치만.

## 5. 테스트 범위

### 전략
- 비즈니스 로직을 query 함수 *외부*의 **순수 함수**로 추출 → 단위 테스트.
- Prisma query 통합 테스트 → **Phase 2** (test DB 셋업이 spec 부담).
- 컴포넌트 테스트 → **Phase 2** (RSC + happy-dom 조합의 ROI 낮음).
- 수동 검증 체크리스트로 UI·통합 동작 갈음.

### 단위 테스트

```
entities/product/api/__tests__/
├── parseListParams.test.ts    parseProductListParams (zod 폴백)
└── mapping.test.ts            pickLowestPrice, toProductCard

entities/departure/api/__tests__/
└── remainingSeats.test.ts     computeRemainingSeats
```

**parseProductListParams**:
- `sort=invalid` → `"latest"`
- `page=-1` / `page="abc"` → `1`
- `destination` 누락 → `undefined`
- 정상 케이스

**pickLowestPrice**:
- 빈 배열 → `null`
- Departure 1건 → 해당 `priceAdult`

**computeRemainingSeats**:
- `(10, 3)` → `7`
- `(10, 15)` → `0`
- `(0, 0)` → `0`

### 설정
- 기존 `vitest.config.ts` / `happy-dom` 그대로 사용.
- 테스트 파일 위치: entity 폴더 옆 `__tests__/`.
- 신규 npm 스크립트 없음 — `npm run test` 그대로.

### 수동 검증 체크리스트

- [ ] `npm run db:migrate && npm run db:seed` 성공
- [ ] `/` — 추천 6건 카드 노출, 이미지 정상
- [ ] `/products` — 전체 목록, 페이지네이션 동작
- [ ] `/products?destination=JP-OSA` — 해당 목적지만 필터링
- [ ] `/products?sort=price_asc` — 최저가 오름차순 (raw SQL 경로)
- [ ] `/products?sort=departure_soon` — 출발일 가까운 순 (raw SQL 경로)
- [ ] `/products?sort=latest` — 최신순 (Prisma 경로)
- [ ] 정렬 드롭다운 변경 시 URL 갱신 + 1페이지로 리셋
- [ ] `/products/{id}` — PDP, AI 요약 박스, 일정 타임라인, Departure 월별 리스트 노출
- [ ] `/products/존재하지않음` — `not-found.tsx` 렌더
- [ ] DRAFT 상품 직접 URL 접근 → 404
- [ ] CLOSED 상품 PDP — "판매종료" 배지 + Departure 빈 메시지
- [ ] 미래 Departure 없는 상품 카드 — `basePriceAdult` 폴백 + "출발일 미정" 배지
- [ ] DB 임시 끊고 페이지 접근 → `error.tsx` 노출 + 재시도 동작
- [ ] `npm run typecheck` 통과
- [ ] `npm run test` 통과

## 6. 시드 데이터

**파일**: `prisma/seed.ts` (신규)
**실행**: `npm run db:seed` (package.json 등록 완료)
**멱등성**: 매 실행 시 시드 대상 테이블을 `deleteMany`로 초기화 후 재삽입. User·Auth 테이블은 건드리지 않음.

### Product 10건 — 엣지 케이스 커버

| # | 제목 | destinationCode | status | 비고 |
|---|------|-----------------|--------|------|
| 1 | 오사카·교토 3박 4일 자유일정 | JP-OSA | PUBLISHED | 일반 케이스 |
| 2 | 도쿄·하코네 온천 4박 5일 | JP-TYO | PUBLISHED | #온천 #부모님 |
| 3 | 다낭·호이안 5박 6일 노쇼핑 | VN-DAD | PUBLISHED | #노쇼핑 #가족 |
| 4 | 푸켓 5박 7일 풀빌라 허니문 | TH-HKT | PUBLISHED | #허니문 #프리미엄 |
| 5 | 파리·로마 8박 9일 핵심코스 | EU-FR-IT | PUBLISHED | 장기·고가 |
| 6 | 스위스 알프스 9박 10일 | EU-CH | PUBLISHED | 최고가 |
| 7 | 발리 4박 6일 가성비 | ID-DPS | PUBLISHED | 최저가 + 출발임박 |
| 8 | 세부 4박 5일 가족여행 | PH-CEB | PUBLISHED | **Departure 없음** (폴백 검증) |
| 9 | 후쿠오카 3박 4일 미식 | JP-FUK | CLOSED | "판매종료" 배지 검증 |
| 10 | 보라카이 5박 6일 (작성중) | PH-MNL | DRAFT | 404 검증 |

각 Product마다:
- `ProductTag` 2~4개
- `Inclusion` INCLUDED 5~7개 + EXCLUDED 2~4개
- `ItineraryDay` `durationDays` 수만큼 + `ItineraryStop` 일별 3~5개
- `aiSummary` — 손으로 작성한 자연스러운 한국어 3줄

### Departure 분포

- 1~7, 9번: 각 2~3건. `departureDate`는 오늘 기준 `+30d` / `+60d` / `+90d` 위주.
- 7번 (발리): `+14d` 1건 추가 → `departure_soon` 정렬 1위 확인용.
- 9번 (후쿠오카 CLOSED): 1건은 과거(`-30d`), 1건은 `CANCELED` 상태 → "현재 모객 중인 출발일이 없습니다" 검증.
- `bookedSeats` 분포: 0 / capacity의 50% / 90%(마감임박) / 100% 케이스 섞기.
- 일부 Departure는 `status = CONFIRMED` (모객 확정) → 배지 노출 검증.

### 이미지 — picsum.photos

`next.config.mjs`에 추가:
```ts
images: {
  remotePatterns: [
    { protocol: "https", hostname: "picsum.photos" },
  ],
}
```

시드의 `heroImageUrl`:
```
https://picsum.photos/seed/{productSlug}/800/500
```
- `seed` 파라미터를 상품마다 고정 → 매 시드 재실행 시 동일 이미지 (재현성 확보).

### 모듈 경계

- `aiSummary`는 시드에 손으로 작성 (표시 검증용).
- `ProductEmbedding`은 **시드 대상 아님** — AI 검색 spec에서 백필.

### 파일 구조

```ts
// prisma/seed.ts
const products: ProductSeed[] = [...];   // 10건 데이터
async function main() {
  await prisma.$transaction([
    prisma.itineraryStop.deleteMany(),
    prisma.itineraryDay.deleteMany(),
    prisma.inclusion.deleteMany(),
    prisma.productTag.deleteMany(),
    prisma.departure.deleteMany(),
    prisma.product.deleteMany(),
  ]);
  for (const p of products) {
    await prisma.product.create({ data: { ...p, /* nested creates */ } });
  }
}
```

데이터 자체는 가독성 보고 `prisma/seed-data/products.ts`로 분리 여부 결정.

## 7. 작업 시 변경되는 파일 (개관)

### 신규
- `src/app/(site)/products/page.tsx`
- `src/app/(site)/products/[id]/page.tsx`
- `src/app/(site)/products/[id]/not-found.tsx`
- `src/app/(site)/error.tsx`
- `src/widgets/product-card-list/ui/{ProductCardList,ProductFilterBar,SortSelect,Pagination}.tsx`
- `src/widgets/product-detail/ui/ProductDetail.tsx`
- `src/entities/product/api/{queries,parseListParams,mapping}.ts`
- `src/entities/product/ui/{ProductCard,ProductImage,InclusionList,ItineraryTimeline}.tsx`
- `src/entities/product/api/__tests__/{parseListParams,mapping}.test.ts`
- `src/entities/departure/api/{queries,remainingSeats}.ts`
- `src/entities/departure/ui/DepartureList.tsx`
- `src/entities/departure/api/__tests__/remainingSeats.test.ts`
- `src/shared/ui/EmptyState.tsx`
- `prisma/seed.ts` (+ 필요 시 `prisma/seed-data/products.ts`)

### 수정
- `src/app/(site)/page.tsx` — 홈에 추천 섹션 추가
- `src/entities/product/index.ts` — 신규 export 추가
- `src/entities/departure/index.ts` — `DepartureSummary` 등 export
- `src/entities/departure/model/types.ts` — `DepartureSummary` 추가
- `src/entities/departure/model/constants.ts` — 배지 라벨 상수 추가
- `next.config.mjs` — `images.remotePatterns`에 `picsum.photos` 등록
