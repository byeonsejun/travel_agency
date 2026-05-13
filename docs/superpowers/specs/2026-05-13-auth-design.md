# 인증 모듈 설계 (M-AUTH)

> **버전**: v1.0
> **작성일**: 2026-05-13
> **상위 문서**: [Phase 2 Roadmap](./2026-05-13-phase2-roadmap.md), [ARCHITECTURE](../../technical/ARCHITECTURE.md)
> **마일스톤**: M1 (Phase 2의 첫 번째 모듈)
> **적용 스킬**: `enforce-fsd`, `clean-code-react`

## 0. 범위 및 비범위

### 범위 (이 spec)
- 이메일+비밀번호 회원가입·로그인·로그아웃
- NextAuth.js v5(Auth.js) + Prisma Adapter + Credentials Provider
- 세션 전략: **데이터베이스 세션**(JWT 미사용)
- `/login`, `/signup`, `/forgot-password`, `/reset-password` 페이지
- RSC용 `getCurrentUser()` 헬퍼
- 미들웨어 기반 보호 라우트 패턴 (`/account/*`, `/bookings/*` 등 향후 확장 지점)
- 비밀번호 재설정(토큰 발급 — 이메일 발송은 **콘솔 로그로 대체**)
- 회원가입·로그인 폼 zod 검증 + 에러 표시
- `entities/user` slice 신설 (model/api/ui)

### 비범위 (별도 작업)
- 소셜 로그인(카카오·구글) — Phase 3
- 이메일 발송 인프라(SendGrid/SES) — Phase 3 (M-AUTH MVP는 콘솔 로그)
- 2FA / 패스키 / 매직링크 — Phase 3
- 이메일 인증(`emailVerified` 채우기) — 가입 즉시 활성, 인증 메일은 Phase 3
- 게스트 예약 — Phase 2 비범위 확정
- 어드민 UI / 권한 분리(`UserRole.ADMIN`) — 어드민 spec
- `PassportProfile` CRUD — booking 모듈에서 다룸
- rate limiting / brute-force 방어 인프라 — M-OBS·인프라 spec

## 1. 아키텍처 & 라우팅

### 라우트
```
src/app/
├── (auth)/
│   ├── layout.tsx              인증 페이지 공통 레이아웃 (좁은 폼 컨테이너)
│   ├── login/page.tsx          /login
│   ├── signup/page.tsx         /signup
│   ├── forgot-password/page.tsx /forgot-password
│   └── reset-password/page.tsx  /reset-password?token=...
└── api/
    └── auth/
        └── [...nextauth]/route.ts   NextAuth.js v5 라우트 핸들러
```

기존 `(site)` 그룹과 동급의 **`(auth)` 라우트 그룹** 신설. 헤더/푸터 없는 좁은 폼 레이아웃 분리 목적.

### FSD 매핑
```
app/(auth)/login/page.tsx         ← RSC. signIn은 child client form 위임
app/(auth)/signup/page.tsx        ← RSC. signup form은 client
app/(auth)/reset-password/page.tsx ← RSC. token 검증 후 client form 위임
app/api/auth/[...nextauth]/route.ts ← NextAuth 핸들러

features/auth/
├── ui/LoginForm.tsx              ← 'use client'. react-hook-form + zod
├── ui/SignupForm.tsx             ← 'use client'
├── ui/ForgotPasswordForm.tsx     ← 'use client'
├── ui/ResetPasswordForm.tsx      ← 'use client'
├── api/actions.ts                ← Server Actions: signup, requestReset, resetPassword
└── lib/authOptions.ts            ← NextAuth 설정 (providers, adapter, callbacks)

entities/user/
├── api/queries.ts                ← getCurrentUser, getUserByEmail
├── api/mutations.ts              ← createUser (서버 전용, password hash)
├── api/password.ts               ← hashPassword / verifyPassword (bcrypt 래핑)
├── api/__tests__/password.test.ts ← 단위 테스트
├── api/passwordPolicy.ts         ← 비밀번호 규칙 검증 (순수 함수)
├── api/__tests__/passwordPolicy.test.ts
├── model/types.ts                ← SessionUser 타입 (Pick<User, ...>)
├── model/schemas.ts              ← zod: SignupSchema, LoginSchema, ResetSchema
└── index.ts                      ← barrel

shared/
├── lib/auth.ts                   ← auth(), signIn, signOut re-export
└── lib/logger.ts                 ← 이메일 발송 대체용 콘솔 로거 (M-OBS 전조)

middleware.ts                     ← 보호 라우트 매처 (next-auth 통합)
```

## 2. 데이터 모델 변경

### User 모델 (수정)
기존 User 모델에 **`passwordHash`** 필드 한 줄만 추가. 다른 변경 없음.

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  emailVerified DateTime?
  name          String?
  phone         String?
  image         String?
  passwordHash  String?              // ← 신규: Credentials provider용. null이면 소셜만
  role          UserRole  @default(CUSTOMER)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  // ...관계 동일
}
```

**근거**: 별도 `Credential` 모델보다 단순함. 향후 소셜 로그인 추가 시 `passwordHash`는 null로 두면 됨. Account 모델은 NextAuth 표준 그대로 두어 소셜 추가 시 무수정 확장.

### VerificationToken 모델 (재사용)
비밀번호 재설정 토큰은 기존 `VerificationToken` 테이블을 재사용. NextAuth가 정의한 스키마지만 `identifier` 컬럼에 이메일을 넣고 `expires`로 TTL 관리하는 패턴이 표준.

### Account 모델 (Phase 2에서 미사용)
Credentials provider는 Account 행을 생성하지 않음. NextAuth.js v5의 Credentials는 의도적으로 Account/Session 모두 데이터베이스 strategy에서 우회한다. **세션은 직접 Session 테이블에 기록.**

> ⚠️ NextAuth.js v5 + Credentials는 `session.strategy = "database"`와 호환성 이슈가 있음 (공식적으로 JWT 권장). 본 spec은 **JWT 전략**으로 결정 변경 가능성 있음 — §3에서 다룸.

## 3. NextAuth.js v5 설정 결정

### 3.1 세션 전략: **JWT (변경)**
원래 §0에서 "데이터베이스 세션"으로 명시했으나, NextAuth.js v5의 Credentials Provider 공식 가이드는 **JWT 전략 권장**. 데이터베이스 세션과 Credentials는 공식 미지원.

**최종 결정**: **JWT + httpOnly secure cookie**, `maxAge = 30일`. 향후 소셜 로그인 추가 시 동일 전략 유지.

JWT 토큰에 포함:
- `sub: User.id`
- `email`
- `role`
- `iat`, `exp`

JWT 시크릿: `AUTH_SECRET` env (배포 환경별 분리).

### 3.2 Provider
```ts
providers: [
  Credentials({
    credentials: {
      email: { type: "email" },
      password: { type: "password" },
    },
    async authorize(creds) {
      // 1. zod 파싱
      // 2. getUserByEmail
      // 3. verifyPassword(creds.password, user.passwordHash)
      // 4. null 또는 { id, email, role } 반환
    },
  }),
],
```

### 3.3 Callbacks
- `jwt`: 최초 로그인 시 `token.role = user.role` 주입
- `session`: `session.user.id`, `session.user.role` 노출

### 3.4 Pages
NextAuth 기본 페이지 비활성, 자체 페이지 사용:
```ts
pages: {
  signIn: "/login",
  error: "/login", // ?error= 쿼리로 에러 표시
}
```

## 4. 인증 흐름

### 4.1 회원가입
```
[Client] SignupForm submit (zod 1차 검증)
   ↓
[Server Action] features/auth/api/actions.ts → signup(data)
   ↓
   1. SignupSchema.parse (서버 재검증)
   2. passwordPolicy 통과 확인
   3. getUserByEmail → 중복 검사
   4. hashPassword(plain) → bcrypt cost 12
   5. createUser({ email, name, passwordHash, role: CUSTOMER })
   ↓
[Client] 성공 시 signIn("credentials", { email, password, redirect: false })
   ↓
[Client] 로그인 성공 → router.push("/")
```

### 4.2 로그인
```
[Client] LoginForm submit
   ↓
signIn("credentials", { email, password, redirect: false })
   ↓
[NextAuth] authorize() 호출
   ↓
   - 성공: JWT 발급 + 쿠키 set → client에서 redirect 처리
   - 실패: { error: "CredentialsSignin" } 반환 → 폼 에러 표시
```

### 4.3 로그아웃
- 헤더의 `<LogoutButton>` (client) → `signOut({ callbackUrl: "/" })`

### 4.4 비밀번호 재설정
```
[Client] /forgot-password 폼 → 이메일 입력
   ↓
[Server Action] requestReset(email)
   1. 이메일이 존재하는지와 관계없이 동일 응답(이메일 enumeration 방어)
   2. 존재하면: 32-byte random token, VerificationToken 생성 (expires = now + 1h)
   3. logger.info("[reset-mail] email=... token=...") — 콘솔 발송 대체
   ↓
[User] 콘솔에서 토큰 복사 → /reset-password?token=... 진입
   ↓
[Server Action] resetPassword(token, newPassword)
   1. VerificationToken 조회 + expires 검사
   2. 비밀번호 정책 검증
   3. hashPassword → User.passwordHash 갱신
   4. VerificationToken 삭제
   ↓
[Client] 성공 → /login 리다이렉트
```

## 5. 비밀번호 정책

`entities/user/api/passwordPolicy.ts` — 순수 함수.

규칙:
- 최소 10자
- 영문 대/소문자 + 숫자 + 특수문자 중 **3종 이상 포함**
- 이메일 local-part와 동일 금지(`alice@x.com` → `alice` 포함 금지)
- 공백 금지

`validatePassword(password: string, email?: string): { ok: true } | { ok: false, reason: string }`.

zod 스키마에서 `.refine(validatePassword)` 형태로 연결.

## 6. RSC 사용 패턴

`shared/lib/auth.ts`:
```ts
import NextAuth from "next-auth";
import { authOptions } from "@/features/auth/lib/authOptions";

export const { auth, handlers, signIn, signOut } = NextAuth(authOptions);
```

`entities/user/api/queries.ts`:
```ts
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/db";

export async function getCurrentUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, role: true },
  });
}
```

RSC에서:
```tsx
export default async function Page() {
  const user = await getCurrentUser();
  if (!user) return <GuestView />;
  return <MemberView user={user} />;
}
```

## 7. 보호 라우트 (middleware)

`middleware.ts`:
```ts
import { auth } from "@/shared/lib/auth";

export default auth((req) => {
  const isAuthed = !!req.auth;
  const isProtected = req.nextUrl.pathname.startsWith("/account")
    || req.nextUrl.pathname.startsWith("/bookings");
  if (isProtected && !isAuthed) {
    const url = new URL("/login", req.url);
    url.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return Response.redirect(url);
  }
});

export const config = {
  matcher: ["/account/:path*", "/bookings/:path*"],
};
```

> M-AUTH MVP에서는 `/account`·`/bookings`는 아직 없으나, matcher만 선제 정의해서 후속 모듈이 즉시 활용 가능.

## 8. 페이지 UI 사양 (요약)

| 페이지 | RSC/Client | 핵심 요소 |
|--------|-----------|----------|
| `/login` | RSC + Client form | 이메일·비밀번호 입력, "회원가입" 링크, "비밀번호 찾기" 링크, `?error=`에 따른 에러 표시 |
| `/signup` | RSC + Client form | 이메일·이름·비밀번호·비밀번호 확인. 약관 동의 체크박스(텍스트만, 외부 링크 없음 — 향후) |
| `/forgot-password` | RSC + Client form | 이메일 입력 → "메일을 발송했습니다(존재 시)" 안내 (실제는 콘솔) |
| `/reset-password` | RSC (token 검증) + Client form | token 유효성을 RSC에서 사전 검사, 유효시 폼 노출 |

레이아웃: `(auth)/layout.tsx`에서 max-width 420px, 카드 스타일, 헤더 로고만.

## 9. 에러 처리

| 상황 | 동작 |
|------|------|
| 가입 시 이메일 중복 | 폼 인라인 에러: "이미 가입된 이메일입니다" |
| 로그인 실패 | "이메일 또는 비밀번호가 일치하지 않습니다" (구체 사유 노출 금지) |
| 비밀번호 정책 위반 | passwordPolicy 반환 reason을 한국어로 매핑하여 인라인 표시 |
| reset token 만료/무효 | `/reset-password`에서 "링크가 만료되었습니다" + 재요청 링크 |
| NextAuth 내부 에러 | `/login?error=Configuration` 등 → 통일 메시지 |
| 서버 액션 예외 | `try/catch` → `{ ok: false, error }` 반환, client에서 toast/inline |

## 10. 테스트 전략

| 대상 | 종류 | 위치 |
|------|------|------|
| `passwordPolicy` | 단위 | `entities/user/api/__tests__/passwordPolicy.test.ts` — 케이스 8개+ |
| `hashPassword/verifyPassword` | 단위 | `entities/user/api/__tests__/password.test.ts` — 라운드트립 + 잘못된 비번 |
| `signup` 서버 액션 | 통합 | 별도 vitest 환경(테스트 DB) — Phase 2 후반에 정비. MVP에서는 수동 검증 + 타입 |
| 페이지 렌더링 | E2E | 본 spec 범위 외(별도 Playwright spec) |

**MVP는 순수 함수 단위 테스트만 자동화**, 서버 액션 통합 테스트는 후속 plan에서 다룸.

## 11. 마이그레이션

1. `prisma/schema.prisma` — User 모델에 `passwordHash String?` 추가
2. `npx prisma migrate dev --name add_user_password_hash`
3. seed.ts — 검증용 시드 사용자 1~2명 추가:
   - `customer@nextour.test` / `Nextour!2026` (CUSTOMER)
   - `admin@nextour.test` / `Nextour!2026` (ADMIN) — 추후 어드민 검증용

## 12. 환경 변수

```
AUTH_SECRET=...           # openssl rand -base64 32
AUTH_URL=http://localhost:3000   # 배포 시 도메인
```

`.env.example`에 위 두 줄 추가. 실제 값은 `.env.local`.

## 13. 보안 체크리스트

- [x] 비밀번호 bcrypt cost 12 이상
- [x] JWT secret env로 분리
- [x] 이메일 enumeration 방어 (`/forgot-password` 동일 응답)
- [x] 비밀번호 정책 최소 10자 + 3종 문자
- [x] HTTPS 전제(쿠키 `secure: true` — production)
- [x] CSRF — NextAuth.js v5 내장
- [x] 로그인 실패 메시지 모호화
- [ ] rate limiting — M-OBS / 인프라 spec으로 이연

## 14. 후속 plan 구성 (예상)

본 spec → 단일 plan `plans/2026-05-13-auth.md`로 약 **15~18개 태스크** 예상:

1. Prisma 스키마 + 마이그레이션
2. 비밀번호 정책 + 테스트 (TDD)
3. bcrypt 래퍼 + 테스트 (TDD)
4. zod 스키마 (Signup/Login/Reset)
5. `entities/user/api/queries.ts` (getCurrentUser, getUserByEmail)
6. `entities/user/api/mutations.ts` (createUser, updatePassword)
7. NextAuth 설정 (`features/auth/lib/authOptions.ts`)
8. `shared/lib/auth.ts` (auth/signIn/signOut export)
9. `app/api/auth/[...nextauth]/route.ts` 핸들러
10. Server Action (`features/auth/api/actions.ts`)
11. LoginForm + SignupForm 클라이언트 컴포넌트
12. ForgotPasswordForm + ResetPasswordForm
13. `(auth)` 라우트 그룹 + 4개 페이지
14. `middleware.ts`
15. 시드 사용자 2명
16. typecheck + test 통과
17. 수동 검증 체크리스트

## 15. 미결정 / 가정

- **이메일 전송**: MVP는 콘솔 로그. Phase 3에서 Resend/SES 도입.
- **약관·개인정보처리방침**: 텍스트만 표시, 실제 동의 저장은 후속.
- **JWT vs DB 세션 재검토**: NextAuth.js v5의 Credentials + DB 세션 비공식 패턴이 안정화되면 전환 검토. 현 시점은 공식 권장 JWT 채택.
- **로그인 후 redirect 정책**: `callbackUrl` 쿼리 우선, 없으면 `/`.
