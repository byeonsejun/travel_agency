# 인증 모듈 설계 (M-AUTH)

> **버전**: v2.0 (Revised — 기존 구현 반영)
> **작성일**: 2026-05-13
> **상위 문서**: [Phase 2 Roadmap](./2026-05-13-phase2-roadmap.md)
> **마일스톤**: M1 (Phase 2의 첫 번째 모듈)
> **적용 스킬**: `enforce-fsd`, `clean-code-react`

## 0. 범위 및 비범위

### 범위 (이 spec)
- **기존 구현 통합·정비**: NextAuth.js v5 + Resend 매직링크 + Kakao OAuth(옵셔널) + Prisma Adapter
- **세션 전략**: 데이터베이스 세션(`session.strategy = "database"`) — 이미 결정됨
- 로컬 개발 환경용 **이메일 콘솔 폴백**(RESEND_API_KEY 미설정 시 매직링크를 콘솔에 출력)
- `entities/user/api/queries.ts` 신설 — `getCurrentUser()`, `getUserById()` 등 RSC 헬퍼
- `app/(site)/login/error/page.tsx` 신설 — auth 설정에서 참조하나 미구현
- `middleware.ts` 신설 — `/account/*`, `/bookings/*` 보호 라우트 사전 정의
- 헤더 영역 인증 상태 표시 + 로그아웃 (간단 UI)
- `.env.example` 작성 + 필수 env 정의
- 시드 사용자 2명 추가 (`prisma/seed.ts` 확장)

### 비범위 (별도 작업)
- 이메일+비밀번호 Credentials 인증 — 본 spec v1.0에서 다뤘으나 매직링크 채택으로 폐기
- 카카오 외 소셜 로그인(구글·애플) — Phase 3
- 이메일 인증(`emailVerified` 명시적 검증 플로우) — 매직링크 클릭이 곧 인증
- 2FA / 패스키 — Phase 3
- `PassportProfile` CRUD — booking 모듈
- 어드민 UI / `UserRole.ADMIN` 권한 분리 — 어드민 spec
- rate limiting / brute-force 방어 — M-OBS / 인프라 spec
- 회원가입 폼 — 매직링크는 첫 로그인 시 자동 가입(NextAuth 기본 동작), 별도 가입 UI 불필요

## 1. 현재 구현 인벤토리

### 이미 작성된 파일 (유지)
| 파일 | 상태 |
|------|------|
| `src/features/auth/server/auth.ts` | ✅ NextAuth 인스턴스 (Resend + Kakao) |
| `src/app/api/auth/[...nextauth]/route.ts` | ✅ NextAuth 핸들러 |
| `src/app/(site)/login/page.tsx` | ✅ 로그인 폼 (Resend + Kakao 버튼) |
| `src/app/(site)/login/verify/page.tsx` | ✅ "이메일 확인" 안내 페이지 |
| `src/entities/user/model/types.ts` | ✅ `SafeUser`, `UserWithProfile` |
| `src/entities/user/model/schema.ts` | ✅ `passportProfileSchema`, `updateProfileSchema` |
| `src/entities/user/model/constants.ts` | ✅ `USER_ROLE_LABEL`, `GENDER_LABEL` |
| `src/entities/user/index.ts` | ✅ barrel |
| `src/shared/lib/db.ts` | ✅ Prisma client |
| `src/shared/lib/env.ts` | ✅ env 파서 (가정 — 확인 후 보완) |

### 신규 작성 또는 보완 (이 spec 범위)
| 파일 | 역할 |
|------|------|
| `src/entities/user/api/queries.ts` | `getCurrentUser()`, `getUserById()` (RSC 전용) |
| `src/entities/user/api/__tests__/queries.test.ts` | 모킹 기반 단위 테스트 |
| `src/entities/user/index.ts` (수정) | 신규 query 함수 re-export |
| `src/features/auth/server/auth.ts` (수정) | Resend `sendVerificationRequest` override — 콘솔 폴백 |
| `src/shared/lib/logger.ts` | 구조화 로그 헬퍼 (M-OBS 전조) |
| `src/shared/lib/env.ts` (보강) | `AUTH_SECRET`, `AUTH_URL`, `RESEND_API_KEY` 필수성 정의 |
| `src/app/(site)/login/error/page.tsx` | 인증 에러 페이지 |
| `src/widgets/site-header/ui/UserMenu.tsx` | (선택) 헤더 우상단 로그인 상태 표시·로그아웃 |
| `src/middleware.ts` | 보호 라우트 매처 + auth 검사 |
| `.env.example` | 환경변수 템플릿 |
| `prisma/seed.ts` (수정) | 검증용 User 2명 추가 |

> ⚠️ `entities/user/api/queries.ts` 신설은 FSD 관점에서 중요. 현재 `auth()`를 직접 호출하는 코드가 흩어질 위험이 있으므로, 모든 RSC는 `entities/user`의 헬퍼만 사용하도록 강제.

## 2. 데이터 모델

User 모델은 기존 그대로(`passwordHash` 추가 **불필요** — 매직링크). 변경 없음.

Account, Session, VerificationToken은 NextAuth 표준 그대로 유지. PrismaAdapter가 자동 관리.

## 3. 인증 흐름

### 3.1 매직링크 (원본 탭 폴링 + 새 탭 분리)

UX 원칙: 사용자가 매직링크를 클릭한 후 **원본 탭이 자동으로 인증을 감지**하여 원래 가려던 페이지로 이동한다. 새 탭은 메인 앱을 렌더링하지 않고 "창을 닫으세요" 안내만 표시한다.

```
[원본 탭] /login?callbackUrl=/foo → 이메일 입력 → submit
   ↓ (server action)
[Server] signIn("resend", {
           email,
           redirect: false,
           redirectTo: "/login/success?callbackUrl=/foo",
         })
   ↓
[NextAuth] Resend.sendVerificationRequest 호출
   - production: Resend API → 사용자 메일함
   - dev/test: 콘솔 폴백 (NODE_ENV !== "production")
   ↓
[Server] redirect("/login/verify?callbackUrl=/foo&email=...")
[원본 탭] /login/verify 렌더 + <SessionPoll /> 활성화
   - 2.5초마다 /api/auth/session GET
   - 응답에 user 있으면 router.replace(callbackUrl) + router.refresh()

[사용자] 메일/콘솔의 매직링크 클릭 → 새 탭 열림

[새 탭] /api/auth/callback/resend?token=... 도착
   ↓ (NextAuth)
[새 탭] User 조회/생성 + Session 발급 (cookie set, 동일 출처라 원본 탭과 공유)
   ↓ (NextAuth redirectTo)
[새 탭] /login/success?callbackUrl=/foo 렌더
   - 0.6초 후 window.close() 시도
   - 차단 시 "창을 직접 닫으세요" + /foo로 가는 링크 노출

[원본 탭] 다음 폴링에서 세션 감지 → /foo로 자동 이동
```

**보안**: `callbackUrl`은 항상 `/`로 시작하는지 검사하여 open redirect를 차단(외부 URL이면 `/`로 폴백). 검증은 RSC에서 한 번 수행하고 props로 전달.

**컴포넌트 위치 (FSD)**:
- `features/auth/ui/SessionPoll.tsx` (`'use client'`) — 폴링 로직
- `features/auth/ui/AuthSuccessClient.tsx` (`'use client'`) — `window.close()` + 폴백 UI
- `app/(site)/login/verify/page.tsx` (RSC) — `SessionPoll` 컴포지션
- `app/(site)/login/success/page.tsx` (RSC) — `AuthSuccessClient` 컴포지션

### 3.2 Kakao
```
[Client] /login → "카카오로 로그인" → submit
   ↓
signIn("kakao", { redirectTo })
   ↓
[Kakao OAuth] 인가 → 콜백
   ↓
[NextAuth] User + Account 자동 생성 또는 매칭
   ↓
[Client] redirectTo
```

> Kakao provider는 `AUTH_KAKAO_ID` + `AUTH_KAKAO_SECRET`이 env에 있을 때만 활성. 없으면 폼에 버튼이 노출되지 않음(`hasKakao` 분기).

### 3.3 로그아웃
- 헤더 우상단 `<UserMenu>` (client component) 또는 form action으로 `signOut({ redirectTo: "/" })`.

## 4. 콘솔 폴백 (로컬 개발)

**조건**: `env.NODE_ENV !== "production"` (즉 development/test). API 키 존재 여부와 무관하게 콘솔 폴백을 우선 적용한다.

**근거**: 개발자가 실수로 production 테스트용 Resend API 키를 `.env.local`에 넣어두면 dev 서버에서 외부 발송이 발생하고, 테스트 키 제한에 걸려 403 오류가 난다. 로컬 환경의 외부 부작용을 0으로 만들기 위해 `NODE_ENV`만 기준으로 분기한다.

```ts
const useDevConsoleFallback = env.NODE_ENV !== "production";

Resend({
  apiKey: env.RESEND_API_KEY ?? "DEV_ONLY",
  from: env.RESEND_FROM_EMAIL ?? "Nextour <noreply@nextour.example>",
  ...(useDevConsoleFallback
    ? {
        async sendVerificationRequest({ identifier, url }) {
          logger.info("auth.magiclink.dev", { email: identifier, url });
          console.log(`\n📧 [DEV] Magic link for ${identifier}:\n${url}\n`);
        },
      }
    : {}),
})
```

`production`에서는 spread가 빈 객체가 되어 NextAuth Resend provider의 기본 동작(api.resend.com 호출)이 그대로 적용된다.

**로컬에서 사용자 흐름**:
1. `/login`에서 이메일 입력 → submit
2. `/login/verify`로 이동
3. 터미널에서 매직링크 URL 복사 → 브라우저 새 탭에 붙여넣기
4. 로그인 완료

## 5. RSC 헬퍼 (entities/user/api/queries.ts)

```ts
// 모든 RSC 페이지는 이 함수만 호출. auth() 직접 호출 금지.
export async function getCurrentUser(): Promise<SafeUser | null>;

// 특정 사용자 조회 (booking 모듈 등에서 사용)
export async function getUserById(id: string): Promise<SafeUser | null>;
```

`SafeUser` 타입은 이미 `entities/user/model/types.ts`에 정의됨 (`Pick<User, "id" | "name" | "email" | "image" | "role">`).

### 사용 예 (RSC):
```tsx
import { getCurrentUser } from "@/entities/user";

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) return <GuestView />;
  return <MemberView user={user} />;
}
```

## 6. 보호 라우트 (middleware.ts)

```ts
import { auth } from "@/features/auth/server/auth";

export default auth((req) => {
  const isProtected =
    req.nextUrl.pathname.startsWith("/account") ||
    req.nextUrl.pathname.startsWith("/bookings");
  if (isProtected && !req.auth) {
    const url = new URL("/login", req.url);
    url.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return Response.redirect(url);
  }
});

export const config = {
  matcher: ["/account/:path*", "/bookings/:path*"],
};
```

**근거**: `/account`·`/bookings`는 M-AUTH MVP에서 아직 없지만, matcher만 선제 정의해서 후속 모듈이 즉시 활용 가능.

## 7. 페이지 UI

### 기존 페이지 (수정 없음 또는 미세 조정)
- `/login` — 이미 RSC + server action 형태. 그대로 유지.
- `/login/verify` — 그대로 유지.

### 신규 페이지
- `/login/error` — NextAuth 에러 코드(`Configuration`, `AccessDenied`, `Verification`, `Default`)별 메시지 매핑. "로그인으로 돌아가기" 링크.

### 헤더 통합 (선택적)
현재 헤더가 어디에 있는지 확인 필요. 만약 `app/(site)/layout.tsx`에 헤더가 있다면 `UserMenu` 위젯을 우상단에 추가. 없다면 본 spec에서는 보류하고 별도 widget spec으로 이연.

## 8. 환경 변수

`.env.example`:
```
# Auth
AUTH_SECRET=                      # openssl rand -base64 32
AUTH_URL=http://localhost:3000

# Resend (이메일 매직링크)
RESEND_API_KEY=                   # 비워두면 로컬에서 콘솔 폴백
RESEND_FROM_EMAIL=Nextour <noreply@nextour.example>

# Kakao OAuth (선택)
AUTH_KAKAO_ID=
AUTH_KAKAO_SECRET=

# Database
DATABASE_URL=
DIRECT_URL=
```

`shared/lib/env.ts`:
```ts
// zod 기반 env 파서. 필수/선택 명시.
const Env = z.object({
  AUTH_SECRET: z.string().min(32),
  AUTH_URL: z.string().url(),
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  AUTH_KAKAO_ID: z.string().optional(),
  AUTH_KAKAO_SECRET: z.string().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});
export const env = Env.parse(process.env);
```

## 9. 에러 처리

| 상황 | 동작 |
|------|------|
| 매직링크 만료 (24h 기본) | `/login/error?error=Verification` → "링크가 만료되었습니다. 다시 시도해 주세요" |
| Resend API 실패 | `/login/error?error=Default` → "메일 발송에 실패했습니다" |
| Kakao 인증 거부 | `/login/error?error=AccessDenied` → "카카오 로그인이 취소되었습니다" |
| OAuthAccountNotLinked | 이미 다른 방식으로 가입된 이메일 → 안내 메시지 |
| 환경변수 누락 | env.ts 파싱 단계에서 즉시 throw → 서버 부팅 실패 |

## 10. 테스트 전략

| 대상 | 종류 | 위치 |
|------|------|------|
| `getCurrentUser()` 모킹 | 단위 | `entities/user/api/__tests__/queries.test.ts` — auth() 모킹, session 유무 분기 |
| `getUserById()` | 단위 | 동일 파일 — DB 모킹 |
| 매직링크 흐름 | 수동 | 로컬에서 콘솔 출력 확인 + 클릭 → 세션 생성 |
| Kakao 흐름 | 수동 | AUTH_KAKAO_* env 설정 시에만 |
| middleware 보호 | 수동 | `/account/foo`(존재하지 않음) → /login 리다이렉트 확인 |

순수 함수가 적어 자동화 테스트 비중 작음. 수동 검증 체크리스트가 중요.

## 11. 시드 데이터

`prisma/seed.ts`에 사용자 2명 추가 (FK 역순 삭제 목록에 `account`, `session`, `verificationToken`, `user` 추가):

```ts
await prisma.$transaction([
  prisma.session.deleteMany(),
  prisma.account.deleteMany(),
  prisma.verificationToken.deleteMany(),
  // ... 기존 삭제들
  prisma.user.deleteMany(),
]);

const customer = await prisma.user.create({
  data: {
    email: "customer@nextour.test",
    name: "테스트 고객",
    role: "CUSTOMER",
    emailVerified: new Date(),
  },
});
const admin = await prisma.user.create({
  data: {
    email: "admin@nextour.test",
    name: "테스트 관리자",
    role: "ADMIN",
    emailVerified: new Date(),
  },
});
```

> 매직링크 방식이라 비밀번호 시드 불필요. 로컬에서 위 이메일로 로그인 시도 → 콘솔에 매직링크 출력 → 클릭하면 즉시 로그인.

## 12. 보안 체크리스트

- [x] AUTH_SECRET 32바이트 이상 (zod로 강제)
- [x] HTTPS 전제(쿠키 secure — NextAuth 기본)
- [x] CSRF — NextAuth 내장
- [x] 매직링크 TTL — NextAuth 기본 24시간
- [x] 이메일 enumeration 방어 — Resend 발송 결과 노출하지 않음
- [x] OAuthAccountNotLinked 명확 안내 (중복 이메일 우회 차단)
- [ ] rate limiting — 인프라 / M-OBS spec
- [ ] 콘솔 폴백이 production에서 비활성 — env.NODE_ENV 검사 필수

## 13. 후속 plan 구성 (예상)

`plans/2026-05-13-auth.md`로 **약 12개 태스크**:

1. `shared/lib/env.ts` 보강 + `.env.example`
2. `shared/lib/logger.ts` 구조화 로거
3. `auth.ts`에 `sendVerificationRequest` 콘솔 폴백 추가
4. `entities/user/api/queries.ts` — `getCurrentUser`, `getUserById`
5. `entities/user/api/__tests__/queries.test.ts` — 모킹 단위 테스트 (TDD)
6. `entities/user/index.ts` 업데이트 — 신규 함수 export
7. `app/(site)/login/error/page.tsx` 신설
8. `middleware.ts` 신설
9. `prisma/seed.ts` — User 2명 추가, 삭제 트랜잭션 보강
10. (선택) `widgets/site-header/ui/UserMenu.tsx` — 헤더 영역 있을 때만
11. typecheck + test 전체 통과
12. 수동 검증 체크리스트 — 매직링크 콘솔 폴백, 보호 라우트 리다이렉트, 시드 사용자 로그인

## 14. 미결정 / 가정

- **헤더 통합**: 현재 헤더가 어디에 있는지 plan 시작 시 코드 탐색하여 결정. 없으면 본 모듈에서 보류.
- **에러 페이지 디자인**: 기본 텍스트 + Tailwind 카드 스타일. 토스트 라이브러리 미도입.
- **로그아웃 위치**: UserMenu 안에. 별도 페이지 없음.
- **Resend 운영 발송**: 현재 NextAuth Resend provider 기본 동작에 위임. 커스텀 템플릿은 Phase 3.

## 15. 수동 검증 체크리스트 (구현 완료 후)

- [ ] `.env.local`에 `AUTH_SECRET` + `DATABASE_URL`만 설정한 상태에서 `npm run dev` 부팅 성공
- [ ] `/login`에서 이메일 입력 → 콘솔에 매직링크 URL 출력 확인
- [ ] 매직링크 클릭 → 자동 로그인 → 홈 리다이렉트
- [ ] 시드 사용자 `customer@nextour.test`로 로그인 가능
- [ ] `/account/foo` 또는 `/bookings/foo` 비로그인 접근 → `/login?callbackUrl=...`로 리다이렉트
- [ ] 로그인 상태에서 `/account/foo` 접근 시 (해당 페이지 없으므로 404지만) middleware는 통과
- [ ] `getCurrentUser()` 호출 결과 — 로그인 시 `SafeUser`, 비로그인 시 `null`
- [ ] `RESEND_API_KEY` 설정 시 운영 발송 동작 (선택, 별도 환경에서)
- [ ] `npm run typecheck` 통과
- [ ] `npm run test` 통과
