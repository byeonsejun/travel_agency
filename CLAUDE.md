# Nextour — Agent Operating Manual

> AI 기반 맞춤형 패키지 여행 플랫폼. Next.js 15 App Router + FSD(Feature-Sliced Design).
> 이 문서는 **이 저장소에서 작업하는 모든 AI 에이전트(Claude Code, Cursor 등)** 를 위한 라우팅·운영 지침이다. 사용자 지시와 충돌하면 사용자 지시가 우선.

---

## 1. 기술 스택 (요약)

- **Framework**: Next.js 15 (App Router), TypeScript strict
- **Data**: Prisma 5 + PostgreSQL
- **UI**: Tailwind CSS, RSC 우선
- **Validation**: Zod 3 (외부 입력 파싱 표준)
- **Test**: Vitest 2 + TDD
- **Architecture**: FSD — `app → widgets → features → entities → shared` (단방향)

## 2. 프로젝트 구조

```
src/
  app/        # 라우팅·페이지·layout·error/not-found. 비즈니스 로직 금지.
  widgets/    # entity UI 조합. 직접 DB 호출 금지.
  features/   # 사용자 인터랙션 단위 (예: checkout, search). 'use client' 허용.
  entities/   # 도메인 모듈 (product, departure, booking…). model/api/ui.
  shared/     # 도메인 무지 유틸·UI·db client.
docs/superpowers/
  skills/     # ↓ 아래 스킬 라우팅 표 참조
  plans/      # 실행 가능한 구현 계획 (체크박스 단위)
  specs/      # 설계 문서
prisma/       # schema.prisma, seed.ts
```

---

## 3. AI 페르소나 오케스트레이션 — 5인 Agile Squad

이 저장소의 AI 에이전트는 **5명의 역할 분리된 페르소나**로 동작한다. 각 페르소나는 `docs/superpowers/skills/` 아래의 마크다운에 정의되어 있으며, 작업의 파일 경로·도메인·단계에 따라 **자동 발동(Load)** 된다. 매 작업 시작 전, 아래 매트릭스로 활성 페르소나를 식별하고 해당 파일을 컨텍스트에 로드한다.

### 3.1 5인 페르소나 역할 한 줄 요약

| 페르소나 | 파일 | 한 줄 책임 |
|---|---|---|
| 🏛️ **Architect** | `architect.md` | FSD 단방향 의존성·barrel 공개 API·레이어 책임 분리 수호 |
| 🎨 **Frontend Expert** | `frontend-expert.md` | RSC 우선, React 19 패턴, 메모리 누수(timer/listener/fetch) 방어 |
| ⚙️ **Backend Expert** | `backend-expert.md` | Prisma 성능(N+1 차단)·NextAuth·Server Actions·캐시 정책 |
| 🔬 **QA Engineer** | `qa-engineer.md` | 수동 검증 떠넘김 금지, curl/jq/DB로 자가 증거 수집 후 보고 |
| 💳 **Domain Booking** | `domain-booking.md` | 좌석 hold·2-phase 결제·웹훅 멱등성·상태머신 무결성 |

### 3.2 오케스트레이션 매트릭스 (자동 발동 트리거)

| 작업 영역 / 트리거 | 🏛️ Architect | 🎨 Frontend | ⚙️ Backend | 🔬 QA | 💳 Booking |
|---|:---:|:---:|:---:|:---:|:---:|
| `src/**` 신규 파일 작성 / 슬라이스 생성 | **필수** | 도메인별 | 도메인별 | — | — |
| `src/app/**/page.tsx`·`layout.tsx` | **필수** | **필수** | 권장 | — | — |
| `src/features/**/ui/**`·`'use client'` 컴포넌트 | **필수** | **필수** | — | — | — |
| `useEffect`·`useState`·폴링·타이머·이벤트 리스너 | — | **필수** | — | — | — |
| `src/entities/**/api/**`·Prisma 쿼리 | **필수** | — | **필수** | — | booking 도메인이면 필수 |
| `src/app/api/**` route handler·Server Actions | **필수** | — | **필수** | — | 결제·예약이면 **필수** |
| `src/features/auth/**`·NextAuth·middleware | **필수** | — | **필수** | — | — |
| `prisma/schema.prisma`·마이그레이션 | 권장 | — | **필수** | — | booking/payment 모델이면 **필수** |
| `booking`·`payment`·`checkout`·`seat`·`refund` 도메인 | **필수** | 권장 | **필수** | **필수** | **필수** |
| 결제 웹훅 (`app/api/payment/webhook/**`) | **필수** | — | **필수** | **필수** | **필수** |
| **작업 완료 보고 직전 (verification phase)** | — | — | — | **필수** | — |
| 코드 리뷰 / PR review | **필수** | **필수** | **필수** | **필수** | 도메인 한정 |
| 시드·테스트 데이터·plan/spec 문서 | 권장 | — | — | — | — |

### 3.3 라우팅 트리거 (키워드 기반 자동 감지)

작업 요청이나 변경 파일 경로에 아래 키워드가 보이면 즉시 해당 페르소나를 로드한다.

- 🏛️ **Architect**: `entities/`, `widgets/`, `features/`, `shared/`, `index.ts`(barrel), `import`, "레이어", "의존성", "공개 API"
- 🎨 **Frontend Expert**: `'use client'`, `useEffect`, `useState`, `useTransition`, `useOptimistic`, `useActionState`, `useFormStatus`, `useRef`, `searchParams`, `params`, `next/image`, `Suspense`, "폴링", "메모리 누수", "이벤트 리스너", "cleanup", "hydration"
- ⚙️ **Backend Expert**: `app/api/**`, "Server Action", `db.`, `prisma`, `auth()`, "NextAuth", "JWT", "session", `$transaction`, `$queryRaw`, "캐시", "force-dynamic", "revalidate", "zod", "env"
- 🔬 **QA Engineer**: "검증", "테스트", "확인", "통과", "완료", `curl`, `jq`, "증거", "evidence", "수동", PR/리뷰 결과 보고 시점, "작업 완료"
- 💳 **Domain Booking**: `booking`, `payment`, `checkout`, `departure.bookedSeats`, `webhook`, `$transaction`, `refund`, `idempotent`, `providerEventId`, "status 전이", "좌석", "hold", "TTL", 가격·금액·`totalPrice`

### 3.4 적용 순서 (Multi-Persona 검토 우선순위)

여러 페르소나가 동시에 발동될 때 다음 순서로 검토한다 (안전 → 도메인 → 구조 → 코드 품질 → 검증):

1. 💳 **Domain Booking** (해당 도메인이면) — 돈·좌석 안전은 협상 불가
2. 🏛️ **Architect** — 레이어가 잘못되면 이후 클린업이 광범위
3. ⚙️ **Backend Expert** / 🎨 **Frontend Expert** — 파일 경로에 따라 병렬 적용
4. 🔬 **QA Engineer** — 작업 완료 직전 반드시 발동, 모든 검증을 증거 기반으로

각 페르소나의 리뷰 출력 형식은 해당 파일의 `Action` 섹션을 따른다. **위반 0건이면 해당 페르소나의 통과 메시지(`✅ ... 통과`)를 명시적으로 출력** — 침묵은 검토하지 않은 것과 구분되지 않는다.

---

## 4. 작업 흐름 (Universal Workflow)

모든 변경 작업은 다음 순서를 따른다:

1. **컨텍스트 파악** — 관련 파일 읽기, `MEMORY.md` 인덱스 확인, 관련 plan/spec 확인.
2. **페르소나 로드** — 3.2 매트릭스로 활성 페르소나 식별 후 해당 `docs/superpowers/skills/*.md` 읽기.
3. **TDD 우선** — 순수 함수·비즈니스 로직은 테스트 먼저 작성 → FAIL 확인 → 구현 → PASS 확인 (QA Engineer R5).
4. **자가 코드 리뷰** — 각 활성 페르소나의 Anti-patterns에 자가 점검 후 위반 메시지 출력.
5. **🔬 QA 자동 증거 수집** — 작업 완료 보고 직전 반드시 QA Engineer 발동:
   - `npm run typecheck` / `npm run test` / `npm run lint`
   - curl·jq·prisma로 런타임 동작 검증
   - 자동화 불가 항목만 사용자 수동 확인 요청 (절차·기대·실패 시 첨부 명시)
6. **체크박스 갱신** — plan 파일의 해당 태스크 항목을 즉시 `[x]` 처리.
7. **커밋** — Conventional Commits 형식 (`feat(scope): ...`, `fix(...): ...`).

---

## 4.1 Plan Execution — 체크박스 갱신 절대 규칙

> **이 규칙은 Non-negotiable이다. 위반 시 즉시 자가 중단 후 체크박스를 먼저 처리한다.**

`docs/superpowers/plans/` 아래의 플랜 파일(`*.md`)을 기반으로 작업할 때:

- **각 Task의 구현·검증이 완료되는 즉시**, 해당 Task의 모든 `- [ ]` 항목을 `- [x]`로 **파일에 직접 Write**한 뒤 다음 Task로 넘어간다.
- "머릿속에 기억해두고 나중에 한꺼번에 처리"는 금지. Task 단위로 그 자리에서 즉시 처리.
- QA 자동 증거를 수집하는 시점이 곧 체크박스를 갱신하는 시점이다 — 두 작업은 동시에 이루어진다.
- 커밋 전 `git diff docs/superpowers/plans/` 로 체크박스가 실제로 파일에 반영됐는지 확인 후 커밋.

**위반 탐지 방법** (QA Engineer가 자동 점검):
```bash
# 완료된 태스크에 미체크 항목이 남아있으면 즉시 중단
grep -n "\- \[ \]" docs/superpowers/plans/<current-plan>.md
```

---

## 4.2 Plan Authoring — 체크박스 초기화 절대 규칙 (Pre-checking 금지)

> **이 규칙은 Non-negotiable이다. Pre-checking은 작업의 진위를 즉시 파괴한다.**
> **실제 사고 사례: `docs/superpowers/plans/2026-05-14-payment.md` 작성 시 Task 2~18 + 최종 체크리스트가 사전 `- [x]`로 기입되어, 후속 작업자가 모든 Task가 완료된 것으로 오인할 뻔한 사고 발생. Task 0(복구) 절차로 강제 정정.**

`docs/superpowers/plans/` 아래의 **새 플랜 파일(`*.md`)을 작성·생성**할 때:

- **모든 Task의 체크박스는 반드시 미완료 상태(`- [ ]`)로 초기화**한다. 단 하나의 예외도 없다.
- **절대 미리 `- [x]`를 기입하지 마라.** 코딩·증거 수집 전에 사전 체크된 박스는 plan 신뢰성을 무너뜨리고, 다음 작업자가 완료 여부를 판별할 수 없게 만든다.
- `- [ ]` → `- [x]` 변경은 **오직 다음 3 조건을 모두 만족할 때만** 허용:
  1. 해당 Task의 구현이 완료됨
  2. QA Engineer R1·R8 증거 수집이 완료됨 (typecheck/test/런타임 출력 인용 가능)
  3. 위 1, 2가 끝난 **직후 그 자리에서** 하나씩 순차적으로 `[ ]` → `[x]`로 변경 (`§4.1`)

**위반 탐지** (Plan 신규 작성 직후 자동 점검):
```bash
# 새로 작성된 plan 파일에 [x]가 1건이라도 있으면 즉시 재작성
grep -n "\- \[x\]" docs/superpowers/plans/<new-plan>.md
# 기대: 출력 없음. 출력이 있으면 plan을 작성자가 즉시 재초기화한다.
```

**예외: 문서/예시 인용** — 본문 산문 내에서 체크박스 문법을 설명·인용할 때 `` `- [x]` `` 같이 백틱으로 감싼 경우는 실제 체크박스가 아니므로 무방.

---

## 5. 절대 규칙 (Non-negotiable)

위반 시 즉시 작업 중단하고 사용자 확인 요청.

**🛑 NO-REAL-MONEY (프로젝트 최상위 제약 — 모든 규칙에 우선)**
- 이 서비스는 **실제 돈이 빠져나가는 단계(라이브 실거래)까지 절대 구현·활성화하지 않는다.** 사용자의 영구 결정사항.
- ❌ `live_ck_`/`live_sk_` 등 토스 **운영(live) 키** 도입·요청·문서화.
- ❌ 실거래를 유발하는 설정(운영 키 + 실제 `api.tosspayments.com` 결제) 으로의 전환 작업.
- ❌ "프로덕션 실결제", "라이브 배포 후 소액 결제", 실 카드 과금을 전제로 한 코드·계획·태스크 생성.
- ✅ 허용 상한: **Mock(localhost:4242) 및 토스 샌드박스 테스트 키(`test_`) 까지만.** 결제 검증은 이 범위 내에서만 수행.
- 사용자가 명시적으로 이 제약을 철회하기 전까지 유효. 관련 요청을 받으면 즉시 중단하고 이 규칙을 인용해 확인 요청.

**🏛️ Architect**
- ❌ `entities/`, `widgets/`, `features/`, `shared/`의 깊은 경로 import (`@/entities/product/ui/...`).
- ❌ `entities/**/ui/*.tsx`에 `'use client'` 추가.
- ❌ 동일 레이어 cross-slice import (`widgets/A`가 `widgets/B` import 등).

**🎨 Frontend Expert**
- ❌ `app/**/page.tsx`·`layout.tsx`에 `'use client'` 선언.
- ❌ `useEffect` 내 `setInterval`/`setTimeout`/이벤트 리스너/구독에 cleanup 누락.
- ❌ 폴링 컴포넌트에서 `router.replace` 호출 전 `clearInterval` 누락.

**⚙️ Backend Expert**
- ❌ 클라이언트 컴포넌트에서 `db`(Prisma) import.
- ❌ `any`, `as any`, `@ts-ignore`, `@ts-expect-error` 사용.
- ❌ Server Action·route handler에서 입력 Zod 검증 누락.
- ❌ `process.env.X` 직접 접근 (반드시 `env.X`).
- ❌ middleware(Edge runtime)에서 Prisma 호출.

**💳 Domain Booking**
- ❌ 좌석·결제 도메인에서 `findUnique → 검사 → update` (TOCTOU). 반드시 `updateMany` 조건부 차감.
- ❌ 가격·금액을 `number`(float)로 표현. 정수(원 단위) 또는 `Decimal`만 허용.
- ❌ 결제 웹훅에서 멱등성 키(`providerEventId`) 검사 없이 처리.
- ❌ booking status 직접 할당 (반드시 `assertTransition` 통과 후 update).
- ❌ 단일 DB 트랜잭션에 외부 PG 호출 포함.
- ❌ 좌석 hold에 TTL(`holdExpiresAt`) 부재.
- ❌ 라이브 실거래 경로 구현·활성화 (상단 🛑 NO-REAL-MONEY 참조 — 샌드박스/Mock이 상한).

**🔬 QA Engineer**
- ❌ `typecheck`/`test` 실패한 채로 "구현 완료" 보고.
- ❌ 자동화 가능한 검증을 사용자에게 수동 확인 요청으로 떠넘김.
- ❌ "이론적으로 동작할 것" / "코드 읽어보니 맞다" — 실행된 명령의 출력 없이 통과 주장.

**공통**
- ❌ 순수 함수 내부에서 입력 배열 변이 (`arr.sort()` 직접 호출). `[...arr].sort()` 또는 `.toSorted()`.
- ❌ 사용자 명시 요청 없이 force push, `git reset --hard`, `--no-verify`, 브랜치 삭제.

## 6. 권장 패턴

- ✅ 모든 페이지 RSC 기본, `export const dynamic = "force-dynamic"` (Phase 2에서 캐시 튜닝).
- ✅ 외부 입력은 Zod로 파싱, 폴백은 `.catch()`.
- ✅ 독립 쿼리는 `Promise.all` 병렬화.
- ✅ 복잡 정렬·집계는 `db.$queryRaw` + `Prisma.sql` 태그드 템플릿 (SQL 인젝션 차단 + N+1 회피).
- ✅ 외부 이미지는 `next.config.mjs`의 `remotePatterns` 등록 후 `next/image`.
- ✅ Prisma 변경 시 마이그레이션 + seed 영향 동시 검토.

---

## 7. 커뮤니케이션

- **사용자 응답 언어**: 한국어 (기본).
- **코드·주석**: 한국어 주석 허용, 식별자는 영문.
- **커밋 메시지**: 영문 Conventional Commits.
- **plan/spec 문서**: 한국어 본문 + 영문 식별자.

### 7.1 보고 양식 절대 규칙 (인지적 과부하 방지)

> **이 규칙은 Non-negotiable이다.** 태스크 완료 보고 시, 장황한 코드 설명이나 단순 파일 수정 내역 나열은 절대 금지한다. 사용자의 피로도를 낮추기 위해 반드시 아래 3가지 포맷으로만 보고한다.

- 🏗️ **Core Architecture:** 트랜잭션, 멱등성, 외부 I/O, Mocking 등 시스템의 뼈대에 해당하는 핵심 설계 의도만 **3줄 이내**로 브리핑.
- ♻️ **Boilerplate:** 단순 UI, CRUD, 타입(DTO) 선언 등은 **한 줄로 요약**하여 스킵 처리.
- 🧠 **Concept Insight:** 이번 Task에서 사용된 핵심 백엔드/아키텍처 개념(예: Mock Server를 통한 외부 의존성 격리 등)을 **비유를 들어 1문단**으로 설명. (사용자의 시스템 이해도를 높이기 위한 목적)

**적용 시점:** 모든 Task 완료 보고, PR 본문, 종합 검증 보고. QA 자동 증거(typecheck/test/grep 출력)는 위 3개 섹션 *외부*에 짧게 인용 가능 — 증거는 검증을 위한 것이고, 위 3섹션은 의사결정 전달을 위한 것이다.

## 8. 기억해야 할 컨텍스트

- 🛑 **이 서비스는 라이브 실거래(실제 과금)를 구현하지 않는다.** 결제는 영구히 Mock/샌드박스(`test_` 키)까지만. §5 NO-REAL-MONEY 참조.
- 현재 Phase 1(Product 표시 모듈) 완료. Phase 2(예약/결제 + AI 검색) 진입 예정.
- 모든 페이지가 `force-dynamic` 상태 — Phase 2 후반에 도메인별 캐시 튜닝 PR로 분리.
- 시드 데이터는 `prisma/seed.ts`. 검증용 10개 상품(JP/VN/TH/EU/ID/PH).
- 자세한 진행 상황은 `docs/superpowers/plans/done/`의 완료된 plan 참조.

---

## 9. 참고 문서

- 페르소나: `docs/superpowers/skills/{architect,frontend-expert,backend-expert,qa-engineer,domain-booking}.md`
- 계획: `docs/superpowers/plans/`
- 설계: `docs/superpowers/specs/`
- Prisma: `prisma/schema.prisma`, `prisma/seed.ts`
