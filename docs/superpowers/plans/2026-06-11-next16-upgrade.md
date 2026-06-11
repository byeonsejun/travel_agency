# Phase 5-B: Next.js 16 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Next.js 15.5.18 → 16으로 "동작 보존" 메이저 범프를 수행한다. 프레임워크 버전과 Sentry 의존성만 올리고, 캐시 패러다임 전환(Cache Components)은 건드리지 않는다.

**Architecture:** "전기 배선만 교체, 벽은 안 허문다." 두 개의 큰 변화(①프레임워크 버전 ②캐시 철학)를 분리한다. 가장 큰 미지수인 **Sentry 8→10을 Next 15 baseline에서 먼저 격리 업그레이드**해 그린을 확인한 뒤, Next 16을 범프한다. `middleware.ts`는 Edge 런타임 사수를 위해 `proxy.ts`로 전환하지 않고 유지(deprecation 경고 수용). `unstable_cache`(37곳)는 16에서 계속 지원되므로 그대로 두고, 깨지는 `revalidateTag` 시그니처만 방어한다. Cache Components는 Phase 5-C로 격리.

**Tech Stack:** Next.js 16, React 19.2, @sentry/nextjs 10.x, Turbopack(기본 빌드), ESLint 9 flat config, TypeScript 5.6, Vitest 2.

**확정된 3대 의사결정 (수석 아키텍트 승인, 2026-06-11):**
1. **Middleware:** `proxy.ts` 전환 거부 → `middleware.ts` 유지 (Edge 런타임 사수).
2. **Cache:** Cache Components 전환은 Phase 5-C로 이연 → 이번엔 `revalidateTag` 파라미터 호환성만 방어.
3. **Sentry:** Next 16 선결 조건 → Sentry 10.x를 별도 선행 Task로 격리 처리.

---

## File Structure (touched files)

**Task 1 — Sentry 10:**
- Modify: `package.json` (`@sentry/nextjs` `^8.55.2` → `^10`)
- Modify: `next.config.mjs` (`withSentryConfig` 옵션에서 `hideSourceMaps` 제거)
- Verify (no change expected): `src/sentry.server.config.ts`, `src/sentry.edge.config.ts`, `src/shared/lib/observability/errorTracker.ts`, `src/app/global-error.tsx`

**Task 2 — Next 16 core bump:**
- Modify: `package.json` (`next` `^15` → `^16`, `eslint-config-next` `^15` → `^16`, `react`/`react-dom`/`@types/react`/`@types/react-dom` → latest)
- Verify: `next.config.mjs` (turbopack/experimental 키 없음 확인), `src/middleware.ts` (유지)

**Task 3 — revalidateTag 2-arg migration (9 calls / 6 files):**
- Modify: `src/features/admin-product/server/actions.ts:69-72` (4 calls)
- Modify: `src/features/checkout/server/actions.ts:133`
- Modify: `src/features/booking-cancel/server/actions.ts:146`
- Modify: `src/features/admin-booking-cancel/server/actions.ts:127`
- Modify: `src/features/admin-departure/server/actions.ts:57`
- Modify: `src/features/admin-departure-cancel/server/actions.ts:152`

**Task 4 — config / image / Turbopack build:**
- Modify: `next.config.mjs` (이미지 기본값 핀고정 결정 박제 + middleware 유지 주석)
- Modify: `package.json` (`build` 스크립트 — Turbopack 검증, 필요 시 `--webpack` 폴백)

**Task 5 — ESLint flat config:**
- Create: `eslint.config.mjs`
- Modify: `package.json` (`eslint` `^8` → `^9`, `lint` 스크립트 `next lint` → `eslint .`)
- Delete (if exists): `.eslintrc.json`

**Task 6 — QA + docs/ADR:**
- Create: `docs/superpowers/adr/0051-next16-upgrade-de-risked.md`
- Modify: `docs/superpowers/adr/README.md`
- Modify: `CLAUDE.md` (§8 진행 노트)

---

## Task 1: Sentry 8 → 10 선행 격리 업그레이드

> **격리 이유:** Sentry 10의 peer는 `^13 || ^14 || ^15 || ^16` → **Next 15에서도 동작**한다. Next 16 범프 *전에* Sentry만 올려 그린을 확인하면, 이후 빌드가 깨졌을 때 "Sentry 탓 vs Next 탓"을 분리 진단할 수 있다.

**Files:**
- Modify: `package.json`
- Modify: `next.config.mjs:42-47`

- [x] **Step 1: Sentry 10 설치 (Next 15 baseline 유지)**

Run:
```bash
npm install @sentry/nextjs@^10
```
Expected: `@sentry/nextjs` 10.x 설치, `next` 15.5.18 변동 없음.

확인:
```bash
npm ls @sentry/nextjs next | head -5
```
Expected: `@sentry/nextjs@10.x`, `next@15.5.18`.

- [x] **Step 2: `hideSourceMaps` 옵션 제거**

Sentry v9에서 `hideSourceMaps`는 **무대체 삭제**됐다(SDK가 기본으로 hidden sourcemap 방출). `next.config.mjs`의 `withSentryConfig` 2번째 인자에서 제거한다.

`next.config.mjs` 하단을 다음으로 수정:
```js
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  // hideSourceMaps: Sentry v9에서 무대체 삭제됨 — SDK가 기본으로 hidden sourcemap 방출.
});
```

- [x] **Step 3: Sentry.init / API 회귀 점검 (코드 변경 없음, 확인만)**

다음을 grep으로 확인 — 모두 v10에서 유효하므로 **변경 불필요**, 단 회귀 가드:
```bash
grep -rn "enableTracing\|autoSessionTracking\|transactionContext" src/
```
Expected: 출력 없음 (제거된 옵션 미사용). `tracesSampleRate: 0` / `sendDefaultPii: false` / `withScope` / `captureException` / `captureMessage` / `setTag` / `setExtra`는 v10에서 그대로 유효.

- [x] **Step 4: typecheck + test (Next 15 baseline 그린 확인)**

Run:
```bash
npm run typecheck && npm run test
```
Expected: typecheck PASS, 전체 테스트 PASS. (errorTracker.test.ts 포함 — Sentry mock 시그니처 불변)

- [x] **Step 5: 빌드 검증 (Next 15 = webpack, Sentry 10 플러그인)**

> ⚠️ dev 서버가 떠 있으면 먼저 종료(`.next` 충돌 방지 — memory: no-build-during-dev).

Run:
```bash
npm run build
```
Expected: 빌드 성공. Sentry 10 webpack 플러그인이 Next 15에서 정상 동작(sourcemap 업로드는 `SENTRY_AUTH_TOKEN` 부재 시 silent skip).

- [x] **Step 6: Commit**

```bash
git add package.json package-lock.json next.config.mjs
git commit -m "chore(sentry): upgrade @sentry/nextjs 8.55 → 10.x (Next 16 prerequisite)

- drop removed hideSourceMaps option (v9 breaking)
- verified on Next 15 baseline before framework bump (de-risk isolation)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Next.js 16 + React 코어 범프

> **codemod 정책:** 광역 `@next/codemod upgrade latest`는 **실행하지 않는다** — middleware→proxy 자동 리네임이 우리 Edge 사수 결정(확정 #1)을 위반하기 때문. async-request-api codemod도 우리 코드가 이미 `Promise`+`await`라 no-op. 따라서 **수동 의존성 설치 + 최소 config 확인**만 한다.

**Files:**
- Modify: `package.json`
- Verify: `next.config.mjs`, `src/middleware.ts`

- [x] **Step 1: Next 16 + React + 타입 설치**

Run:
```bash
npm install next@^16 react@latest react-dom@latest
npm install -D @types/react@latest @types/react-dom@latest eslint-config-next@^16
```
Expected: `next@16.x`, `react`/`react-dom` 19.2.x, `eslint-config-next@16.x`.

확인:
```bash
npm ls next react react-dom | head -6
```

- [x] **Step 2: `next.config.mjs` 마이그레이션 불필요 확인**

다음 grep으로 16에서 옮겨야 할 키가 없음을 확인:
```bash
grep -nE "experimental|turbopack|webpack|serverRuntimeConfig|publicRuntimeConfig|amp|images.*domains" next.config.mjs
```
Expected: 출력 없음(`experimental.turbopack`/커스텀 webpack/제거된 키 미사용 → top-level `turbopack` 이전 불요).

- [x] **Step 3: `middleware.ts` 유지 확인 (proxy 전환 안 함)**

`src/middleware.ts`는 그대로 둔다(확정 #1). 16 빌드 시 deprecation 경고가 뜨지만 Edge 런타임 + NextAuth `auth()` + Upstash + CSP nonce 동작은 보존된다. 파일 상단 주석에 결정 박제:

`src/middleware.ts`의 첫 줄 주석 블록(`// Edge runtime — ALS/Prisma import 금지...` 위)에 한 줄 추가:
```ts
// [Next 16] proxy.ts 전환 거부 — Edge 런타임 사수 (ADR-0051). proxy는 nodejs 고정이라
// NextAuth/rate-limit/CSP의 Edge 실행 보존 불가. deprecation 경고는 의도적 수용.
```

- [x] **Step 4: typecheck (16 타입 + React 19.2 타입 정합)**

Run:
```bash
npm run typecheck
```
Expected: PASS. (params/searchParams가 이미 `Promise`라 타입 에러 없음. 만약 `revalidateTag` 단일인자 TS 에러가 여기서 발현되면 Task 3에서 해소 — 이 단계에선 그 에러만 허용하고 기록.)

> **Note:** 16의 `revalidateTag` 타입은 2번째 인자를 요구한다. 이 Step에서 9건의 TS 에러가 나올 수 있으며 이는 **예상된 것**이다(Task 3의 드라이버). 그 외 에러는 즉시 조사.

- [x] **Step 5: Commit (typecheck는 Task 3 후 최종 그린)**

```bash
git add package.json package-lock.json src/middleware.ts
git commit -m "feat(next): bump Next.js 15 → 16 + React 19.2 core deps

- keep middleware.ts (reject proxy.ts to preserve Edge runtime, ADR-0051)
- no broad codemod: async params already awaited, middleware retained
- revalidateTag 2-arg TS errors expected, resolved in next task

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `revalidateTag` 2-인자 마이그레이션

> **이유:** Next 16에서 `revalidateTag(tag)` 단일인자는 **TS 컴파일 에러**. 2번째 인자로 `cacheLife` 프로파일을 요구한다. 공식 가이드가 제시하는 직접 마이그레이션(`revalidateTag('posts')` → `revalidateTag('posts', 'max')`)을 따른다. `'max'`는 stale-while-revalidate 프로파일로, 우리 `unstable_cache`/ISR 데이터 레이어의 "약간의 지연 허용" 성격과 정합(즉시성이 필요한 곳은 같은 액션의 `revalidatePath`가 별도 보장). `updateTag`(read-your-writes) 채택은 Phase 5-C Cache Components와 함께 재논의.

**Files:** (9 calls / 6 files)
- Modify: `src/features/admin-product/server/actions.ts`
- Modify: `src/features/checkout/server/actions.ts`
- Modify: `src/features/booking-cancel/server/actions.ts`
- Modify: `src/features/admin-booking-cancel/server/actions.ts`
- Modify: `src/features/admin-departure/server/actions.ts`
- Modify: `src/features/admin-departure-cancel/server/actions.ts`

- [x] **Step 1: 9개 호출에 `, "max"` 추가**

각 파일의 `revalidateTag(...)` 호출을 다음과 같이 수정한다 (인자 1개 → 2개):

`src/features/admin-product/server/actions.ts` (4곳):
```ts
  revalidateTag(tagProductDetail(productId), "max");
  revalidateTag(TAG_PRODUCTS_LIST, "max");
  revalidateTag(TAG_DESTINATIONS_LIST, "max");
  revalidateTag(TAG_PRODUCTS_FEATURED, "max");
```

`src/features/checkout/server/actions.ts:133`:
```ts
  revalidateTag(tagDeparturesByProduct(departure.productId), "max");
```

`src/features/booking-cancel/server/actions.ts:146`:
```ts
  revalidateTag(tagDeparturesByProduct(productId), "max");
```

`src/features/admin-booking-cancel/server/actions.ts:127`:
```ts
  revalidateTag(tagDeparturesByProduct(productId), "max");
```

`src/features/admin-departure/server/actions.ts:57`:
```ts
  revalidateTag(tagDeparturesByProduct(productId), "max");
```

`src/features/admin-departure-cancel/server/actions.ts:152`:
```ts
    revalidateTag(tagDeparturesByProduct(productId), "max");
```

- [x] **Step 2: 잔여 단일인자 호출 0건 확인**

Run:
```bash
grep -rn "revalidateTag([^,]*)" src/ | grep -v "test\|//"
```
Expected: 출력 없음 (모든 실호출이 2-인자). 출력이 있으면 누락분 수정.

- [x] **Step 3: typecheck PASS (TS 에러 해소 확인)**

Run:
```bash
npm run typecheck
```
Expected: PASS (Task 2 Step 4에서 예상됐던 9건 에러 소멸).

- [x] **Step 4: 액션 테스트 PASS (동작 회귀 가드)**

Run:
```bash
npm run test -- actions
```
Expected: checkout/booking-cancel/admin-product 등 액션 테스트 PASS. (테스트가 `revalidateTag` 호출 횟수/인자를 단언하면 mock 시그니처에 맞춰 `'max'` 반영 — 실패 시 테스트의 기대 인자를 함께 갱신.)

- [x] **Step 5: Commit**

```bash
git add src/features/admin-product/server/actions.ts src/features/checkout/server/actions.ts src/features/booking-cancel/server/actions.ts src/features/admin-booking-cancel/server/actions.ts src/features/admin-departure/server/actions.ts src/features/admin-departure-cancel/server/actions.ts
git commit -m "fix(cache): migrate revalidateTag to 2-arg cacheLife profile (Next 16)

- add 'max' (stale-while-revalidate) to all 9 call sites
- defer updateTag/read-your-writes adoption to Phase 5-C (Cache Components)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: next.config 점검 + Turbopack 빌드 검증

> Next 16은 `next build`를 **Turbopack 기본**으로 실행한다. Sentry 10 플러그인이 webpack config를 주입하면 빌드가 "webpack config found"로 실패할 수 있다 — Sentry 10은 Turbopack을 지원하므로 정상 동작이 기대되나, 실패 시 `--webpack` 폴백 탈출구를 둔다. 이미지 기본값 변동(`qualities`→[75], `minimumCacheTTL`→4h)은 동작에 무해하므로 **새 기본값 수용**(핀고정 안 함).

**Files:**
- Modify: `next.config.mjs`
- Modify: `package.json` (필요 시)

- [ ] **Step 1: 이미지 기본값 수용 결정 박제 (주석만)**

`next.config.mjs`의 `images` 블록 위에 주석 추가:
```js
  // [Next 16] images.qualities 기본 [75], minimumCacheTTL 기본 4h 수용.
  // remotePatterns만 사용(images.domains는 deprecated, 우리는 미사용).
  images: {
```

- [ ] **Step 2: Turbopack 프로덕션 빌드 (dev 서버 종료 후)**

> ⚠️ dev 서버 종료 필수. Next 16은 dev 출력이 `.next/dev`로 분리되지만, 안전을 위해 종료.

Run:
```bash
npm run build
```
Expected: Turbopack 빌드 성공. 출력에 `▲ Next.js 16.x (Turbopack)` 류 표기. ISR 라우트(`/` 5m, `/products/[id]` 1h) prerender 정상.

- [ ] **Step 3: 빌드 실패 시에만 — `--webpack` 폴백**

> Step 2가 성공하면 이 Step은 **건너뛴다**.

만약 "webpack configuration was found" 또는 Sentry 플러그인 충돌로 실패하면, `package.json`의 `build` 스크립트를 폴백 처리:
```json
"build": "prisma migrate deploy && prisma generate && next build --webpack",
```
그리고 재실행:
```bash
npm run build
```
Expected: webpack 빌드 성공. (이 경우 ADR-0051에 "Turbopack 빌드 차단 → webpack 폴백" 사유 박제.)

- [ ] **Step 4: 빌드 산출물 그린 확인**

Run:
```bash
echo "build exit code: $?"
ls .next/BUILD_ID 2>/dev/null && echo "BUILD_ID present"
```
Expected: `BUILD_ID present`.

- [ ] **Step 5: Commit**

```bash
git add next.config.mjs package.json
git commit -m "chore(next16): accept new image defaults + verify Turbopack build

- accept images.qualities [75] / minimumCacheTTL 4h defaults (harmless)
- Turbopack default build verified with Sentry 10 plugin

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: ESLint flat config 전환

> Next 16은 `next lint` 명령을 **제거**했고, `next build`는 더 이상 lint를 실행하지 않는다. `@next/eslint-plugin-next`는 flat config를 기본으로 한다. ESLint 9 + flat config로 전환한다(빌드 경로 밖이라 위험 낮음).

**Files:**
- Create: `eslint.config.mjs`
- Modify: `package.json`
- Delete (존재 시): `.eslintrc.json`

- [ ] **Step 1: 기존 eslint 설정 형태 확인**

Run:
```bash
ls -la .eslintrc* eslint.config.* 2>/dev/null; cat .eslintrc.json 2>/dev/null
```
기존 `.eslintrc.json` 내용(extends 등)을 파악해 flat config로 이전.

- [ ] **Step 2: ESLint 9 + flat config 설치**

Run:
```bash
npm install -D eslint@^9
```

- [ ] **Step 3: `eslint.config.mjs` 생성**

```js
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const eslintConfig = [
  ...compat.config({
    extends: ["next/core-web-vitals", "next/typescript"],
  }),
  {
    ignores: [".next/**", "node_modules/**", "prisma/**"],
  },
];

export default eslintConfig;
```

> `@eslint/eslintrc`(FlatCompat)는 `eslint-config-next`의 legacy extends를 flat으로 브리지한다. 미설치 시 `npm install -D @eslint/eslintrc`.

- [ ] **Step 4: lint 스크립트 교체 + 구 설정 제거**

`package.json`:
```json
"lint": "eslint .",
```
그리고 구 설정 제거:
```bash
rm -f .eslintrc.json
```

- [ ] **Step 5: lint 실행 (그린 또는 기존과 동일 수준)**

Run:
```bash
npm run lint
```
Expected: ESLint 9 flat config로 실행됨. 신규 에러가 나오면 기존 baseline과 비교 — 업그레이드로 인한 규칙 변화면 `ignores`/rule 조정, 실제 코드 문제면 별도 기록(이번 범프 범위 밖이면 주석 처리하지 말고 후속 이슈로).

- [ ] **Step 6: Commit**

```bash
git add eslint.config.mjs package.json package-lock.json
git rm -f .eslintrc.json 2>/dev/null || true
git commit -m "chore(lint): migrate to ESLint 9 flat config (next lint removed in 16)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: QA 종합 증거 + ADR/문서

> 🔬 QA Engineer 발동: 전체 파이프라인을 증거 기반으로 그린 확인하고, 확정된 3대 결정을 ADR-0051로 박제한다.

**Files:**
- Create: `docs/superpowers/adr/0051-next16-upgrade-de-risked.md`
- Modify: `docs/superpowers/adr/README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: 종합 자동 증거 수집**

Run (각각 출력 인용):
```bash
npm run typecheck
npm run test
npm run lint
node --version && npx next --version
```
Expected: typecheck PASS / 전체 test PASS / lint 그린 / `Next.js 16.x`.

- [ ] **Step 2: dev 런타임 스모크 (자동화 가능분만)**

Run (백그라운드 dev 기동 후):
```bash
npm run dev &
sleep 8
curl -s -o /dev/null -w "home %{http_code}\n" http://localhost:3000/
curl -s -o /dev/null -w "pdp  %{http_code}\n" http://localhost:3000/products/$(node -e "console.log('seed-id-placeholder')")
curl -s -o /dev/null -w "api-ratelimit %{http_code}\n" http://localhost:3000/api/health 2>/dev/null
kill %1 2>/dev/null
```
Expected: 홈 200, PDP 200(또는 유효 seed id로 200), middleware 경유 `/api/*` 정상. (실 seed id는 `prisma studio` 또는 시드 로그에서 확인.)

> 미들웨어 Edge 동작(rate-limit/CSP nonce)·ISR 캐시·결제 Mock 플로우 등 **자동화 불가 항목만** 사용자 수동 확인 요청(절차·기대·실패 시 첨부 명시).

- [ ] **Step 3: ADR-0051 작성**

`docs/superpowers/adr/0051-next16-upgrade-de-risked.md` 생성 (template.md 4섹션 고정):
- **Context:** Phase 5-B Next 16 범프. 두 변화(프레임워크 버전 + 캐시 철학)가 한 릴리스에 묶여 분리 진단 불가 위험.
- **Decision:** ①middleware.ts 유지(proxy 거부, Edge 사수) ②Cache Components Phase 5-C 이연(revalidateTag 2-arg만 방어) ③Sentry 10 선행 격리 업그레이드.
- **Consequences:** middleware deprecation 경고 잔존(허용). revalidateTag `'max'`로 SWR 시맨틱(즉시성은 revalidatePath 보완). Turbopack 기본 빌드.
- **Alternatives Considered:** proxy.ts 전환(nodejs 강제→Edge 보안경계 재검증 비용으로 거부) / cacheComponents 즉시 채택(범프와 섞이면 롤백 단위 비대·진단 불가로 거부) / Sentry 9 경유 단계 업(중간상태 검증 애매·9는 Next16 peer 미보장으로 거부) / updateTag 채택(Cache Components 미도입 상태에선 과설계로 보류).

ADR 작성 후 `docs/superpowers/adr/README.md` 인덱스에 한 줄 추가.

- [ ] **Step 4: CLAUDE.md §8 진행 노트 갱신**

`CLAUDE.md` §8의 진행 상황 라인에 Phase 5-B 완료를 추가:
```
**Phase 5-B(Next.js 16 업그레이드) 완료** — Next 15→16 + React 19.2 + Sentry 8→10 메이저 범프를 "동작 보존"으로 격리 수행. middleware.ts 유지(proxy 거부, Edge 사수)·revalidateTag 2-arg(`'max'`) 호환·Turbopack 기본 빌드·ESLint 9 flat config. Cache Components는 Phase 5-C로 이연([ADR-0051]).
```
그리고 "다음 작업자의 혼란 방지 노트 (Phase 5-B)" 블록 추가:
- "왜 middleware.ts 그대로인가? 16은 proxy.ts 권장인데?" → ADR-0051. proxy는 nodejs 고정 = Edge 사수 불가.
- "revalidateTag에 왜 `'max'`가 붙었나?" → 16 시그니처 강제. SWR 프로파일, 즉시성은 revalidatePath가 보완.
- "빌드가 왜 Turbopack인가? webpack 폴백은?" → 16 기본 Turbopack. Sentry 10 호환. 실패 시 `next build --webpack`.

- [ ] **Step 5: 플랜 체크박스 최종 반영 확인 (커밋 전)**

Run:
```bash
grep -n "\- \[ \]" docs/superpowers/plans/2026-06-11-next16-upgrade.md
```
Expected: 완료된 Task의 미체크 항목 0건. 남아있으면 즉시 `[x]` 처리 후 커밋.

- [ ] **Step 6: Commit (docs)**

```bash
git add docs/superpowers/adr/0051-next16-upgrade-de-risked.md docs/superpowers/adr/README.md CLAUDE.md docs/superpowers/plans/2026-06-11-next16-upgrade.md
git commit -m "docs(adr): 0051 Next 16 upgrade de-risked (middleware retained, cache deferred, Sentry isolated)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Checklist (작성자 점검 완료)

- **Spec coverage:** 검토에서 식별한 7개 변경(Sentry/revalidateTag/Turbopack/middleware/next-lint/image/cacheComponents) 모두 Task에 매핑됨 — cacheComponents는 "의도적 비채택"으로 Task 6 ADR에 박제, 나머지 6개는 T1~T5에 구현.
- **Placeholder scan:** 모든 코드/명령 구체화. `seed-id-placeholder`는 런타임 스모크의 실 seed id 치환 지점으로 명시(플레이스홀더가 아니라 조회 지시).
- **Type consistency:** `revalidateTag(tag, "max")` 시그니처가 9곳 전부 동일. 태그 헬퍼(`tagProductDetail`/`tagDeparturesByProduct`/`TAG_*`) 명칭은 entities 정의와 일치 확인.

## 검증 게이트 (Task별 그린 기준)
- T1: typecheck + test + build(webpack/Next15) 그린 → Sentry 10 격리 검증
- T2: typecheck (revalidateTag 9건 에러만 허용)
- T3: typecheck 완전 그린 + 액션 test
- T4: Turbopack build 그린
- T5: lint 그린
- T6: 전체 파이프라인 + dev 스모크 + ADR
