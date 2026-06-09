# UI 전면 개편 — A1 "클린 블루" (Design Spec)

> 작성일: 2026-06-09
> 상태: 승인됨 (brainstorming → spec)
> 범위: `(site)` 공개 셸 전 페이지. `(admin)`·결제·예약·webhook **미접촉**.
> 후속: 본 spec → `writing-plans` 로 Phase A~E 실행 계획 도출.

---

## 0. 배경 & 목표

현재 프로젝트는 **디자인 시스템이 사실상 없다**: `tailwind.config.ts`는 `theme.extend: {}`(커스텀 토큰 0), `globals.css`는 `@tailwind` 지시문 3줄뿐, `layout.tsx`에 웹폰트 로드 없음, `shared/ui`엔 기능성 컴포넌트 6종만 존재(버튼·카드·인풋 등 프리미티브 부재) → 페이지마다 인라인 유틸 클래스 반복.

**목표:** 사용자가 선택한 디자인 시안 **A1 "클린 블루"**(`design-mockups/a1-clean.html`)를 `(site)` 셸 전체에 적용한다. 화이트+신뢰감 블루 기반의 한국형 여행 예약 사이트 비주얼 정체성을 세우고, 통합검색·지역탭·테마 벤토 등 A1의 정보구조(IA)까지 재구성한다.

**확정된 결정 (brainstorming 합의):**
- 범위: `(site)` 공개 사이트만 (admin은 토큰 비공유, 현행 유지)
- 컴포넌트 도구: **shadcn/ui** (검증된 베이스 위에 A1 스킨)
- 다크 모드: **라이트 전용** (토큰 구조는 후속 다크 확장 가능하게)
- 구조: **A1 IA까지 재구성** (단순 리스킨 아님)
- 폰트: **Pretendard via `next/font/local`** (성능 최적화)
- 헤더 카테고리: **해외여행 + 국내여행 2개만** (호텔/항공/테마 제외)
- 반응형: **모바일 대응 포함** (햄버거 sheet, 카드 1~2열)
- 백엔드: **무수정** — A1 새 섹션은 전부 기존 쿼리로 충당

---

## 1. 디자인 토큰 (파운데이션)

모든 색은 `globals.css`의 CSS 변수(shadcn HSL 컨벤션)로 정의하고 `tailwind.config.ts`가 참조 → **하드코딩 0, SSOT 1곳**.

### 1.1 색상 팔레트 (라이트 전용)

shadcn 토큰 포맷은 `hsl()` 래퍼 없이 공백 구분: `--primary: 219 100% 53%`.

| 역할 | shadcn 토큰 | HEX (A1 원본) | HSL (실제 기입값) |
|---|---|---|---|
| Primary (브랜드 블루) | `--primary` | `#1062ff` | `219 100% 53%` |
| Primary foreground | `--primary-foreground` | `#ffffff` | `0 0% 100%` |
| Foreground (본문) | `--foreground` | `#16181d` | `223 14% 10%` |
| Muted text | `--muted-foreground` | `#6b7280` | `220 9% 46%` |
| Background | `--background` | `#ffffff` | `0 0% 100%` |
| Muted / Secondary bg | `--muted` / `--secondary` | `#f5f7fb` | `218 40% 97%` |
| Border / Input | `--border` / `--input` | `#e9ecf2` | `220 26% 93%` |
| Ring (포커스) | `--ring` | `#1062ff` | `219 100% 53%` |
| Card 표면 | `--card` / `--popover` | `#ffffff` | `0 0% 100%` |
| Destructive (특가/HOT/에러) | `--destructive` | `#ff4d4f` | `359 100% 65%` |
| Accent (호버 강조) | `--accent` | `#f5f7fb` | `218 40% 97%` |

- Primary hover: 코드에서 `bg-primary/90` 또는 별도 `--primary-hover: 220 91% 44%`(`#0a4fd6`). shadcn `button` 기본은 `/90` 사용 → 별도 토큰 불요(YAGNI).
- `card-foreground`/`popover-foreground`/`secondary-foreground`/`accent-foreground`는 `--foreground` 와 동일값.

### 1.2 기타 토큰

- `--radius: 0.875rem` (14px, 카드 기준). 버튼/인풋은 `rounded-[0.625rem]`(10px) — shadcn `--radius` 파생 사용.
- 그림자 2종 (Tailwind `boxShadow` 확장):
  - `shadow-card`: `0 14px 36px rgba(16,40,90,.12)` — 카드 호버 부상
  - `shadow-float`: `0 18px 50px rgba(16,40,90,.16)` — 떠있는 검색바
- 폰트: Pretendard → `--font-sans` 로 노출, Tailwind `fontFamily.sans` 교체.

### 1.3 파일 영향

| 파일 | 변경 |
|---|---|
| `src/app/globals.css` | `:root` CSS 변수 블록 + shadcn base layer 추가 |
| `tailwind.config.ts` | `theme.extend.colors`(=`hsl(var(--…))`), `borderRadius`, `boxShadow`, `fontFamily.sans`, `container` |
| `src/app/layout.tsx` | Pretendard `next/font/local` 로드 → `<body className={pretendard.variable}>` + `font-sans` |
| `components.json` | shadcn init 산출물. alias: `@/shared/ui`, css: `src/app/globals.css`, baseColor: slate(이후 토큰 수동 병합) |
| `public/fonts/` 또는 패키지 | Pretendard 폰트 파일(woff2). `next/font/local` 참조 |

### 1.4 리스크

- shadcn init이 `tailwind.config`/`globals.css`를 덮어쓸 수 있음 → init **직후 토큰 수동 병합**, `npm run build`로 확인.
- `next/font/local`은 폰트 파일 경로가 필요 → Pretendard woff2를 `public/fonts/`에 두거나 `pretendard` npm 패키지 경로 참조. Phase A에서 확정.

---

## 2. 컴포넌트 인벤토리

### 2.1 shadcn 프리미티브 → `src/shared/ui/` (YAGNI: A1이 실제 요구하는 것만)

| 컴포넌트 | 용도 |
|---|---|
| `button` | 전역 CTA·검색버튼 |
| `card` | 상품 카드·박스 |
| `input` | 검색·폼 |
| `tabs` | 홈 지역 탭 |
| `badge` | 특가/HOT |
| `select` | 정렬(`SortSelect` 교체) |
| `dropdown-menu` | 헤더 카테고리·유저 메뉴 |
| `sheet` | 모바일 햄버거 nav |
| `skeleton` | 기존 `shared/ui/Skeleton.tsx`를 shadcn 버전으로 통합 |

> shadcn 컴포넌트는 Radix 기반 → `'use client'` 포함. **`entities/**/ui`엔 `'use client'` 금지** 규칙 준수: 전부 `shared/ui`에만 둔다.

### 2.2 커스텀 위젯 → `src/widgets/`

| 위젯 | 신규/재설계 | 내용 | 'use client'? |
|---|---|---|---|
| `site-header` | 신규 | 유틸바 + 로고 + 카테고리 메뉴(해외/국내) + 로그인/유저 island. 현 `(site)/layout.tsx` 인라인 헤더 추출·재설계. 모바일 sheet | 메뉴 토글 island만 |
| `site-footer` | 신규 | A1 풋터 | 서버 |
| `home-hero` | 신규 | 히어로 배경 + 통합검색바(`features/search` 래핑) | 서버(검색 island 내부만 client) |
| `home-region-deals` | 신규 | 지역 탭 + 특가 카드 그리드. 탭 전환 시 pre-fetched 데이터 클라이언트 필터 | 탭 필터 island |
| `home-theme-bento` | 신규 | 테마 벤토(정적 프로모션 링크 → `/search?q=`) | 서버 |
| `product-card-list` | 재설계 | 기존 위젯 카드 룩 A1화 | 현행 유지 |

### 2.3 entity UI 재설계

- `src/entities/product/ui/ProductCard.tsx`: A1 카드 룩(이미지+배지+목적지+제목+별점+가격). **서버 컴포넌트 유지**(`'use client'` 금지). 하트 등 인터랙션 필요 시 `shared/ui` island로 분리.

### 2.4 FSD 의존 방향 점검

`app → widgets → features → entities → shared` 단방향 무손상. 신규 위젯은 `entities/product`·`features/search`만 소비, cross-widget import 없음. ✅

### 2.5 헤더 카테고리 (데이터 현실 반영)

- `해외여행` → `/products` (현 시드 상품 전부 해외)
- `국내여행` → `/products?destination=domestic`(또는 전용 라우트). **현재 국내 상품 0건** → 빈 목록 대신 `EmptyState`로 "국내여행 상품 준비 중" 표시. 신규 라우트/카테고리 체계는 본 범위 밖.

---

## 3. 페이지별 변경

`(site)` 전 페이지. **백엔드 무수정, 전부 프론트 restyle/재구성.**

| 페이지 | 성격 | 내용 |
|---|---|---|
| `(site)/layout.tsx` | 재구성 | 인라인 헤더 → `site-header` + `site-footer`. `<main>` 랜드마크·`GlobalRouteProgress` 유지 |
| `(site)/page.tsx` (홈) | **IA 재구성** | `home-hero` → `home-region-deals` → `home-theme-bento`. ISR `revalidate=300` 유지. `getFeaturedProducts(12)` + `getDistinctDestinations()` 주입 |
| `/products` | restyle | A1 카드 그리드, `SortSelect`→shadcn `select`, 지역 필터 칩, 페이지네이션 |
| `/products/[id]` (PDP) | restyle | `product-detail` 위젯 토큰·타이포 적용. **ISR + Suspense 스트리밍·리뷰 island 구조 유지**([ADR-0035]/[ADR-0017]) |
| `/search` | restyle | 결과 카드·검색박스·칩. `useTransition` 스피너 유지 |
| `/compare` | restyle | 비교 표 A1화 |
| `/login` | restyle | shadcn `input`/`button` 폼 |
| `/mypage` | restyle | 예약/위시리스트 카드 A1화 |

### 3.1 데이터 소스 충당 (백엔드 추가 0 확인)

| A1 새 섹션 | 기존 소스 | 추가 |
|---|---|---|
| 히어로 통합검색바 | `features/search`(자연어 AI 검색) | 룩만 A1. 날짜/인원은 시각 요소(검색은 자연어 단일) |
| 지역 탭 | `getDistinctDestinations()` + pre-fetched 특가 | 0 (클라 필터 또는 `/products?destination=` 링크) |
| 특가 카드 | `getFeaturedProducts()` | 0 |
| 테마 벤토 | 정적 링크 → `/search?q=가족여행` 등 | 0 |

### 3.2 불변 보장 (회귀 방지선)

- `entities/**/ui`에 `'use client'` 추가 금지 — 인터랙션은 `shared/ui` island로 분리
- ISR/캐시 정책([ADR-0020])·force-dynamic 도메인 무손상
- 결제·예약·webhook·admin 경로 **일절 미접촉**
- 기존 동작 유지: 검색 `AbortController` cleanup, 위시리스트 `CustomEvent` bus([ADR-0019]), 전역 진행바([ADR-0035]), 접근성 랜드마크

---

## 4. 페이징 & 검증 전략

### 4.1 롤아웃 (접근법 ①: 수평 후 수직, 단계별 독립 PR 가능)

| Phase | 산출물 | 검증 |
|---|---|---|
| **A · 파운데이션** | `globals.css` 토큰 + `tailwind.config` + Pretendard(`next/font/local`) + shadcn init + 프리미티브 9종 | `npm run build` · 기존 화면 무파손(토큰 가산적) |
| **B · 공용 컴포넌트** | `site-header`/`site-footer`, `ProductCard` 재설계, 검색바 래퍼 | typecheck·test · 헤더/푸터 모바일 sheet Playwright |
| **C · 홈** | `home-hero`+`home-region-deals`+`home-theme-bento`, `(site)/page.tsx` 재구성 | 지역탭·검색진입·반응형 Playwright |
| **D · 목록/PDP** | `/products`·`/products/[id]` restyle | ISR·Suspense·리뷰 island 유지 확인 |
| **E · 나머지** | `/search`·`/compare`·`/login`·`/mypage` restyle | 검색 transition·비교·로그인 플로우 |

### 4.2 검증 (QA Engineer — 증거 기반)

- 각 Phase: `npm run typecheck` + `npm run test` + `npm run build` (server-only/클라경계/배럴 변경 → build 필수)
- 런타임: **Playwright 직접 확인** — 홈 로드·지역탭 전환·모바일 햄버거·검색→결과·로그인
- 경계 회귀 1초 점검: `grep -r "use client" src/entities/` → **0건**
- 기존 테스트 스위트 전체 그린 유지(결제·예약·검색 로직 미접촉 → 깨지면 안 됨)

### 4.3 리스크 & 완화

| 리스크 | 완화 |
|---|---|
| shadcn init이 config/css 덮어씀 | init 후 토큰 수동 병합 + build 확인 |
| Pretendard 로딩 최적화 | `next/font/local` 채택(CDN 미사용), 폰트 파일 경로 Phase A 확정 |
| PDP Suspense 경계 파손 | ADR-0035 구조 유지, className만 교체 |
| 모바일 회귀 | 각 Phase Playwright 반응형 뷰포트 확인 |

---

## 5. 범위 밖 (Non-goals)

- `(admin)` 셸 디자인 변경
- 다크 모드 (토큰 구조만 후속 확장 가능하게)
- 신규 카테고리 라우트(호텔/항공/테마), 국내여행 실제 상품 데이터
- 백엔드 쿼리/스키마 변경, 결제·예약 로직
- 날짜/인원 기반 구조화 검색(현 자연어 검색 유지)

---

## 6. 관련 문서

- 시안: `design-mockups/a1-clean.html` (+ 갤러리 `index.html`)
- 영향 ADR: [ADR-0017](PDP ISR)·[ADR-0019](wishlist bus)·[ADR-0020](캐시)·[ADR-0035](진행바/스트리밍) — 모두 **유지** 대상
- 후속: `docs/superpowers/plans/2026-06-09-ui-revamp-a1-clean-blue.md` (writing-plans 산출)
