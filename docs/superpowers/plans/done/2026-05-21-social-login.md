# 2026-05-21 — Social Login (Kakao / Google)

> PRD §4.2 추가 기능 후보 「카카오/구글 소셜 로그인」 의 정식 구현.
> 유저 획득 마찰을 줄이고, 매직링크 가입 → 소셜 로그인 전환 시 계정 분리(`OAuthAccountNotLinked`) 사고를 방지한다.

## Context

- 현재 NextAuth v5 (5.0.0-beta.25), `PrismaAdapter`, `session.strategy: "jwt"`.
- 이미 `Resend`(매직링크) + `Kakao` 두 provider가 `features/auth/server/auth.ts` 에 등록되어 있음. Kakao는 env가 부재하면 **조건부 비활성**.
- 환경변수 `AUTH_KAKAO_ID/SECRET` 은 이미 정의되어 있으나 **페어 검증(둘 다 있거나 둘 다 없음)이 없음**.
- 로그인 페이지(`app/(site)/login/page.tsx`)는 카카오 폼이 **인라인 server action** 으로 박혀있어 FSD 상 `app` 레이어가 인증 인터랙션을 직접 소유 — `features/auth` 로 옮겨야 함.
- 매직링크와 동일 이메일로 소셜 로그인 시 NextAuth가 기본적으로 `OAuthAccountNotLinked` 를 던짐 (계정 자동 병합 차단).
- Prisma `Account` 모델은 NextAuth 표준 스키마라 마이그레이션 불필요.

## Persona Activation

| 페르소나 | 발동 사유 |
|---|---|
| 🏛️ Architect | `features/auth/**` 신규 파일, `app/(site)/login/page.tsx` 리팩토링 — FSD 단방향·barrel |
| ⚙️ Backend Expert | NextAuth provider config, env(Zod superRefine) 검증, OAuth 콜백 보안 |
| 🎨 Frontend Expert | 로그인 버튼 UI (RSC + server action form, 클라이언트 hook 없음) |
| 🔬 QA Engineer | 보고 직전 자동 증거 수집 (env safeParse, typecheck/test/lint, /login HTML grep) |

Domain Booking 비활성 — 결제·좌석·NO-REAL-MONEY 범주 외.

## Design Decisions

1. **Provider 셋**: `Resend`(매직링크) + `Kakao` + `Google`. 세 provider 모두 동일한 User 행에 매핑되어야 한다.
2. **Account Linking 전략 — `allowDangerousEmailAccountLinking: true`** (각 OAuth provider에 명시):
   - Kakao / Google 모두 **이메일 인증을 자체 수행**하는 신뢰 가능한 IdP. 같은 verified email 을 갖는 OAuth 콜백이 도착하면 NextAuth가 기존 User row에 새 Account 만 추가(link)한다.
   - 이 플래그명에 "Dangerous" 가 붙은 이유는 IdP가 이메일을 검증하지 않을 때 임의의 이메일을 spoof 할 수 있어서. Google/Kakao는 둘 다 검증 IdP이므로 위험 분류에서 제외.
   - Resend(매직링크) 자체도 이메일 소유 증명이므로 세 경로의 신뢰 모델이 일관됨.
3. **Env 보안 (Zod `superRefine`)** — 다음 invariant를 부팅 시점에 강제:
   - **페어 검증**: `AUTH_KAKAO_ID` 와 `AUTH_KAKAO_SECRET` 은 둘 다 설정되었거나 둘 다 비어있어야 함. 한쪽만 있으면 부팅 차단. Google도 동일.
   - **포맷 가드**: `AUTH_GOOGLE_ID` 가 설정되었으면 `.apps.googleusercontent.com` 으로 끝나야 함 (Google 표준). 타입 오류·테스트 키 혼입을 부팅에서 잡는다.
   - **시크릿 최소 길이**: `AUTH_*_SECRET` 은 설정 시 최소 8자 (실 키는 훨씬 길지만 빈 문자열·placeholder 방어 목적).
4. **FSD 위치**:
   - 서버 액션: `features/auth/server/actions.ts` — `signInWithKakao(callbackUrl)`, `signInWithGoogle(callbackUrl)`. callbackUrl Zod 검증으로 open redirect 차단.
   - UI: `features/auth/ui/OAuthLoginButtons.tsx` — RSC, `'use client'` 없음. 두 폼이 각각 server action 을 호출.
   - barrel: `features/auth/index.ts` 추가하고, `app/(site)/login/page.tsx` 는 `@/features/auth` 로 import.
5. **조건부 표시**: env에 ID/SECRET 페어가 모두 설정된 provider만 버튼 렌더. dev 환경에서 키 없이 시작해도 매직링크만 보이며 UI가 깨지지 않음.
6. **에러 메시지**: `OAuthAccountNotLinked` 는 이론상 더 이상 발생하지 않지만(allowDangerous로 해결), 만일 IdP가 이메일을 안 주는 케이스가 생기면 사용자 친화 메시지 유지.

## Files Touched

| 작업 | 파일 | 종류 |
|---|---|---|
| 수정 | `src/shared/lib/env.ts` | Google 키 + superRefine 페어/포맷 |
| 수정 | `src/shared/lib/__tests__/env.test.ts` | 페어/포맷 검증 케이스 |
| 수정 | `src/features/auth/server/auth.ts` | Google provider + allowDangerousEmailAccountLinking |
| 신규 | `src/features/auth/server/actions.ts` | server actions (Kakao/Google) |
| 신규 | `src/features/auth/ui/OAuthLoginButtons.tsx` | RSC 버튼 묶음 |
| 신규 | `src/features/auth/index.ts` | barrel |
| 수정 | `src/app/(site)/login/page.tsx` | 인라인 Kakao 폼 제거 → OAuthLoginButtons |

## Tasks

### Task 1 — env 보강 + 테스트 (TDD)

- [x] `src/shared/lib/__tests__/env.test.ts` 에 8개 케이스 추가 — RED 확인 (5 failing / 14 passing)
- [x] `src/shared/lib/env.ts` 에 `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` optional 필드 추가
- [x] `superRefine` 블록에 oauth 페어 루프 + Google `.apps.googleusercontent.com` 포맷 검증 추가
- [x] 테스트 재실행 → GREEN (19 / 19)
- [x] Backend Expert 자가 점검: ✅ zod superRefine, ✅ process.env 직접 접근 없음, ✅ env 모듈 단일 진실 원천

### Task 2 — NextAuth Provider 보강

- [x] `src/features/auth/server/auth.ts` 수정
  - ✅ `next-auth/providers/google` import 추가
  - ✅ Kakao block에 `allowDangerousEmailAccountLinking: true` + 신뢰 IdP 근거 주석 박제
  - ✅ Google provider 추가 (env 옵셔널 분기)
- [x] Backend Expert 자가 점검: ✅ edge runtime 미사용 (middleware는 별도 import 경로), ✅ env 직접 접근 없음

### Task 3 — features/auth Server Actions

- [x] `src/features/auth/server/actions.ts` 신규 작성
  - ✅ `"use server"` 모듈 선언
  - ✅ `signInWithProvider(formData)` FormData 기반 — Server Action 표준 시그니처
  - ✅ `safeCallback` 가드(`!"/" prefix`, `"//"  protocol-relative` 차단)로 open-redirect 방지
  - ✅ provider 화이트리스트(`"kakao" | "google"`) 외 값은 `InvalidProvider` 에러로 리다이렉트
  - ✅ AuthError 캐치 후 `/login?error=…&callbackUrl=…` 리다이렉트
- [x] Backend Expert 자가 점검: ✅ provider 화이트리스트, ✅ URL 가드

### Task 4 — features/auth UI 컴포넌트

- [x] `src/features/auth/ui/OAuthLoginButtons.tsx` 신규 작성 (RSC)
  - ✅ props: `{ callbackUrl: string }`
  - ✅ env 페어 활성 여부 계산, 둘 다 비활성 시 컴포넌트 자체 null (구분선도 미렌더)
  - ✅ 카카오: `bg-[#FEE500] text-[#3C1E1E]`
  - ✅ 구글: 흰 배경 + 4색 inline SVG 로고 (외부 의존성 0)
  - ✅ hidden input(`provider`, `callbackUrl`) → `signInWithProvider` Server Action
- [x] Frontend Expert 자가 점검: ✅ `'use client'` 없음, ✅ hook 없음, ✅ hydration safe

### Task 5 — barrel + login page 리팩토링

- [x] `src/features/auth/index.ts` 신규 작성 — `signIn`/`signOut`/`auth`/`handlers`/`OAuthLoginButtons`/`signInWithProvider`/기존 UI 컴포넌트 모두 명시적 named export. (기존 깊은 경로 import는 본 작업 범위 외로 보존)
- [x] `src/app/(site)/login/page.tsx` 수정
  - ✅ 인라인 Kakao form 블록 제거 (~25줄 단순화)
  - ✅ `OAuthLoginButtons` barrel import
  - ✅ `OAuthAccountNotLinked` + `InvalidProvider` 에러 메시지 잔존(안전망)
  - ✅ `safeCallback` open-redirect 가드 매직링크 form에도 적용
- [x] Architect 자가 점검: ✅ OAuth 인터랙션 features 레이어로 추출 완료, 매직링크 form은 페이지 고유 UI라 인라인 유지 (30줄 미만)

### Task 6 — 정적 & 동적 검증

- [x] `npm run typecheck` → exit 0 (clean)
- [x] `npm run test` → 41 files / **415 tests passed** (env 8 신규 포함, 이전 407 → 415)
- [x] `npm run lint` → 신규/수정 파일 error/warning **0건**
- [x] `npm run dev` → `/login` HTML grep:
  - `.env`만 (Kakao 키만): `카카오로 로그인` ✅, `이메일로 링크 받기` ✅, `또는` ✅ → Google 버튼 hide (조건부)
  - Google 페어 inject: `카카오로 로그인` + `Google로 로그인` + `또는` 모두 렌더 ✅
- [x] **Negative test**: `AUTH_GOOGLE_ID=not-a-google-id` 로 부팅 → `/login` HTTP 500 + ZodError `"AUTH_GOOGLE_ID: Google OAuth 표준 포맷..."` 출력 ✅
- [x] 시각(버튼 정렬·SVG 로고)만 사용자 위임

### Task 7 — 완료 처리

- [x] 본 plan 의 모든 `- [ ]` 를 작업 직후 `- [x]` 로 갱신
- [x] 보고 양식 §7.1 준수 (🏗️ / ♻️ / 🧠)

## Verification Checklist (최종)

- [x] env superRefine: Kakao/Google 페어 가드 + Google 포맷 검증 동작 (positive/negative 양쪽 자동 증거)
- [x] NextAuth `allowDangerousEmailAccountLinking` 적용 + 주석에 신뢰 IdP 근거 박제
- [x] FSD: `features/auth` server action + UI 위치, `app/login/page.tsx` 는 barrel만 사용
- [x] callbackUrl open-redirect 가드 동작 (`safeCallback` — `/` 미접두/`//` 차단)
- [x] typecheck / test / lint 그린
- [x] `/login` 페이지 렌더 시 두 버튼 HTML 노출 확인

## Out of Scope

- 카카오/구글 외 다른 IdP(애플, 네이버 등) — Phase 2 후보.
- 계정 unlink UI (마이페이지에서 연결 해제) — 별도 plan.
- 결제·좌석·NO-REAL-MONEY 관련 변경 없음.
