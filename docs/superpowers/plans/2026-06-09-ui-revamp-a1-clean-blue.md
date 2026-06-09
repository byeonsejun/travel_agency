# UI 전면 개편 — A1 "클린 블루" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `(site)` 공개 셸 전 페이지를 A1 "클린 블루" 디자인으로 전면 개편한다 (shadcn/ui + Pretendard + 라이트 전용, 백엔드 무수정).

**Architecture:** 수평 후 수직 롤아웃. 디자인 토큰(SSOT) → shadcn 프리미티브 + 공용 위젯 → 페이지별 적용. CSS 변수(shadcn HSL)를 `globals.css`에 정의하고 `tailwind.config`가 참조. `entities/**/ui` 순수성(`'use client'` 금지) 유지, 인터랙션은 `shared/ui` island로 격리.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind CSS 3.4, shadcn/ui (Radix), Pretendard (`next/font/local`), Vitest 2, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-09-ui-revamp-a1-clean-blue.md`
**Mockup:** `design-mockups/a1-clean.html`

---

## File Structure

**생성:**
- `components.json` — shadcn 설정
- `src/shared/lib/utils.ts` — `cn()` 헬퍼
- `src/shared/ui/button.tsx`, `card.tsx`, `input.tsx`, `tabs.tsx`, `badge.tsx`, `select.tsx`, `dropdown-menu.tsx`, `sheet.tsx` — shadcn 프리미티브
- `src/app/fonts/PretendardVariable.woff2` — 폰트 파일
- `src/widgets/site-header/{ui/SiteHeader.tsx, ui/MobileNav.tsx, index.ts}`
- `src/widgets/site-footer/{ui/SiteFooter.tsx, index.ts}`
- `src/widgets/home-hero/{ui/HomeHero.tsx, index.ts}`
- `src/widgets/home-region-deals/{ui/HomeRegionDeals.tsx, model/filterByRegion.ts, model/__tests__/filterByRegion.test.ts, index.ts}`
- `src/widgets/home-theme-bento/{ui/HomeThemeBento.tsx, model/themeLinks.ts, model/__tests__/themeLinks.test.ts, index.ts}`

**수정:**
- `tailwind.config.ts`, `src/app/globals.css`, `src/app/layout.tsx`
- `src/app/(site)/layout.tsx`, `src/app/(site)/page.tsx`
- `src/entities/product/ui/ProductCard.tsx`
- `src/widgets/product-card-list/ui/ProductCardList.tsx`
- `src/widgets/product-detail/**`, `src/app/(site)/products/**`, `/search`, `/compare`, `/login`, `/mypage` 관련 위젯/페이지 (restyle)

---

## PHASE A — 파운데이션

### Task A1: 의존성 + cn 유틸

**Files:**
- Create: `src/shared/lib/utils.ts`
- Modify: `package.json` (via npm)

- [ ] **Step 1: shadcn 런타임 의존성 설치**

Run:
```bash
npm i clsx tailwind-merge class-variance-authority tailwindcss-animate lucide-react
```
Expected: 5개 패키지 added, exit 0.

- [ ] **Step 2: `cn()` 유틸 작성**

Create `src/shared/lib/utils.ts`:
```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind 클래스 병합 (조건부 + 충돌 해소). shadcn 표준 헬퍼. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: PASS (에러 0).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/shared/lib/utils.ts
git commit -m "chore(ui): add shadcn runtime deps + cn() util"
```

---

### Task A2: 디자인 토큰 — globals.css + tailwind.config

**Files:**
- Modify: `src/app/globals.css`
- Modify: `tailwind.config.ts`

- [ ] **Step 1: globals.css 에 토큰 + base layer 작성**

Replace `src/app/globals.css` 전체 내용:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 223 14% 10%;
    --card: 0 0% 100%;
    --card-foreground: 223 14% 10%;
    --popover: 0 0% 100%;
    --popover-foreground: 223 14% 10%;
    --primary: 219 100% 53%;
    --primary-foreground: 0 0% 100%;
    --secondary: 218 40% 97%;
    --secondary-foreground: 223 14% 10%;
    --muted: 218 40% 97%;
    --muted-foreground: 220 9% 46%;
    --accent: 218 40% 97%;
    --accent-foreground: 223 14% 10%;
    --destructive: 359 100% 65%;
    --destructive-foreground: 0 0% 100%;
    --border: 220 26% 93%;
    --input: 220 26% 93%;
    --ring: 219 100% 53%;
    --radius: 0.875rem;
  }

  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

- [ ] **Step 2: tailwind.config.ts 에 토큰 매핑 + 플러그인**

Replace `tailwind.config.ts` 전체 내용:
```ts
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1.5rem", screens: { "2xl": "1280px" } },
    extend: {
      fontFamily: {
        sans: ["var(--font-pretendard)", "system-ui", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 4px)",
        sm: "calc(var(--radius) - 6px)",
      },
      boxShadow: {
        card: "0 14px 36px rgba(16,40,90,.12)",
        float: "0 18px 50px rgba(16,40,90,.16)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
```

- [ ] **Step 3: build 로 토큰 컴파일 확인 (기존 화면 무파손)**

Run: `npm run build`
Expected: 빌드 성공. 토큰은 가산적이라 기존 `text-indigo-600` 등 유틸은 그대로 동작. 에러 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css tailwind.config.ts
git commit -m "feat(ui): design tokens (A1 clean-blue) in globals.css + tailwind.config"
```

---

### Task A3: Pretendard 폰트 (next/font/local)

**Files:**
- Create: `src/app/fonts/PretendardVariable.woff2`
- Create: `src/app/fonts.ts`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: 폰트 파일 다운로드**

Run:
```bash
mkdir -p src/app/fonts && curl -L -o src/app/fonts/PretendardVariable.woff2 \
  https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/woff2/PretendardVariable.woff2
```
Expected: 파일 생성. 확인: `ls -la src/app/fonts/PretendardVariable.woff2` → 크기 > 1MB.

- [ ] **Step 2: 폰트 로더 작성**

Create `src/app/fonts.ts`:
```ts
import localFont from "next/font/local";

/** Pretendard Variable — 한글 본문 폰트. CSS 변수 --font-pretendard 로 노출. */
export const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  display: "swap",
  weight: "45 920",
  variable: "--font-pretendard",
});
```

- [ ] **Step 3: layout.tsx 에 폰트 적용**

Modify `src/app/layout.tsx` — `<html>`/`<body>`:
```tsx
import { pretendard } from "./fonts";
// ...
  return (
    <html lang="ko" className={pretendard.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
```
(기존 `getCurrentUser` debug 블록·metadata 는 유지.)

- [ ] **Step 4: build 확인**

Run: `npm run build`
Expected: 성공. `next/font` 가 woff2 를 최적화 번들. 에러 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/fonts.ts src/app/fonts/PretendardVariable.woff2 src/app/layout.tsx
git commit -m "feat(ui): Pretendard via next/font/local"
```

---

### Task A4: shadcn init + components.json

**Files:**
- Create: `components.json`

- [ ] **Step 1: components.json 작성** (CLI init 대신 수동 — 토큰을 이미 작성했으므로 덮어쓰기 방지)

Create `components.json`:
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/app/globals.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/shared/ui",
    "utils": "@/shared/lib/utils",
    "ui": "@/shared/ui",
    "lib": "@/shared/lib",
    "hooks": "@/shared/lib"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 2: tsconfig path alias 확인**

Run: `grep -A3 '"paths"' tsconfig.json`
Expected: `"@/*": ["./src/*"]` 존재. (없으면 추가 후 커밋)

- [ ] **Step 3: Commit**

```bash
git add components.json
git commit -m "chore(ui): shadcn components.json (alias -> @/shared/ui)"
```

---

### Task A5: shadcn 프리미티브 9종 설치

**Files:**
- Create: `src/shared/ui/{button,card,input,tabs,badge,select,dropdown-menu,sheet}.tsx`
- Modify: `src/shared/ui/Skeleton.tsx` (통합 검토)

- [ ] **Step 1: 프리미티브 설치**

Run:
```bash
npx shadcn@latest add button card input tabs badge select dropdown-menu sheet --yes
```
Expected: 8개 컴포넌트가 `src/shared/ui/` 에 생성. Radix 의존성 자동 설치. CLI 가 `globals.css`/`tailwind.config` 추가 변경을 제안하면 **토큰 블록은 건드리지 말고** 필요한 keyframe 만 수용.

- [ ] **Step 2: 설치 위치 확인**

Run: `ls src/shared/ui/*.tsx`
Expected: `button.tsx card.tsx input.tsx tabs.tsx badge.tsx select.tsx dropdown-menu.tsx sheet.tsx` 포함.

- [ ] **Step 3: 버튼/인풋 radius 를 A1(10px)로 미세조정**

`src/shared/ui/button.tsx` 의 base 클래스에서 `rounded-md` → `rounded-[0.625rem]` (또는 `rounded-md` 유지 시 `--radius` 파생 그대로). `input.tsx` 동일. (시안 대조 후 결정 — 미세 조정이라 build 만 통과하면 OK)

- [ ] **Step 4: build + 경계 점검**

Run:
```bash
npm run build
grep -rl "use client" src/entities/ | wc -l
```
Expected: build 성공. entities `use client` = `0`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ui package.json package-lock.json
git commit -m "feat(ui): shadcn primitives (button/card/input/tabs/badge/select/dropdown/sheet)"
```

---

## PHASE B — 공용 컴포넌트

### Task B1: ProductCard 재설계 (A1 카드)

**Files:**
- Modify: `src/entities/product/ui/ProductCard.tsx`

- [ ] **Step 1: 현재 ProductCard 구조 확인**

Run: `cat src/entities/product/ui/ProductCard.tsx`
Expected: props 시그니처(`ProductCardType`)·이미지·가격 표시 방식 파악. **서버 컴포넌트(`'use client'` 없음) 확인.**

- [ ] **Step 2: A1 카드 룩으로 재작성 (서버 컴포넌트 유지)**

`src/entities/product/ui/ProductCard.tsx` 를 shadcn `Card` + A1 스타일로. 핵심 구조 (props 시그니처·`ProductImage` 사용은 기존 유지, className만 교체):
```tsx
// 'use client' 추가 금지 — 서버 컴포넌트
import Link from "next/link";
import { ProductImage } from "./ProductImage";
import type { ProductCard as ProductCardType } from "../model/types";

export function ProductCard({ product }: { product: ProductCardType }) {
  const price = product.lowestPrice ?? product.basePriceAdult;
  return (
    <Link
      href={`/products/${product.id}`}
      className="group block overflow-hidden rounded-lg border border-border bg-card transition-all hover:-translate-y-1 hover:shadow-card"
    >
      <div className="relative h-40 overflow-hidden bg-secondary">
        <ProductImage src={product.heroImageUrl} alt={product.title} />
      </div>
      <div className="p-3.5">
        <p className="text-xs font-bold text-primary">{product.destination}</p>
        <h3 className="mt-1.5 line-clamp-2 h-10 text-sm font-bold leading-snug">{product.title}</h3>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-xl font-extrabold">{price.toLocaleString("ko-KR")}</span>
          <span className="text-xs text-muted-foreground">원~</span>
        </div>
      </div>
    </Link>
  );
}
```
> 주의: 기존 props 모양(`product` 객체 vs 개별 props)·필드명을 Step 1 에서 확인한 실제 시그니처에 맞춰 조정. `ProductImage` 의 실제 props(src/alt) 확인.

- [ ] **Step 3: typecheck + 기존 카드 테스트**

Run: `npm run typecheck && npm run test -- ProductCard`
Expected: PASS (관련 테스트 있으면). 시그니처 변경 시 호출부(`ProductCardList`) 동반 수정.

- [ ] **Step 4: build + 경계 점검**

Run: `npm run build && grep -rc "use client" src/entities/product/ui/ProductCard.tsx`
Expected: build 성공. ProductCard `use client` = `0`.

- [ ] **Step 5: Commit**

```bash
git add src/entities/product/ui/ProductCard.tsx src/widgets/product-card-list
git commit -m "feat(ui): redesign ProductCard (A1 clean-blue, server component)"
```

---

### Task B2: site-footer 위젯

**Files:**
- Create: `src/widgets/site-footer/ui/SiteFooter.tsx`, `src/widgets/site-footer/index.ts`

- [ ] **Step 1: SiteFooter 작성 (서버 컴포넌트)**

Create `src/widgets/site-footer/ui/SiteFooter.tsx`:
```tsx
export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-border bg-secondary py-10 text-sm text-muted-foreground">
      <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-5 px-6">
        <div>
          <b className="text-base text-foreground">Nextour</b>
          <p className="mt-1">AI 기반 맞춤형 패키지 여행 플랫폼</p>
        </div>
        <div className="text-right">
          <p>회사소개 · 이용약관 · 개인정보처리방침</p>
          <p className="mt-1">고객센터 1234-5678</p>
        </div>
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: barrel**

Create `src/widgets/site-footer/index.ts`:
```ts
export { SiteFooter } from "./ui/SiteFooter";
```

- [ ] **Step 3: typecheck + Commit**

Run: `npm run typecheck`
Expected: PASS.
```bash
git add src/widgets/site-footer
git commit -m "feat(ui): site-footer widget"
```

---

### Task B3: site-header 위젯 (반응형 + 모바일 sheet)

**Files:**
- Create: `src/widgets/site-header/ui/SiteHeader.tsx`, `src/widgets/site-header/ui/MobileNav.tsx`, `src/widgets/site-header/index.ts`

- [ ] **Step 1: MobileNav (client island — sheet)**

Create `src/widgets/site-header/ui/MobileNav.tsx`:
```tsx
"use client";
import Link from "next/link";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/shared/ui/sheet";
import { Button } from "@/shared/ui/button";

const LINKS = [
  { href: "/products", label: "해외여행" },
  { href: "/products?destination=domestic", label: "국내여행" },
];

export function MobileNav() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="메뉴 열기">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left">
        <SheetTitle className="text-lg font-bold text-primary">Nextour</SheetTitle>
        <nav className="mt-6 flex flex-col gap-1">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-md px-2 py-3 text-base font-semibold hover:bg-accent">
              {l.label}
            </Link>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: SiteHeader (서버 컴포넌트, 데스크탑 메뉴 + UserNavIsland + MobileNav)**

Create `src/widgets/site-header/ui/SiteHeader.tsx`:
```tsx
import Link from "next/link";
import { Suspense } from "react";
import { UserNavIsland } from "@/features/auth";
import { MobileNav } from "./MobileNav";

const LINKS = [
  { href: "/products", label: "해외여행" },
  { href: "/products?destination=domestic", label: "국내여행" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-6">
        <MobileNav />
        <Link href="/" className="text-2xl font-extrabold tracking-tight text-primary">
          Nextour
        </Link>
        <nav className="hidden gap-7 text-base font-semibold md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="border-b-2 border-transparent py-1 hover:border-primary hover:text-primary">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <Suspense fallback={null}>
            <UserNavIsland />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
```
> `UserNavIsland` 의 실제 export 시그니처를 `cat src/features/auth/index.ts` 로 확인 후 Suspense 필요 여부 판단(현 layout 은 Suspense 없이 사용 중 — 동일하게 맞춰도 됨).

- [ ] **Step 3: barrel**

Create `src/widgets/site-header/index.ts`:
```ts
export { SiteHeader } from "./ui/SiteHeader";
```

- [ ] **Step 4: typecheck + Commit**

Run: `npm run typecheck`
Expected: PASS.
```bash
git add src/widgets/site-header
git commit -m "feat(ui): site-header widget (responsive + mobile sheet)"
```

---

### Task B4: (site)/layout.tsx 에 header/footer 결선

**Files:**
- Modify: `src/app/(site)/layout.tsx`

- [ ] **Step 1: layout 교체**

Replace `src/app/(site)/layout.tsx`:
```tsx
import { Suspense } from "react";
import { SiteHeader } from "@/widgets/site-header";
import { SiteFooter } from "@/widgets/site-footer";
import { GlobalRouteProgress } from "@/shared/ui/GlobalRouteProgress";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <GlobalRouteProgress />
      </Suspense>
      <SiteHeader />
      <main className="min-h-[60vh]">{children}</main>
      <SiteFooter />
    </>
  );
}
```
> `GlobalRouteProgress` 의 Suspense 경계·`<main>` 단일 랜드마크([ADR-0035]) 유지. cookies 의존 0 유지(auth 는 island 내부).

- [ ] **Step 2: build + 런타임 확인 (Playwright)**

Run: `npm run build`
Expected: 성공. dev 서버(`npm run dev`) 후 Playwright 로 `/` 접속 → 헤더 로고·해외/국내 메뉴·풋터 렌더, 모바일 뷰포트(375px)에서 햄버거 → sheet 열림 확인.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(site)/layout.tsx"
git commit -m "feat(ui): wire site-header/footer into (site) layout"
```

---

## PHASE C — 홈 (IA 재구성)

### Task C1: home-theme-bento (테마 링크 — 순수함수 TDD)

**Files:**
- Create: `src/widgets/home-theme-bento/model/themeLinks.ts`, `model/__tests__/themeLinks.test.ts`, `ui/HomeThemeBento.tsx`, `index.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `src/widgets/home-theme-bento/model/__tests__/themeLinks.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { THEME_TILES, buildThemeHref } from "../themeLinks";

describe("themeLinks", () => {
  it("각 테마 타일은 검색 쿼리로 인코딩된 href 를 만든다", () => {
    expect(buildThemeHref("가족여행")).toBe("/search?q=%EA%B0%80%EC%A1%B1%EC%97%AC%ED%96%89");
  });
  it("4개 테마 타일을 제공한다", () => {
    expect(THEME_TILES).toHaveLength(4);
    expect(THEME_TILES.map((t) => t.query)).toEqual(["가족여행", "허니문", "나홀로 여행", "주말 근거리"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test -- themeLinks`
Expected: FAIL ("Cannot find module '../themeLinks'").

- [ ] **Step 3: 구현**

Create `src/widgets/home-theme-bento/model/themeLinks.ts`:
```ts
export type ThemeTile = { label: string; sub: string; query: string; className: string };

export function buildThemeHref(query: string): string {
  return `/search?q=${encodeURIComponent(query)}`;
}

export const THEME_TILES: ThemeTile[] = [
  { sub: "가족과 함께", label: "키즈 동반 추천", query: "가족여행", className: "from-primary to-[#0a4fd6]" },
  { sub: "단둘이", label: "허니문 특집", query: "허니문", className: "from-[#ff7e5f] to-[#ff5470]" },
  { sub: "혼자라서 좋아", label: "나홀로 여행", query: "나홀로 여행", className: "from-[#0fb9b1] to-[#0a8f88]" },
  { sub: "짧고 굵게", label: "주말 근거리", query: "주말 근거리", className: "from-[#8a5cf6] to-[#6d28d9]" },
];
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test -- themeLinks`
Expected: PASS.

- [ ] **Step 5: 벤토 UI (서버 컴포넌트)**

Create `src/widgets/home-theme-bento/ui/HomeThemeBento.tsx`:
```tsx
import Link from "next/link";
import { THEME_TILES, buildThemeHref } from "../model/themeLinks";

export function HomeThemeBento() {
  return (
    <section className="mt-16">
      <h2 className="mb-6 text-2xl font-extrabold tracking-tight">테마별 기획전</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {THEME_TILES.map((t) => (
          <Link
            key={t.query}
            href={buildThemeHref(t.query)}
            className={`flex min-h-[130px] flex-col justify-end rounded-lg bg-gradient-to-br ${t.className} p-6 text-lg font-extrabold text-white`}
          >
            <span className="mb-1 text-sm font-semibold opacity-90">{t.sub}</span>
            {t.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: barrel + Commit**

Create `src/widgets/home-theme-bento/index.ts`:
```ts
export { HomeThemeBento } from "./ui/HomeThemeBento";
```
```bash
git add src/widgets/home-theme-bento
git commit -m "feat(ui): home-theme-bento widget (theme promo links)"
```

---

### Task C2: home-region-deals (지역 탭 + 특가 — 필터 TDD + client island)

**Files:**
- Create: `src/widgets/home-region-deals/model/filterByRegion.ts`, `model/__tests__/filterByRegion.test.ts`, `ui/HomeRegionDeals.tsx`, `index.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `src/widgets/home-region-deals/model/__tests__/filterByRegion.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { filterByDestination, buildRegionTabs } from "../filterByRegion";

type Item = { id: string; destination: string };
const items: Item[] = [
  { id: "a", destination: "일본 · 도쿄" },
  { id: "b", destination: "베트남 · 다낭" },
  { id: "c", destination: "일본 · 오사카" },
];

describe("filterByDestination", () => {
  it("'전체' 는 모든 항목을 반환", () => {
    expect(filterByDestination(items, "전체")).toHaveLength(3);
  });
  it("선택한 destination 라벨로 시작하는 항목만 반환", () => {
    expect(filterByDestination(items, "일본").map((i) => i.id)).toEqual(["a", "c"]);
  });
});

describe("buildRegionTabs", () => {
  it("'전체' 를 맨 앞에 두고 distinct 라벨을 붙인다", () => {
    expect(buildRegionTabs([
      { code: "JP", label: "일본", count: 2 },
      { code: "VN", label: "베트남", count: 1 },
    ])).toEqual(["전체", "일본", "베트남"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test -- filterByRegion`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현**

Create `src/widgets/home-region-deals/model/filterByRegion.ts`:
```ts
export const ALL_TAB = "전체";

/** destination 문자열이 라벨로 시작하면 매칭 ("일본" → "일본 · 도쿄"). */
export function filterByDestination<T extends { destination: string }>(items: T[], label: string): T[] {
  if (label === ALL_TAB) return items;
  return items.filter((i) => i.destination.startsWith(label));
}

export function buildRegionTabs(dests: { label: string }[]): string[] {
  const labels = Array.from(new Set(dests.map((d) => d.label)));
  return [ALL_TAB, ...labels];
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test -- filterByRegion`
Expected: PASS.

- [ ] **Step 5: 지역탭 UI (client island — shadcn Tabs + 클라 필터)**

Create `src/widgets/home-region-deals/ui/HomeRegionDeals.tsx`:
```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { ProductCard } from "@/entities/product";
import type { ProductCardType } from "@/entities/product";
import { filterByDestination, buildRegionTabs, ALL_TAB } from "../model/filterByRegion";

export function HomeRegionDeals({
  items,
  destinations,
}: {
  items: ProductCardType[];
  destinations: { label: string }[];
}) {
  const tabs = buildRegionTabs(destinations);
  const [active, setActive] = useState(ALL_TAB);
  const shown = filterByDestination(items, active).slice(0, 8);

  return (
    <section className="mt-16">
      <div className="mb-5 flex items-baseline">
        <h2 className="text-2xl font-extrabold tracking-tight">지금 떠나기 좋은 특가</h2>
        <Link href="/products" className="ml-auto text-sm font-semibold text-muted-foreground hover:text-primary">
          전체보기 ›
        </Link>
      </div>
      <Tabs value={active} onValueChange={setActive} className="mb-6">
        <TabsList className="flex-wrap">
          {tabs.map((t) => (
            <TabsTrigger key={t} value={t}>{t}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
        {shown.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
```
> `ProductCard` props 모양은 Task B1 에서 확정된 시그니처에 맞춤. `ProductCardType` export 가 barrel 에 있는지 확인(`@/entities/product` index 에 존재함).

- [ ] **Step 6: barrel + typecheck + Commit**

Create `src/widgets/home-region-deals/index.ts`:
```ts
export { HomeRegionDeals } from "./ui/HomeRegionDeals";
```
Run: `npm run typecheck && npm run test -- filterByRegion`
Expected: PASS.
```bash
git add src/widgets/home-region-deals
git commit -m "feat(ui): home-region-deals widget (region tabs + deals grid)"
```

---

### Task C3: home-hero (히어로 + 검색바)

**Files:**
- Create: `src/widgets/home-hero/ui/HomeHero.tsx`, `index.ts`

- [ ] **Step 1: 기존 검색 feature 확인**

Run: `cat src/features/search/index.ts`
Expected: `SearchBox`, `SearchChips` export 확인(현 홈에서 사용 중).

- [ ] **Step 2: HomeHero 작성 (서버 컴포넌트, 검색 island 래핑)**

Create `src/widgets/home-hero/ui/HomeHero.tsx`:
```tsx
import { SearchBox, SearchChips } from "@/features/search";

export function HomeHero() {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-secondary">
      <div className="relative z-10 px-6 py-16 text-center md:py-24">
        <h1 className="text-3xl font-extrabold leading-tight tracking-tight md:text-5xl">
          조건에 딱 맞는 여행을<br />AI가 찾아드립니다
        </h1>
        <p className="mt-4 text-base text-muted-foreground md:text-lg">
          목적지·날짜·인원만 입력하면, 나머지는 Nextour가.
        </p>
        <div className="mx-auto mt-8 max-w-2xl">
          <div className="rounded-2xl bg-card p-3 shadow-float">
            <SearchBox />
          </div>
          <div className="mt-4 flex justify-center">
            <SearchChips />
          </div>
        </div>
      </div>
    </section>
  );
}
```
> 날짜/인원은 A1 의 시각 요소 — 검색은 기존 자연어 `SearchBox` 단일 유지(spec §3.1). 추후 필요 시 확장.

- [ ] **Step 3: barrel + typecheck + Commit**

Create `src/widgets/home-hero/index.ts`:
```ts
export { HomeHero } from "./ui/HomeHero";
```
Run: `npm run typecheck`
Expected: PASS.
```bash
git add src/widgets/home-hero
git commit -m "feat(ui): home-hero widget (hero + search entry)"
```

---

### Task C4: 홈 페이지 조립

**Files:**
- Modify: `src/app/(site)/page.tsx`

- [ ] **Step 1: page.tsx 재구성**

Replace `src/app/(site)/page.tsx`:
```tsx
import { getFeaturedProducts, getDistinctDestinations } from "@/entities/product";
import { HomeHero } from "@/widgets/home-hero";
import { HomeRegionDeals } from "@/widgets/home-region-deals";
import { HomeThemeBento } from "@/widgets/home-theme-bento";

// ISR: 추천/목적지는 변동 빈도가 낮아 5분 캐시. unstable_cache 가 DB hit 압축.
export const revalidate = 300;

export default async function HomePage() {
  const [featured, destinations] = await Promise.all([
    getFeaturedProducts(12),
    getDistinctDestinations(),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <HomeHero />
      <HomeRegionDeals items={featured} destinations={destinations} />
      <HomeThemeBento />
    </div>
  );
}
```
> `getDistinctDestinations()` 는 `{code,label,count}[]` 반환 — `HomeRegionDeals` 의 `destinations` prop(`{label}` 만 사용)과 구조적 호환. 독립 쿼리 2개는 `Promise.all` 병렬(CLAUDE.md §6).

- [ ] **Step 2: build + 런타임(Playwright)**

Run: `npm run build`
Expected: 홈 `●`(ISR) 또는 `ƒ` 유지, 성공. dev 서버 후 Playwright:
- `/` 접속 → 히어로/검색/지역탭/특가카드/테마벤토 렌더
- 지역탭 "일본" 클릭 → 일본 상품만 필터
- 테마 "허니문" 타일 클릭 → `/search?q=...` 이동
- 모바일 375px → 카드 2열, 벤토 2열

- [ ] **Step 3: Commit**

```bash
git add "src/app/(site)/page.tsx"
git commit -m "feat(ui): rebuild home with A1 IA (hero/region-deals/theme-bento)"
```

---

## PHASE D — 목록 / PDP

### Task D1: /products 리스트 restyle

**Files:**
- Modify: `src/app/(site)/products/page.tsx` 및 관련 위젯(`ProductCardList`, `SortSelect`, `ProductFilterBar`, `Pagination`)

- [ ] **Step 1: 현재 products 페이지·위젯 구조 확인**

Run:
```bash
cat "src/app/(site)/products/page.tsx"
ls src/widgets/product-card-list/ui src/features/*/ui 2>/dev/null | head -40
```
Expected: 어떤 위젯/feature 가 리스트·정렬·필터·페이지네이션을 렌더하는지 파악.

- [ ] **Step 2: SortSelect 를 shadcn select 로 교체**

해당 컴포넌트(`'use client'` 정렬 select)를 `@/shared/ui/select` 기반으로 교체. `router.push`+`useTransition` 의 `isPending` 스피너 로직([ADR-0035] 역할분담) **유지**, 마크업만 shadcn 화.

- [ ] **Step 3: 카드 그리드·필터칩·페이지네이션 className A1 화**

`ProductCardList` 그리드를 `grid grid-cols-2 gap-5 md:grid-cols-4` 로, 필터칩을 `rounded-full border` 스타일로, 페이지네이션 버튼을 shadcn `Button variant="outline"` 로. 빈 상태는 기존 `EmptyState` 사용 — `?destination=domestic` 처럼 결과 0건이면 "국내여행 상품 준비 중" 류 메시지(spec §2.5).

- [ ] **Step 4: typecheck + test + build + Playwright**

Run: `npm run typecheck && npm run test && npm run build`
Expected: PASS. Playwright: `/products` 카드 그리드·정렬 변경 스피너·페이지 이동·`?destination=domestic` 빈상태.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(site)/products" src/widgets/product-card-list src/features
git commit -m "feat(ui): restyle /products list (A1 grid/sort/filter/pagination)"
```

---

### Task D2: /products/[id] PDP restyle

**Files:**
- Modify: `src/widgets/product-detail/**` 및 `src/app/(site)/products/[id]/**`

- [ ] **Step 1: PDP 구조·Suspense 경계 확인**

Run:
```bash
ls -R src/widgets/product-detail
sed -n '1,60p' "src/app/(site)/products/[id]/page.tsx"
```
Expected: 히어로/가격/일정/포함/리뷰 섹션 구성, Suspense 스트리밍·리뷰 island([ADR-0017]/[ADR-0035]) 위치 파악.

- [ ] **Step 2: 섹션별 className A1 적용 (구조·Suspense 불변)**

`product-detail` 위젯의 각 섹션을 토큰 기반 클래스로 교체:
- 히어로 이미지 컨테이너, 가격 박스 → `rounded-lg border shadow-card`
- 예약 CTA → shadcn `Button`
- 포함/불포함·일정 타이포 → `text-foreground`/`text-muted-foreground`
- **Suspense 경계·`'use client'` island 위치·스트리밍 구조는 절대 변경 금지** (className 만 교체)

- [ ] **Step 3: typecheck + test + build**

Run: `npm run typecheck && npm run test && npm run build`
Expected: PASS. PDP 가 `●`(ISR) 유지(`ƒ` 로 강등되면 Suspense/dynamic 회귀 — 점검).

- [ ] **Step 4: Playwright 런타임**

dev 서버 후 PDP 접속 → 히어로·가격·일정·리뷰 렌더, 리뷰 "더보기" island 동작, 위시리스트 하트 island 동작([ADR-0018]) 확인.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(site)/products" src/widgets/product-detail
git commit -m "feat(ui): restyle PDP (A1, ISR/Suspense/island preserved)"
```

---

## PHASE E — 나머지 페이지

### Task E1: /search restyle

**Files:**
- Modify: `src/app/(site)/search/page.tsx` 및 검색 결과 위젯/feature

- [ ] **Step 1: 구조 확인**

Run: `cat "src/app/(site)/search/page.tsx" && cat src/features/search/index.ts`
Expected: 결과 렌더·`useTransition` 스피너 위치 파악.

- [ ] **Step 2: 검색박스·칩·결과카드 A1 화**

검색박스를 히어로와 동일 톤(`shadow-float` 카드)으로, 결과 카드는 `ProductCard`(B1) 재사용, 칩은 `rounded-full`. `useTransition` 스피너 로직 유지.

- [ ] **Step 3: typecheck + build + Playwright + Commit**

Run: `npm run typecheck && npm run build`
Expected: PASS. Playwright: 검색어 입력 → 결과·스피너. 
```bash
git add "src/app/(site)/search" src/features/search
git commit -m "feat(ui): restyle /search (A1)"
```

---

### Task E2: /compare restyle

**Files:**
- Modify: `src/app/(site)/compare/page.tsx`, `src/widgets/product-compare-table/**`

- [ ] **Step 1: 구조 확인**

Run: `ls src/widgets/product-compare-table/ui && cat "src/app/(site)/compare/page.tsx"`

- [ ] **Step 2: 비교 표 A1 화**

표 헤더/행을 `border-border`·`bg-secondary` 헤더·가격 강조(`font-extrabold`)로. 모바일 가로 스크롤 컨테이너 유지/추가.

- [ ] **Step 3: typecheck + build + Commit**

Run: `npm run typecheck && npm run build`
Expected: PASS.
```bash
git add "src/app/(site)/compare" src/widgets/product-compare-table
git commit -m "feat(ui): restyle /compare table (A1)"
```

---

### Task E3: /login restyle

**Files:**
- Modify: `src/app/(site)/login/page.tsx` 및 로그인 폼 컴포넌트

- [ ] **Step 1: 구조 확인**

Run: `cat "src/app/(site)/login/page.tsx"`
Expected: 매직링크/credentials 폼 위치 파악.

- [ ] **Step 2: shadcn Input/Button 폼**

폼을 중앙 `Card` 안에 배치, `@/shared/ui/input`·`button` 사용. 라벨·에러 메시지 토큰 색(`text-destructive`). 폼 제출 로직(Server Action/island) **불변**.

- [ ] **Step 3: typecheck + build + Playwright(로그인 진입) + Commit**

Run: `npm run typecheck && npm run build`
Expected: PASS.
```bash
git add "src/app/(site)/login"
git commit -m "feat(ui): restyle /login (A1)"
```

---

### Task E4: /mypage restyle

**Files:**
- Modify: `src/app/(site)/mypage/page.tsx`, `src/widgets/booking-list/**`, `src/widgets/wishlist-list/**`

- [ ] **Step 1: 구조 확인**

Run: `cat "src/app/(site)/mypage/page.tsx" && ls src/widgets/booking-list/ui src/widgets/wishlist-list/ui`

- [ ] **Step 2: 예약/위시리스트 카드 A1 화**

booking/wishlist 항목을 `Card` + 토큰 클래스로. 상태 배지는 shadcn `Badge`. 위시리스트 `CustomEvent` bus([ADR-0019])·island 로직 **불변**.

- [ ] **Step 3: typecheck + test + build + Playwright + Commit**

Run: `npm run typecheck && npm run test && npm run build`
Expected: PASS. Playwright: 마이페이지 예약 목록·위시리스트 토글.
```bash
git add "src/app/(site)/mypage" src/widgets/booking-list src/widgets/wishlist-list
git commit -m "feat(ui): restyle /mypage (A1)"
```

---

## 최종 종합 검증

- [ ] **전체 스위트 그린**

Run: `npm run typecheck && npm run test && npm run lint && npm run build`
Expected: 전부 PASS. 결제·예약·검색 로직 미접촉이므로 기존 테스트 회귀 0.

- [ ] **FSD 경계 회귀 점검**

Run: `grep -rl "use client" src/entities/`
Expected: 출력 0건 (entity UI 순수성 유지).

- [ ] **불변 도메인 미접촉 확인**

Run: `git diff --name-only main | grep -E "payment|booking|webhook|cron|admin|refund" || echo "안전 도메인 미접촉 OK"`
Expected: "안전 도메인 미접촉 OK" (또는 의도된 파일만).

- [ ] **Playwright 골든패스 종합**

홈 → 검색 → 결과 → PDP → (위시리스트/비교) → 로그인 → 마이페이지 전 구간 A1 렌더·반응형(375/768/1280px) 확인.

- [ ] **plan 체크박스 갱신 확인 후 PR**

Run: `git diff docs/superpowers/plans/2026-06-09-ui-revamp-a1-clean-blue.md | grep '\[x\]' | head`
Expected: 완료 태스크가 `[x]` 반영됨. 이후 PR 생성(`feat/ui-revamp-a1-clean-blue` → main).
