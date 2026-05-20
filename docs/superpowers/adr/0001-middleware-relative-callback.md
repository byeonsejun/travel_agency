# ADR-0001: Middleware callbackUrl 절대→상대 경로 통일

- **상태**: Accepted
- **결정일**: 2026-05-20
- **영향 범위**: `src/middleware.ts`, `src/app/(site)/login/page.tsx`
- **관련 commit**: `7aeb62f`

## Context (배경)

미인증 사용자가 보호 라우트(`/bookings/*`, `/mypage`)에 접근하면 middleware가 `/login`으로 redirect하며 원래 가려던 경로를 `callbackUrl` 쿼리로 전달한다. 그런데 두 경로의 callbackUrl 형식이 분기되어 있었다:

- **page-level redirect** (예: `/products/[id]/checkout/page.tsx`): `redirect(\`/login?callbackUrl=/products/${id}/checkout...\`)` — **상대 경로**
- **middleware redirect** (`src/middleware.ts`): `url.searchParams.set("callbackUrl", req.nextUrl.href)` — **절대 URL**

login 페이지는 open-redirect 공격 방어를 위해 다음 가드를 가진다:

```ts
const safeCallback = callbackUrl.startsWith("/") ? callbackUrl : "/";
```

middleware가 넘긴 절대 URL (`http://localhost:3000/bookings/xxx`)은 `/`로 시작하지 않아 이 가드에 거부되고, 사용자는 로그인 후 **홈으로 떨어졌다**. 보호 경로를 의도적으로 만들어 둔 의미가 사라지는 데이터 연속성 누수.

## Decision (결정)

middleware가 callbackUrl을 **`pathname + search` 형식의 상대 경로**로 통일.

```ts
const callbackTarget = `${pathname}${req.nextUrl.search}`;
url.searchParams.set("callbackUrl", callbackTarget);
```

## Consequences (결과)

**얻은 것:**
- `/bookings/*`, `/mypage` 미인증 진입 → 로그인 후 원래 경로 정확히 복귀
- page-level redirect와 middleware redirect가 **단일 형식**으로 통일 → login 가드 한 군데 점검만으로 안전성 보장
- open-redirect 가드(`startsWith("/")`) 의미가 살아남 — 외부 도메인 redirect 차단 유지

**포기한 것 / 미해결:**
- 절대 URL이 필요한 미래 use case(예: cross-domain SSO redirect)는 별도 처리 경로 필요 — 현 시점 요건 없음

## Alternatives Considered

### 옵션 A: login 페이지의 `startsWith("/")` 검증 완화
- 절대 URL도 같은 origin이면 허용하도록 host 비교 추가
- **거부 이유**: open-redirect 공격면(`callbackUrl=http://evil.com/...`)을 막는 게이트가 약해진다. host 검증 로직이 늘면 우회 가능성·실수 가능성도 증가.

### 옵션 B: middleware는 절대, page-level은 상대 — 분기 유지
- **거부 이유**: 두 진입점이 같은 login 페이지에서 만나는데 형식이 다르면 가드도 분기 처리해야 하고 회귀 위험이 영구적으로 남는다. "단일 형식"이 invariant로서 더 강력.

## Notes

- 향후 admin 경로 추가 시에도 동일 패턴 유지: `pathname + search` 상대 경로
- curl 검증 (commit message에 결과 첨부):
  - before: `callbackUrl=http%3A%2F%2Flocalhost%3A3000%2Fbookings%2Fsome-id`
  - after : `callbackUrl=%2Fbookings%2Fsome-id`
