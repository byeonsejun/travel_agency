# ADR-0006: PPR-ready layout — Suspense + UserNav 격리

- **상태**: Accepted
- **결정일**: 2026-05-20
- **영향 범위**: `src/app/(site)/layout.tsx`, `src/features/auth/ui/UserNav.tsx`
- **관련 commit**: `feat(layout): PPR-ready site layout` (backfill)

## Context (배경)

Next.js PPR(Partial Prerendering)은 레이아웃의 정적 chrome(header, logo)을 prerender하고, 동적 섬(user section)만 스트리밍으로 채운다. 그런데 `auth()` 는 쿠키를 읽으므로, 이것을 `layout.tsx` 본체에 놓으면 그 layout에 연결된 **모든 라우트가 강제 동적 렌더링**이 된다. PPR opt-in 시점 이전이라도 layout 본체가 정적이어야 캐시 전략 여지가 생긴다.

## Decision (결정)

`auth()` 호출을 `<UserNav />` Server Component 안으로 이동하고, layout에서는 `<Suspense fallback={<UserNavSkeleton />}>` 로 감싼다.

```tsx
// src/app/(site)/layout.tsx
<Suspense fallback={<UserNavSkeleton />}>
  <UserNav />   {/* auth() 호출은 여기서만 */}
</Suspense>
```

layout 본체는 쿠키를 읽지 않으므로 정적 prerender 대상이 된다. 첫 페인트에서 UserNav 위치에 스켈레톤이 보이고, 실제 세션 결과로 swap된다.

## Consequences (결과)

**얻은 것:**
- PPR 활성화 시 `<header>` chrome·logo는 prerender, user section만 스트리밍 — 체감 TTFB 단축.
- layout 자체가 정적이므로 `revalidate` 캐시 정책 적용 가능.
- 인증 상태 UI 로직이 UserNav 한 곳에 집중됨 — 테스트 범위 명확.

**포기한 것 / 미해결:**
- 첫 페인트에서 UserNavSkeleton 노출 (로그인 상태 판별 전 깜빡임).
- PPR이 아직 `experimental` 단계 — Next.js 정식 지원 전까지 효과가 제한적.

## Alternatives Considered (대안)

### 옵션 A: layout.tsx 본체에서 직접 `auth()` 호출
- 가장 직관적이지만, layout이 동적 렌더링으로 강제됨.
- PPR opt-in 라우트에서도 정적 prerender 불가 → 거부.

### 옵션 B: `<UserNav />`를 `'use client'` 컴포넌트로 변경, 클라이언트에서 `useSession()`
- 세션 정보를 hydration 후에야 알 수 있어 첫 페인트 layout shift 더 심함.
- 서버 세션 정보가 HTML에 내려오지 않아 SEO 맥락 손실 가능성.
- Server Component를 Client Component로 다운그레이드 — 원칙 위반 → 거부.

### 옵션 C: 별도 async Server Component(`<SessionChrome />`)로 분리, Suspense 없음
- 옵션 A와 동일하게 layout 렌더링을 동적으로 만듦 — 거부.

## Notes

- Next.js PPR 정식 GA 이후, `experimental_ppr = true` 설정 추가가 다음 스텝.
- UserNavSkeleton의 너비/높이가 실제 UserNav와 정확히 일치해야 CLS 0 유지.
