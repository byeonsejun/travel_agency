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

- ✅ 모든 페이지 RSC 기본. `force-dynamic` 은 안전 도메인(결제·예약·admin·webhook·cron) 한정 ([ADR-0020] 옵션 A 거부). 그 외는 ISR(`/products/[id]` 1h, `/` 5m) 또는 데이터 레이어 `unstable_cache`(5min/1h TTL).
- ✅ 외부 입력은 Zod로 파싱, 폴백은 `.catch()`.
- ✅ 독립 쿼리는 `Promise.all` 병렬화.
- ✅ 복잡 정렬·집계는 `db.$queryRaw` + `Prisma.sql` 태그드 템플릿 (SQL 인젝션 차단 + N+1 회피).
- ✅ 외부 이미지는 `next.config.mjs`의 `remotePatterns` 등록 후 `next/image`.
- ✅ Prisma 변경 시 마이그레이션 + seed 영향 동시 검토.

---

## 6.1 ADR (Architecture Decision Records)

> 코드와 commit log에는 *무엇을* 했는지 남지만, **왜 그렇게 했는지** — 특히 *고려했지만 거부한 대안* — 는 휘발된다. ADR이 그것을 박제한다.

**언제 발행** (다음 중 하나라도 해당):
- 여러 대안을 고민하고 한 쪽을 채택한 경우 (가장 흔한 트리거)
- 도메인 invariant·보안 경계·데이터 무결성에 영향을 주는 결정
- 차선책(workaround) 채택 — 상위 옵션이 제약 때문에 막혔을 때
- 기존 결정을 *뒤집을* 때 (이전 ADR을 `Superseded by ADR-XXXX` 로 마킹)

**언제 ADR 없이도 OK**:
- 단순 버그 수정 / 리팩토링 / 의존성 업그레이드 / 코드 스타일 변경
- 명확한 baseline path (대안 검토가 의미 없는 경우)

**위치 및 양식**:
- `docs/superpowers/adr/NNNN-kebab-case-title.md` (4자리 번호, 다음 번호 사용)
- `docs/superpowers/adr/template.md` 복사 후 채움 — 4섹션 고정(Context / Decision / Consequences / Alternatives Considered)
- `docs/superpowers/adr/README.md` 인덱스에 한 줄 추가
- ⭐ **Alternatives Considered**가 가장 가치 있는 칸 — 6개월 뒤 누군가 같은 옵션을 다시 고민하지 않도록 거부 이유까지 박제

**에이전트 행동 (Claude/Cursor 등)**:
- 작업 중 "옵션 A vs B" 를 사용자에게 묻고 한 쪽을 택했거나, 차선책을 채택한 경우 → 작업 완료 보고 직전 **ADR 작성 제안**을 한 줄 띄울 것 (예: "이 결정은 ADR-NNNN으로 박제할 가치가 있어 보입니다 — 추가할까요?")
- 사용자가 ADR 작성을 명시적으로 요청하지 않은 경우, 임의 발행 금지 (스팸 방지). 단 ADR 후보로 인지된 결정은 보고서 말미에 짧게 기록할 것.
- 기존 결정과 충돌하는 변경을 하기 전에는 관련 ADR을 먼저 읽고, 위반 시 *왜 뒤집는지*를 새 ADR로 명시.

**커밋 메시지 컨벤션**: `docs(adr): NNNN <짧은 제목>` (Conventional Commits 형식).

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

- 🛑 **이 서비스는 라이브 실거래(실제 과금)를 구현하지 않는다.** 결제는 영구히 Mock/샌드박스(`test_` 키)까지만. §5 NO-REAL-MONEY 참조. ([ADR-0009], [ADR-0014])
- **Phase 1 + Phase 2 + Phase 3 B1 + B2 + B3 + Phase 4-A + 4-B + 4-C + Phase 5-A + 5-B + Phase 6 + Phase 7 완료** — Toss 웹훅 v2 envelope-first + cross-check([ADR-0013]/[ADR-0016]), 환불 Saga 3-phase([ADR-0003]), Cron 멱등 워커([ADR-0005]), 위시리스트 island + PDP ISR 시리즈([ADR-0012]/[ADR-0015]/[ADR-0017]/[ADR-0018]/[ADR-0019]), 데이터 레이어 unstable_cache 확장 + 무효화 컨트랙트 SSOT([ADR-0020]), Sentry SDK([ADR-0021]) + CSP 경로별 nonce([ADR-0025]) + 정적 보안 헤더 7종([ADR-0039]), Rate Limit 4-tier hybrid 통합([ADR-0022]/[ADR-0023]), Admin CMS + 비동기 임베딩 파이프라인([ADR-0026]), Departure CMS + 좌석/가격 안전([ADR-0027]), 출발 취소 Cascade — 부모 배치 오케스트레이션 + 부분 실패 복구([ADR-0028]), 리뷰 시스템 완성 — 어드민 모더레이션(PUBLISHED↔HIDDEN) + PDP 더보기 island + 별점 분포·라이트박스([ADR-0029]), 거래 종료 알림 메일 파이프라인 — 트랜잭셔널 아웃박스 + Resend 멱등 발송 + React Email 템플릿([ADR-0030]), 부분 환불·시간경과 위약금 정책 — 표준약관 정률 + 동결 스냅샷 + PARTIAL_CANCELED([ADR-0031]), 관리자 운영 대시보드 — `entities/analytics` 통합 read-model + Recharts `'use client'` 리프 격리([ADR-0032]/[ADR-0033]), **네비게이션 UX & 렌더링 성능 — 라우트 `loading.tsx` 스켈레톤 + `useTransition` 펜딩 + PDP Suspense 스트리밍 + 전역 trickle 진행 바([ADR-0035])** 박제 완료. **Phase 8 완료** — Ledger 다회 부분 환불 시스템 — Payment.refundedAmount 물질화 카운터 + 조건부 차감 동시성 + RefundJob 원장화 + Traveler unitPrice 스냅샷 + refundTraveler/refundDiscretionary 사가 + admin UI islands([ADR-0036]). **Phase 11(보안 격상) 완료** — 정적 보안 헤더 7종 + CSP report-only→enforce 롤아웃 게이트([ADR-0039]), `mutation` tier 신설 + 변형 Server Action 미들웨어 우회 갭 봉합(`onBlock` 반환모드 — checkout/booking-cancel/review-upload/passport 4곳 래핑, [ADR-0040]). **Phase 12(여권 PII 암호화) 완료** — AES-256-GCM + `enc:v1:` envelope lazy 마이그레이션([ADR-0041]). **Phase 13(부분 환불 완료 메일) 완료** — Ledger 부분환불(refundTraveler not-last/refundDiscretionary)이 booking 전이를 안 하던 갭을 메워, settle Tx 아웃박스에 `PARTIAL_REFUND_COMPLETED` 적재 + `refundJobId` 멱등 식별 + FULL_CANCEL 중복 차단([ADR-0042], PR #11). **Phase 14(상품별 위약금 정책 CMS) 완료** — `entities/penalty-policy` 불변 버전 정책(append-only) + 예약 시점 reference-snapshot + 3단계 폴백(departure→product→시스템 기본) + 100% 위약금 `refundAmount===0` Toss-skip 가드 + FULL_CANCEL terminal 마감([ADR-0043], PR #12). **Phase 15(리뷰 신고 & 모더레이션 큐) 완료** — `ReviewReport` 테이블(report-driven, Review.status 불변) + `createReviewReport` 멱등(P2002 흡수) + `resolveReportsByHiding`(단일 Tx, 전이 가드) + `dismissReports` + admin 큐(`listReviewsWithOpenReports`, OPEN 존재 기준) + 신고 패널(`getReportsForReview`, PII 마스킹) + PDP `ReportReviewButton` 모달(본인 제외·타이머 cleanup·rate-limit) + admin "신고됨" 탭 report-driven 분기 + 상세 `ReportModerationActions` client island. **Phase 16(검색 테마 부스트 graduated) 완료** — `buildThemeScore`를 이진(`EXISTS → +0.1`)에서 요청 커버리지 비율(`0.1 × matchCount/requested`)로 전환, 천장 0.1 유지로 가중치 밸런스 무손상 + 순수 함수 `themeBoost` SSOT/SQL 미러 이원 테스트 + 폴백 binary 회귀 가드([ADR-0045]). **UI 전면 개편(A1 "클린 블루") 완료** — `(site)` 공개 셸 전 페이지(홈/목록/PDP/검색/비교/로그인/마이페이지)를 shadcn/ui(Radix) + 디자인 토큰(globals.css HSL CSS 변수 → tailwind.config) + Pretendard(`next/font/local`)로 개편. 백엔드·결제·예약 도메인 로직 0줄 변경, ISR(홈 `○` 5m / PDP `●` 1h) 보존(PR #15, merge `fb95cd6`). **Phase 5-B(Next.js 16 업그레이드) 완료** — Next 15→16.2.9 + React 19.2 + @sentry/nextjs 8→10 메이저 범프를 "동작 보존"으로 격리 수행. middleware.ts 유지(proxy 거부, Edge 사수)·revalidateTag 2-arg(`'max'`) 호환·Turbopack 기본 빌드(Sentry 10 호환, --webpack 불요)·ESLint 9 flat config(next lint 제거 대응)·next-auth beta peer overrides 핀. Cache Components는 Phase 5-C로 이연([ADR-0052]). **Phase 5-C Task 1(react-hooks@7 재활성화) 완료** — Phase 5-B에서 parity 위해 끈 14규칙 전부 `error` 재활성화 + 위반 8곳(7 set-state-in-effect, 1 refs)을 React 19 컴파일러-친화 패턴으로 리팩터(prop-sync→렌더 중 조건부 setState, post-action→파생 open/수동 transition, async-fetch→loadedKey 파생, objectURL→이벤트 핸들러 생성+effect는 revoke만). 서버·도메인 로직 0줄 변경, 전부 `'use client'` 리프 한정. lint 0 errors / typecheck 0 / 1170 tests green. **Phase 5-C(Cache Components 전역 전환) 완료** — `cacheComponents: true` ON + 2-gate 마이그레이션([ADR-0053]). Gate1: route segment config 43곳(force-dynamic 31/runtime 10/revalidate 2) 전량 제거 + `unstable_cache` 20곳→`use cache`(cacheTag/cacheLife) + 잠복 누출 봉합(client→배럴→use cache 15건: prop 주입 2 + DRILLDOWN_COLUMNS feature 이관 1). Gate2: 동적 page를 `<Suspense>` 격리(admin 16곳은 layout 단일 Suspense, 전 site는 WebVitalsReporter Suspense 1줄, 결제·예약·login·compare는 페이지별 — 반복 빌드 0 수렴). 무효화 9곳 `revalidateTag(_,'max')`→`updateTag` 일원화(Next 16 revalidateTag 2-arg 강제, 1-arg는 updateTag뿐). `shared/ui/TransactionFallback` SSOT(form/detail/confirm). 결과: **build 68/68 GREEN**, 안전 도메인 16곳 `◐`(PPR, 정적셸+per-request 스트리밍, 셸에 민감데이터 0 누출 실증), route handler 10곳 `ƒ`, home `○` 5m/PDP `◐` 1h, `○`는 home+not-found뿐. typecheck 0 / test 1188 / lint 0. 서버·도메인 로직 0줄 변경.
- **"일관성 → 문서화 → 알고리즘" 3단계 로드맵 완료 (2026-06-10 확정 → 완료)** — 디자인 시스템 기반(shadcn 프리미티브 8종 `src/shared/ui/{button,card,input,tabs,badge,select,dropdown-menu,sheet}.tsx` + `cn()` `src/shared/lib/utils.ts` + 토큰) 구축 완료. 3단계 모두 완료:
  1. **[완료, 2026-06-10] Admin 셸 A1 적용** — `(admin)` 셸 전체(17 페이지 + admin islands + 대시보드)를 A1 클린 블루로 통일. `Table` 프리미티브(9번째) 신설 + `Badge` 의미색 tone 4종(success/warning/info/neutral) 확장. 백엔드·도메인 로직 0줄 변경. PR `feat/admin-ui-revamp-a1`.
  2. **[완료, 2026-06-10] ADR 발행 (문서화 부채 청산)** — REPORTED status-flip 포기 + report-driven 큐 결정은 이미 [ADR-0044](Phase 15)에 박제돼 있어 중복 발행 안 함. admin A1 개편의 "도메인 의미색(tone) 분리 추상화 + Table 프리미티브 + FSD 경계 수호" 결정은 [ADR-0048] 신규 발행.
  3. **[완료] 검색 알고리즘 고도화 → 변별력 하네스 구축 + 가중치 의도적 미튜닝** — golden-query 셋 + nDCG eval **변별력 하네스** 구축 완료(`scripts/search-eval/`, `npm run search:eval`/`search:judge`, LLM-judge 반순환 라벨 [ADR-0055]). 단 가중치 벡터(0.5)/키워드(0.2)/geo(0.2)/테마(0.1)는 **의도적으로 미튜닝** — 작은 카탈로그(~12개 상품)에 튜닝하면 과적합되어 일반화 실패. 하네스만 갖추고 실제 튜닝은 카탈로그가 충분히 커질 때까지 보류([ADR-0054]).
- **현재 상태: main 안정화 + 최종 손질 단계 (2026-08-25)** — 3단계 아크 종료 후 main에 누적된 것: 랜딩 폴리시(패럴랙스·테마 벤토), 체크아웃 시그니처(토큰화 + 이벤트소싱 타임라인 + 잔여석), 검색 eval 변별력 하네스, ADR 0054~0061, 엔지니어링 판단 회고 글(`docs/engineering-judgment.md`) + README 상단 링크, Playwright E2E(자기정리 teardown) + 검증된 prod 빌드(홈 `○`), cascade 환불 원장 정합화 + `refundedAmount` 음수 잠복버그 봉합([ADR-0059]). **단위 테스트 전량 통과**(`npm run test` 그린 — 개수는 계속 늘어나므로 미기재). 의사결정 기록은 `docs/superpowers/adr/`(0054~0061) + `docs/engineering-judgment.md`에 있음.
  - **남은 작업(최종 전면 손질)**: 데모 이미지 교체, 엔지니어링 글에 E2E·cascade 챕터 추가, README 다듬기, SMS/카카오 알림 채널 **의도적 제외** 결정 박제.
  - 백로그(현 범위 밖, 의도적 보류): 추가 알림 채널(SMS/카카오) — 의도적 제외 방향, 출발취소 cascade 위약금 옵션.
- **다음 작업자의 혼란 방지 노트 (FSD 배럴 강제, 2026-08-25, [ADR-0061])**:
  - "깊은 경로 import(`@/entities/product/ui/X`)가 왜 lint 에러지?" → [ADR-0061]. `eslint.config.mjs`의 `no-restricted-imports`가 R2(배럴 공개 API)를 **기계적으로 강제**한다. 문서 규칙이 아니라 CI를 막는 error. 필요한 심볼이 배럴에 없으면 **예외를 늘리지 말고** 해당 슬라이스 `index.ts`에 명시적 named export를 추가할 것(`export *` 금지).
  - "예외가 왜 `@/entities/*/client`·`@/features/*/server` 둘뿐이지?" → 이 둘은 회피구가 아니라 **정식 2번째 공개 API**다. `client.ts`=client가 server 그래프를 끌어오지 않게, `server.ts`=server가 client 그래프를 끌어오지 않게 하는 대칭 엔트리. 새 슬라이스에 관성적으로 만들지 말 것 — **배럴이 양쪽 그래프를 섞어 노출할 때만** 만든다(auth 배럴이 `use client` 아일랜드 5종을 함께 export하는 상황이 그 조건이었다).
  - "`auth()`는 어디서 가져오나?" → 서버(page·route handler·Server Action)는 `@/features/auth/server`, UI 컴포넌트는 `@/features/auth`. 테스트의 `vi.mock("@/features/auth/server/auth")`는 **하부 모듈 경로 그대로 유지**할 것 — 서브배럴이 re-export하므로 mock이 관통하고, 서브배럴로 올리면 다른 경유 경로를 놓친다.
  - "lint가 다 잡아주나?" → 아니다. 알려진 사각 2곳: (a) lint 범위가 `src/`뿐이라 `tests/`·`scripts/`는 미검사 (b) 규칙이 `@/` alias만 봐서 상대경로 cross-slice import(`../../features/x/ui/y`)는 미탐지. 둘 다 닫으려면 `eslint-plugin-boundaries` 급이 필요 — [ADR-0061] known gap에 박제됨.
- **다음 작업자의 혼란 방지 노트 (Phase 5-B)**:
  - "왜 middleware.ts 그대로인가? 16은 proxy.ts 권장인데?" → [ADR-0052]. proxy는 nodejs 고정 = Edge 사수 불가. NextAuth/rate-limit/CSP의 Edge 실행 보존 불가. deprecation 경고는 의도적 수용.
  - "revalidateTag에 왜 `'max'`가 붙었나?" → (해소됨, Phase 5-C) 16 시그니처 강제(2-arg). Phase 5-C에서 `'max'` 워크어라운드 9곳 전부 `updateTag(tag)`로 청산. **주의: 16의 `revalidateTag`는 영구히 2-arg(`(tag, profile)`)이고 1-arg 무효화기는 `updateTag`뿐** — Server Action 무효화엔 `updateTag` 사용([ADR-0053] §4 amend).
  - "빌드가 왜 Turbopack인가? webpack 폴백은?" → 16 기본 Turbopack, Sentry 10과 호환되어 폴백 불요. 필요 시 `next build --webpack`.
  - "next-auth 설치 시 `--legacy-peer-deps` 필요했나?" → 아니오. package.json `overrides`로 next-auth의 next peer를 핀 고정해 클린 설치. beta가 16 peer를 공식 지원하면 overrides 제거.
  - "lint에서 react-hooks 규칙이 일부 꺼져 있다?" → (해소됨, Phase 5-C Task 1) react-hooks@7 14규칙 **전부 `error`로 재활성화 완료**. Phase 5-B 시점엔 parity 위해 비활성이었으나(classic `rules-of-hooks`/`exhaustive-deps`는 그때도 활성), 위반 8곳을 컴파일러-친화 패턴으로 리팩터 후 전면 활성화. `eslint.config.mjs`에 더 이상 react-hooks `"off"` 라인 없음 → 새 위반은 즉시 lint 게이트가 차단.
- **다음 작업자의 혼란 방지 노트 (Phase 5-C Cache Components, [ADR-0053])**:
  - "`next build`가 의도적으로 깨지는 구간이 있었다?" → 2-gate masking. `cacheComponents: true`는 전역 스위치라 켜는 순간 Gate1(config export 43 비호환)이 먼저 죽고, 그걸 다 지워야 Gate2(동적 page Suspense)가 *비로소* 노출된다. "config 다 지웠는데 또 깨진다"가 정상. 단일 빌드 = 빙산의 일각.
  - "안전 도메인(결제·예약·admin)이 왜 `ƒ`가 아니라 `◐`(PPR)인가? 정적으로 오염된 것 아닌가?" → 아니다. `◐`=정적 셸(skeleton)만 prerender + **민감 데이터는 `<Suspense>` 뒤에서 per-request 스트리밍**. `.next/server/app/*.html` 셸을 grep하면 session/결제키/예약 데이터 0(실증). 오히려 `○`(완전 정적)가 위험인데 안전 page는 `○` 0건. route handler(webhook/confirm/cron)만 `ƒ`.
  - "client 컴포넌트에서 `@/entities/{analytics,departure,product}` 배럴을 value import하면?" → **금지**(빌드 깨짐). 배럴이 `use cache` 함수를 re-export하므로 서버 그래프가 client 번들로 compile돼 `"use cache" in Client Components` 에러. 직렬화 가능 상수는 **서버부모가 prop 주입**(`badgeThreshold`·`presets` 선례), 접근자 함수 등 non-serializable 프레젠테이션은 **feature로 이관**(`drilldownColumns.ts` 선례), 타입은 `import type`만. typecheck/test는 못 잡고 `npm run build`만 잡는다.
  - "admin 16 page엔 왜 개별 Suspense가 없나?" → `(admin)/admin/layout.tsx`가 top-level `auth()`(공통 차단원)를 `AdminAuthedShell` 단일 `<Suspense>`로 감싸 가드+nav+children을 동봉 → children이 그 경계 안에 수렴해 16곳이 동시 해소. 가드(redirect)는 children 렌더 전에 실행돼 순서 보존. admin page 새로 추가 시 page 레벨 Suspense 불요.
  - "전 (site) 페이지가 한 번에 풀린 이유?" → `(site)/layout.tsx`의 `WebVitalsReporter`(`usePathname()` 동적)가 공통 차단원이라 `<Suspense fallback={null}>` 1줄로 해소(GlobalRouteProgress 선례). 새 전역 client island(동적 훅) 추가 시 동일하게 Suspense로 감쌀 것.
  - "결제 페이지 GET이 307이 아니라 200으로 나온다?" → 정상. 가드가 Suspense 자식에서 발화하면 shell(200)이 먼저 flush되고 redirect가 스트리밍된다. 본문엔 skeleton + `/login` redirect만, 결제폼·clientKey는 0 누출(실증). 보안 동일.
  - "dev에서 PDP 캐시 hit/`updateTag` 무효화가 안 보인다?" → 정상. `next dev`는 `use cache`를 우회(매 요청 재실행). 캐시·무효화는 **prod(`next start`)에서만 관측**. 무효화 배선은 Phase 2 단위테스트(`updateTag×N` 단언)가 증명.
  - "결제·예약 로딩 스켈레톤을 바꾸려면?" → `shared/ui/TransactionFallback`(variant: form/detail/confirm) 한 곳. checkout=form·bookings/[id]=detail·success=confirm·failed=form. login/compare/admin은 별도(트랜잭션 아님).
  - "PDP/home revalidate를 바꾸려면?" → 이제 `export const revalidate` 없음. 데이터 fn의 `cacheLife({ revalidate })`가 SSOT(getFeaturedProducts 300s/getProductById 3600s). 페이지엔 config export 부활 금지(cacheComponents가 거부).
- **다음 작업자의 혼란 방지 노트 (Admin A1 개편, 2026-06-10)**:
  - "admin 상태 배지 색을 바꾸려면?" → 페이지/island 안의 `*_TONE` Record(`Record<Enum, "success"|"warning"|"info"|"neutral"|"destructive">`)만 수정. `shared/ui/badge`는 tone(추상)만 알고 도메인 enum은 모른다(FSD 경계). 라벨은 별도 `*_LABELS` 상수가 보존. tone→실제 색은 `badge.tsx`의 cva 한 곳.
  - "예약/결제 상태 배지는 왜 `Badge` tone을 안 쓰고 엔티티 컴포넌트(`BookingStatusBadge`/`PaymentStatusBadge`)를 쓰나?" → 이들은 8개 상태를 **각각 다른 의미색**(blue/emerald/purple/gray…)으로 구분 — 우리 5-tone으로 강제하면 PAID/READY/COMPLETED가 success로 뭉개져 정보 손실 + (site) 공유라 범위 침범. 의도적 미변경(원칙 2 신호등 보존).
  - "admin 테이블은 `shared/ui/table.tsx`(9번째 프리미티브) 사용. 수제 `<table>` 금지. red는 파괴적 액션(`Button variant=destructive`)+ADMIN 권한 배지에만 잔존(의미색)."
  - "Button에 `className="py-3"` 주지 마라 — 기본 `h-9`와 충돌해 패딩이 무시된다. 큰 CTA는 `size="lg"`."
  - "`booking-detail` 위젯은 (site)·(admin) 공유 — 여기 손대면 양쪽에 반영됨(A1은 양쪽 일관 의도)."
- **다음 작업자의 혼란 방지 노트 (UI 개편 A1)**:
  - "왜 `HomeRegionDeals`(client)가 ProductCard를 직접 안 그리고 `children`으로 받나?" → client island가 `@/entities/product` 배럴을 import하면 배럴이 re-export하는 `buildEmbeddingText`의 `node:crypto`가 클라이언트 번들로 누출돼 `UnhandledSchemeError`로 빌드가 깨진다. RSC 컴포지션으로 해결 — `(site)/page.tsx`(서버)가 region별 `<TabsContent>`+`ProductCard`를 렌더해 client 셸에 `children` 주입(ProductCard `heart`/`compareButton` 슬롯 의존성 역전과 동일 원리). **client 컴포넌트에서 entities/product 배럴 import 금지** — 서버 그래프가 따라온다.
  - "지역 탭이 왜 `regionOf`로 suffix를 떼나?" → 실데이터 `destination` 포맷이 "도시, 국가"(`오사카, 일본` — 국가가 suffix). `startsWith`(국가 prefix 가정)는 틀림. `buildRegionTabs`/`filterByRegion`는 표시 items에서 국가를 도출(빈 탭 방지). 순수함수 `src/widgets/home-region-deals/model/filterByRegion.ts` SSOT.
  - "SortSelect 테스트가 왜 DOM 시뮬이 아니라 순수함수인가?" → native `<select>`를 shadcn Select(Radix)로 교체하며 jsdom 구동이 불가해짐 → URL 빌드 로직(page 버림+destination 보존)을 순수함수 `nextSortUrl`로 추출해 단위테스트(`model/sortUrl.ts`). Radix 인터랙션은 typecheck/build로 커버.
  - "shadcn 프리미티브 radius가 왜 시안과 맞나?" → `button`/`input`의 `rounded-md`가 토큰상 `calc(var(--radius) - 4px)` = `0.875rem - 4px` ≈ 10px라 A1 스펙과 일치(별도 조정 불요). radius 전역 변경은 `globals.css`의 `--radius` 한 곳.
  - "포함/불포함의 green/red, 여권 등록/미등록 배지는 왜 토큰이 아닌가?" → 의미색(semantic)이라 의도적 유지. A1 토큰화는 gray/blue/indigo 등 무의미 색상만 대상. 상태를 전달하는 색은 보존.
- **다음 작업자의 혼란 방지 노트 (Phase 7)**:
  - "페이지 이동 진행 바가 왜 per-link 가 아니라 전역이지?" → [ADR-0035]. 초기 spec(§3.5)은 `useLinkStatus` per-link(`ProgressLink`)였으나 (a) 상품 카드·헤더 등 미적용 링크 누락 (b) prefetch 완료 시 미표시 한계로 폐기. `(site)` 레이아웃의 `GlobalRouteProgress` 단일 컴포넌트가 모든 내부 `<Link>` 클릭을 **capture 단계**(Link 의 preventDefault 보다 먼저)에서 잡는다. `(admin)` 등 다른 셸에 원하면 그 레이아웃에 `<Suspense><GlobalRouteProgress/></Suspense>` 추가.
  - "진행 바가 왜 실제 로딩 % 가 아니라 trickle 이지?" → App Router client 이동은 RSC 스트리밍이라 수신률 측정 불가 → determinate 원천 불가. 0→90% ease-out 점근 + 완료 시 100%(YouTube/nprogress 동일 방식). `infinite` 반복 슬라이드는 사용자 거부로 폐기.
  - "`/api/wishlist/check` 가 Network 탭에 빨간색(canceled)으로 자주 뜬다?" → **에러 아님**. PDP 가 ISR 유지 위해 위시리스트 상태를 `WishlistHeartIsland` mount 후 비동기 fetch 하는데([ADR-0018]), 응답 전 페이지를 떠나면 `useEffect` cleanup 의 `AbortController.abort()` 가 진행 중 요청을 정상 취소(메모리 누수 방지 모범사례). 서버는 200, 코드가 `AbortError` 를 조용히 무시. DevTools 가 취소를 빨간색으로 표시할 뿐.
  - "정렬/검색은 왜 전역 진행 바가 아니라 자체 스피너지?" → 정렬(`SortSelect`)·검색(`SearchBox`)은 `<a>` 클릭이 아니라 `router.push`(select change/form submit)라 `GlobalRouteProgress` 의 클릭 리스너가 못 잡는다. 대신 `useTransition` 의 `isPending` 으로 컴포넌트 내부 스피너 표시(역할 분담).
- **다음 작업자의 혼란 방지 노트 (Phase 8)**:
  - "왜 refundBooking이 5줄 래퍼로 바뀌었나?" → 전체 취소 = 모든 활성 여행자 refundTraveler 위임. 기존 인라인 70줄이 refundTraveler의 특수 케이스임을 인지하고 수렴. 하위호환 유지.
  - "DISCRETIONARY 환불이 왜 좌석/booking을 안 건드나?" → [ADR-0036]. 순수 머니무브 정책. 인원/좌석 조정은 별도 admin 작업. refundTraveler를 쓰면 좌석과 booking이 변동함.
  - "Payment.status가 왜 PARTIAL_CANCELED가 되나?" → refundedAmount < amount 상태. CANCELED는 refundedAmount >= amount. refundRetry.ts도 동일 기준.
  - "refundedAmount가 payment.amount를 초과할 수 있나?" → 불가. reserveRefund의 lte 조건이 원자적으로 차단. releaseRefund는 하한 없으나 isPermanentFailure + releaseRefund 단일 Tx 경로만 호출하므로 정상경로에서 음수 없음.
  - "부분환불 후 메일이 왜 안 오나?" → (해소됨, Phase 13) `PARTIAL_REFUND_COMPLETED` 메일이 [ADR-0042]로 구현됨. refundTraveler(not-last=`TRAVELER_CANCEL`)/refundDiscretionary 의 settle Tx 아웃박스에서 `EmailJob.refundJobId` 멱등 키로 적재 → cron 워커가 `getPartialRefundCompletedEmailData` 로 hydrate 후 발송, FULL_CANCEL 은 onSettled booking 전이의 `REFUND_COMPLETED` 와 중복되지 않게 차단. [ADR-0036] Notes 에 박제됐던 미구현 갭은 봉합됨.
  - "왜 skipSeatReturn이 필요한가?" → refundTraveler의 onSettled Tx에서 이미 정밀 좌석 환원(seatsReleased만큼) 후 transitionStatusTx를 호출한다. transitionStatusTx 내 shouldReturnSeats가 다시 전체 환원하면 이중환원 발생. skipSeatReturn: true로 차단.
- **다음 작업자의 혼란 방지 노트**:
  - "왜 어떤 페이지는 force-dynamic, 어떤 페이지는 ISR 이지?" → 도메인별 캐시 정책 분리. 결제·예약·웹훅·admin·cron 등 안정성 민감 도메인은 일부러 dynamic 유지(NO-REAL-MONEY + PPR 보류 정책, [ADR-0009] / [ADR-0020]).
  - "PPR opt-in 하면 더 깔끔하지 않나?" → 결정 시점에 experimental 이라 보류. [ADR-0012]/[ADR-0015]/[ADR-0017]/[ADR-0018]/[ADR-0020] 모두 같은 이유로 거부. PPR stable 승격 시 시리즈 일괄 재논의.
  - "wishlist hook 이 왜 `useOptimistic` 안 쓰지?" → [ADR-0019] 박제. Next dynamic 페이지의 `revalidatePath` no-op + transition 종료 시 base prop revert 의 조합으로 깜빡임 발생. manual `useState` + CustomEvent bus 가 채택.
  - "`getProductsByIds` 가 왜 per-id fan-out 태그를 쓰지?" → [ADR-0020] 박제. `tagProductDetail` 단일 namespace 를 PDP(`getProductById`) + 비교(`getProductsByIds`) 양쪽이 공유 → admin product 한 번의 `revalidateTag(tagProductDetail("X"))` 호출이 PDP + X 가 포함된 모든 비교 캐시 엔트리를 동시에 무효화. N-회 fan-out 호출 패턴(옵션 B)은 round-trip 증가로 거부.
  - "Rate Limit은 왜 middleware + wrapper 두 곳에 있지?" → 의도된 hybrid. middleware의 `global` tier는 *콜드스타트 비용 방어선* — pathname 무관 baseline. 각 route handler의 `withRateLimit` / Server Action의 `withRateLimitAction`은 *도메인별 정밀 한도*(auth=5/min IP, payment=10/min user, ai-search=20/min, mutation=20/min userFirst). middleware 단일 통합은 tier 식별이 pathname에 묶여 회귀 위험이 커 거부([ADR-0022]). Upstash 미설정 시 fail-open 강등([ADR-0023]) — cache graceful 패턴과 동일.
  - "변형 Server Action 은 어떻게 rate-limit 되나? (middleware 가 `/api/*` 만 잡던데)" → [ADR-0040] 박제. Server Action 은 *페이지* 경로로 POST 되어 middleware `global` tier(`/api/*` 한정)를 우회한다 → 명시적 `withRateLimitAction` 래핑만이 보호. Phase 11 에서 고위험 4곳(`createCheckoutBooking`·`cancelBookingAction`→payment, `signReviewPhotoUploads`/`submitReview`/`updatePassportProfile`→mutation)을 래핑. 차단 시 redirect 가 아니라 `onBlock` 으로 액션의 네이티브 에러 shape 을 *반환*(useActionState/island 계약 보존). payment tier 에 `idStrategy:"userFirst"` 재정의 이유 = `userOnly` 는 미인증 시 throw→500, 액션 자체 auth 가드가 우아한 에러를 내므로 IP 폴백이 옳음. admin·wishlist toggle·loadMore 는 의도적 미적용(YAGNI).
  - "`SENTRY_AUTH_TOKEN` 이 왜 Vercel 환경에서만 runtime 차단 invariant 가 풀려있지?" → [ADR-0024] 박제. Vercel UI 에 "Build only" scope 가 없어 Production 등록 시 빌드+런타임 모두에 주입 — middleware 매 호출 부팅 차단 → 사이트 down. ADR-0021 의 잘못된 가정 정정. Vercel runtime (`process.env.VERCEL === "1"`) 은 차단 skip, 비-Vercel(Docker/bare metal) 은 원래 invariant 유지. 보안은 (a) Sentry org token scope=`org:ci` (sourcemap upload 한정) (b) Vercel Sensitive 마스킹 (c) 런타임 코드 token 참조 0 의 다층 방어선으로 대체.
  - "왜 정적 페이지 CSP 가 dynamic 라우트보다 약한가?" → [ADR-0025] 박제. ISR 캐시와 요청별 nonce 간의 미스매치를 방지하기 위해 경로별로 CSP 를 분기함. `isDynamicCspPath()` SSOT 가 dynamic 9개 prefix(`/admin /checkout /payment /api /login /signup /booking /bookings /mypage`)에만 nonce + `'strict-dynamic'` 유지, 나머지 정적/ISR 경로는 `script-src 'self'` 로 완화. ADR-0020 캐시 정책 무손상. 새 force-dynamic 도메인 추가 시 `csp.ts` 의 `DYNAMIC_CSP_PREFIXES` 배열도 함께 갱신.
  - "왜 임베딩이 동기가 아닌가?" → [ADR-0026] 박제. 동기 호출은 admin UX 저하(OpenAI P99 ~2s) + OpenAI 장애가 상품 저장 실패로 전파됨. 비동기 큐(EmbeddingJob) + cron worker(*/2min, limit=5)로 분리. Product 저장 ↔ Job enqueue는 동일 `$transaction`으로 원자성 보장.
  - "contentHash 가 왜 SHA-256 인가? `updatedAt`이면?" → `updatedAt`은 무변동 저장(edit 페이지 열고 그대로 저장)에도 갱신됨 → 빈 OpenAI 호출 낭비 발생. 입력 텍스트 SHA-256으로 실제 콘텐츠 변경만 감지. modelVersion bump 시 hash 무관 강제 재호출(worker 분기 — [ADR-0026]).
  - "Departure CMS 는 왜 없는가?" → (해소됨, Phase 4-A) 이제 `/admin/products/[id]/departures`에 존재. B3에서 분리했던 이유(좌석·결제 안전)는 [ADR-0027]로 정리.
  - "출발 취소가 왜 예약 있으면 막히나?" → [ADR-0027] D1. 취소 cascade 환불은 별도 에픽(단건 Saga의 N-fan-out 부분실패 복구가 큼). 활성 예약(`bookedSeats > 0`)이면 `CANCELED` 전이 거부 → admin이 `/admin/bookings`에서 개별 취소 후 `bookedSeats=0`이 되어야 출발 취소 가능. fat-finger 일괄취소 방어.
  - "출발일 가격을 바꾸면 기존 예약은?" → [ADR-0027] D2. `Booking.totalPrice`는 예약 생성 시 복사한 스냅샷(참조 아님) → 가격 수정에 구조적 면역. 항상 허용 + 예약 존재 시 경고 배너만.
  - "왜 admin 좌석 가드는 raw SQL 없이 `updateMany`?" → [ADR-0027] D3. `bookedSeats`를 리터럴 입력값과 비교(`{ lte: newCapacity }` / `{ bookedSeats: 0 }`)하므로 Prisma where로 race-free. 컬럼식(`bookedSeats + N`) 비교가 필요한 소비자 `reserveSeats`만 raw 유지.
  - "DepartureStatus 전이 규칙 추가하려면?" → `entities/departure/model/transitions.ts`의 `ALLOWED_DEPARTURE_TRANSITIONS` 한 곳만 수정. admin 전이 버튼(`allowedNextStatuses`)이 SSOT를 읽어 자동 동기화. `CLOSED→SCHEDULED` reopen 허용, `CANCELED` terminal.
  - "예약 있는 출발일을 취소하면?" → (Phase 4-B) departure 편집의 "강제 취소"(`bookedSeats>0`) → `startDepartureCancellation` 단일 tx: departure 즉시 CANCELED + `DepartureCancellation` 배치 생성 + PAID는 `enqueueRefundJob`(cron이 환불) / 미결제는 즉시 취소. fat-finger는 `ForceCancelButton` confirm + 서버 `DepartureNotCancelableError` 멱등 가드 2중 방어. [ADR-0028]
  - "취소 배치 status는 누가 갱신하나?" → 저장값이 아니라 **자식 RefundJob 상태의 투영(fold)**. `recomputeBatchStatus`(FAILED 우선: 하나라도 FAILED→PARTIALLY_FAILED, 모두 SUCCEEDED→COMPLETED, 그 외 PROCESSING)를 cron drain 후 + 재시도 후 호출 → 자동 수렴. `/admin/departure-cancellations`에서 모니터링·재시도. [ADR-0028]
  - "왜 `transitionStatusTx`와 `transitionStatus` 둘 다 있나?" → Prisma 중첩 tx 불가. `transitionStatusTx(tx, …)`는 외부 tx(배치 fan-out) 합류용 코어, `transitionStatus`는 그걸 `db.$transaction`으로 감싼 단건 래퍼. 동작 동일, 호출 컨텍스트만 다름. [ADR-0028]
  - "취소 cascade에서 PG 환불은 어디서?" → admin 액션엔 0(외부 IO Tx 밖, ADR-0003). 기존 `process-refunds` cron이 `RefundJob`을 drain하며 Phase 2 PG 호출. 배치는 결과만 관찰(batchId로 묶임). 단일 사용자 환불(batchId=null)은 cron의 배치 recompute에서 skip.
  - "admin 으로 로그인했는데 일반 화면만 보인다?" → 공개 사이트(`(site)`)와 admin(`(admin)`)은 **완전히 분리된 셸**이다. 홈(`/`)은 권한 무관 공용. admin 진입은 (1) 헤더 우상단 **"관리자" 링크**(`UserNavIsland` — `session.user.role === "ADMIN"` 일 때만 노출, `/admin/products` 로 이동) 또는 (2) URL 직접. `/admin` 인덱스는 독립 화면 없이 `/admin/products` 로 redirect(`(admin)/admin/page.tsx`) — 과거 `page.tsx` 부재로 인증된 admin 이 `/admin` 직접 접근 시 404 나던 문제 해소. admin 셸 nav: 예약 관리 / 환불 모니터링 / 상품 관리 / 임베딩 Jobs. **새 admin 1차 화면을 바꾸려면 `UserNavIsland` 의 링크 href + `(admin)/admin/page.tsx` 의 redirect 대상 두 곳을 함께 갱신**.
  - "admin 계정으로 어떻게 로그인하나?" → 시드 계정 `admin@nextour.test`(role ADMIN). 가짜 도메인이라 실메일 수신 불가 → dev 매직링크는 **`npm run dev` 콘솔에 `📧 [DEV] Magic link for ...` 로 출력**(auth.ts `useDevConsoleFallback`, NODE_ENV≠production). 그 URL 을 브라우저에 붙여 로그인. role 은 JWT 토큰에 박히므로 권한 변경 시 **재로그인 필요**.
  - "리뷰를 숨겼는데 PDP 에서 안 사라진다?" → (Phase 4-C) `setReviewStatusAction` 이 `revalidatePath('/products/{productId}')` 로 PDP ISR(`revalidate=3600`)을 즉시 무효화한다. productId 는 `setReviewStatus` 뮤테이션이 반환(어느 PDP 캐시를 폐기할지 식별). PDP 의 리뷰/통계/분포 쿼리는 모두 `status:'PUBLISHED'` 필터라 재생성 시 HIDDEN 자동 제외. 숨김이 안 풀리면 productId 매핑 또는 revalidate 호출 누락 의심.
  - "리뷰 사진 URL 을 왜 두 벌(`getReviewPhotoPublicUrl` vs `reviewPhotoPublicUrl`)?" → (Phase 4-C) 전자는 `server-only`(Supabase SDK), 후자는 **client-safe 순수 빌더**(`shared/lib/supabase/photoMime.ts`). PDP 더보기 client island·라이트박스가 server SDK 없이 동일 URL 을 만들어야 해서 분리 — Supabase public URL 이 결정적 문자열(`{base}/storage/v1/object/public/{bucket}/{path}`)이라 SDK 불필요. server/client drift 0. 신규 렌더는 전부 client-safe 버전 사용.
  - "client island(`'use client'`)가 쓰는 `shared` 헬퍼에서 `@/shared/lib/env` 를 import 하면?" → **금지**. `env.ts` 는 모듈 로드 시점에 `envSchema.parse(process.env)` 로 `DATABASE_URL`/`AUTH_SECRET` 등 서버 전용 변수를 검증한다 → 이 헬퍼가 client 번들에 섞이면 브라우저에서 그 parse 가 실행돼 `ZodError`(서버 변수 undefined)로 페이지가 죽는다. `NEXT_PUBLIC_*` 만 필요하면 `process.env.NEXT_PUBLIC_X` 직접 접근(Next 가 빌드 타임에 client 번들로 인라인 — §5 `env.X` 규칙의 의도된 예외). 실제 사고: `photoMime.ts` 가 `env` 를 import 해 PDP(리뷰 달린 상품) 가 `ZodError` 로 안 열림 → `process.env.NEXT_PUBLIC_SUPABASE_URL` 직접 접근으로 수정(fix `d62161a`). 단위 테스트가 `env` 를 `vi.mock` 하면 이 누수를 가리므로 client-safe 모듈 테스트는 `vi.stubEnv` 로 실제 env 를 stub 할 것. 근본 차단(`env.ts` 에 `import "server-only"`)은 영향 범위가 넓어(다른 import 경로 동반 점검 필요) 보류.
  - "리뷰 status 전이 규칙을 바꾸려면?" → (Phase 4-C) `entities/review/model/transitions.ts` 의 `ALLOWED_REVIEW_TRANSITIONS` 한 곳만. `PUBLISHED↔HIDDEN`·`REPORTED→*` 허용, 동일/역방향(→REPORTED) 금지. admin 토글은 `PUBLISHED|HIDDEN` 만 노출(REPORTED 진입점은 다음 Phase — enum 값만 보존). booking 급 풀 state machine 은 의도적 미도입(상태 3개라 과설계).
  - "PDP 더보기는 어떻게 동작하나?" → (Phase 4-C) 첫 10건은 PDP(RSC)가 prerender 로 `ReviewFeed` 에 props 주입(SEO·초기 페인트). "더보기"만 client island 가 `loadMoreReviewsAction(productId, cursor)` Server Action 호출 → `nextCursor` 소비·누적. 커서는 `(createdAt desc, id desc)` 복합 정렬, `take=limit+1` 로 다음 페이지 존재 탐지. 라이트박스 state 는 카드 내부 `shared/ui` PhotoGrid 가 자기완결로 보유(ReviewFeed 무관).
  - "거래 종료 메일은 어디서 트리거되나?" → (Phase 5-A) `transitionStatusTx`의 트랜잭셔널 아웃박스. `emailJobForTransition(from,to)`가 PAID 전이=예약확정, PAID/READY→CANCELED=환불완료를 판단해 같은 Tx에 `EmailJob` 적재(유실 0). cron(`/api/cron/email-job`, `*/2`)이 EmbeddingJob 동형 워커로 픽업→hydrate→React Email 렌더→Resend 발송(멱등키=dedupeKey). NODE_ENV≠production은 콘솔 폴백(바운스 차단). 환불 코드(refund.ts/refundRetry.ts)는 미수정 — 둘 다 transitionStatus 경유라 자동 커버. [ADR-0030]
  - "이메일 transport 가 왜 둘이지?" → [ADR-0060]. **매직링크 로그인 메일 = Gmail SMTP**(`shared/email/smtp.ts`, nodemailer, 임의 수신자 도달 — Resend 샌드박스는 도메인 인증 전 본인 메일로만 발송) / **아웃박스(예약확정·환불완료) = Resend**(`shared/email/provider.ts`, 멱등 발송이 핵심이라 유지). 인증 흐름·토큰·URL 무변경, `sendVerificationRequest`의 transport 만 교체. 운영 env 는 `GMAIL_USER`/`GMAIL_APP_PASSWORD`(앱 비밀번호) + `RESEND_*` 둘 다 필요.
  - "EmailJob 에 payload 컬럼이 왜 없나?" → (Phase 5-A) [ADR-0030] 박제. `bookingId`만 저장하고 워커가 발송 시점에 hydration 로더(`getBookingConfirmationEmailData`/`getRefundCompletedEmailData`)로 최신 데이터 조립 → 주소·상품명·금액 stale 박제 회피. EmbeddingJob 무-payload 선례와 동일. 워커가 `@/entities/booking`·`@/entities/payment`를 직접 import 하는 것은 백그라운드 워커 레이어 예외(EmbeddingJob 워커→`@/entities/product` 선례, ADR-0026).
  - "메일 발송이 왜 enqueue 직후 안 나가고 cron 을 기다리나?" → (Phase 5-A) 외부 IO(Resend)는 booking 상태전이 Tx 바깥(ADR-0003). 동기 발송은 Resend 지연이 결제/환불 경로에 직결 + 롤백 시 메일-DB 불일치. enqueue(원자적, 유실 0) → cron 비동기 발송으로 분리. 멱등키(=dedupeKey)로 at-least-once 재시도가 effectively-once.
  - "부분 환불·위약금은 어디서 계산되나?" → (Phase 5-B) [ADR-0031]. 순수 함수 `computePenalty`(`entities/payment/model/penaltyPolicy.ts`)가 국외여행 표준약관 정률을 SSOT(`OVERSEAS_PENALTY_TIERS`)로 산출. **자가취소만** 위약금 적용(`refundBooking({ applyPenalty: true })`), admin 단건은 `!waivePenalty` 토글, 출발취소 cascade는 위약금 0(전액) 유지. D-day는 `ceil`(달력일 기준 — `floor`는 within-day drift). 위약금률 변경은 `OVERSEAS_PENALTY_TIERS` 한 곳만(RSC 미리보기·사가·메일 공유).
  - "위약금이 왜 cron 재시도에서 안 바뀌나?" → (Phase 5-B) `refundBooking`이 enqueue 시점에 `RefundJob.amount`(=환불액=base−penalty)와 `penaltyAmount`를 **동결 스냅샷**으로 저장. cron(`retryRefundJob`)은 이 값만 읽고 재계산 0 → PG 지연으로 며칠 뒤 재시도해도 금액 불변(`Booking.totalPrice` 스냅샷 [ADR-0027] 동형). `RefundJob.amount` 의미가 "결제 전액"→"실제 환불액"으로 재정의된 점 주의(위약금 0이면 동일).
  - "부분 취소면 `Payment.status` 가 뭐가 되나?" → (Phase 5-B) `penaltyAmount > 0` → `PARTIAL_CANCELED`, `=0` → 기존 `CANCELED`. 환불 메일(`getRefundCompletedEmailData`)은 금액을 `Payment.amount`(원결제액)가 아닌 **SUCCEEDED `RefundJob`**(실환불액+위약금)에서 읽어야 정확(부분환불 오보고 버그 수정됨). 좌석은 부분취소여도 100% 환원(booking이 cancel terminal로 가므로, 금액과 무관).
  - "대시보드 집계가 왜 `entities/analytics`라는 별도 슬라이스인가? booking/payment에 두지?" → (Phase 6) [ADR-0032]. 순매출/추이/취소율/점유율은 `Payment`+`RefundJob`+`Booking`+`Departure`를 가로지르는 리포팅 read-model이라 단일 도메인 슬라이스에 속하지 않는다. analytics는 다른 entity *모듈*을 import하지 않고 `shared`의 `db.$queryRaw`로 *테이블*만 직접 조회 → cross-slice import 아님(FSD 단방향 무손상). 위젯은 `@/entities/analytics` barrel만 의존(직접 DB 금지).
  - "대시보드 매출 추이에서 결제와 환불이 다른 막대에 떨어진다?" → (Phase 6) [ADR-0032] 의도된 시간축 비대칭. 매출=`Payment.paidAt`(결제 시점), 환불=`RefundJob.updatedAt`(cron 환불 처리 완료 시점) 기준. cron 백로그가 있으면 결제 W1·환불 W2로 분리될 수 있음(reporting 관행, 코드 주석 박제). `createdAt`으로 "고치지" 말 것.
  - "대시보드 집계 캐시가 왜 `range.key`를 키에 넣나?" → (Phase 6) `unstable_cache`는 `Date` 인자를 키로 직렬화 못 함. `range`별 결과가 stale 교차하지 않도록 `["dash-revenue", r.key]`처럼 enum 문자열을 명시 키 파트로 사용. 스냅샷 쿼리(점유율·상태분포)는 range 무관이라 정적 키. 무효화는 60s TTL 자연만료(실시간성 불요), 즉시 필요 시 `revalidateTag('analytics:dashboard')`.
  - "대시보드 Recharts 차트에 `db`를 import하면?" → (Phase 6) [ADR-0033] **금지**. 차트는 `window`/`ResizeObserver` 의존이라 `'use client'` 리프 2개(`RevenueTrendChart`/`BookingStatusDonut`)에만 격리하고, 서버가 집계한 plain 배열을 props로 주입. KPI 카드·조립(`AdminDashboard`)은 server. **단 기간 필터(`DateRangePicker`)·상품 셀렉트(`ProductSelect`)는 router/searchParams 네비게이션 때문에 `'use client'`** — 즉 `grep "use client" src/widgets/admin-dashboard/ui/`는 차트 2 + 필터 2 = **4개**가 정상(과거 노트의 "2개"는 차트 리프만 센 것 — 정정됨, 2026-06-10 admin A1 개편 시 확인). 회귀 가드의 핵심은 "*새* server 컴포넌트에 client가 추가되지 않았는가"(diff에서 `+use client` 0건). 기간 필터는 `useState` 아닌 `<Link href="?range=">`/router.push(searchParams SSOT).
  - "admin 1차 화면이 이제 상품 관리가 아니네?" → (Phase 6) 랜딩을 `/admin/dashboard`로 전환. `(admin)/admin/page.tsx` redirect + `UserNavIsland`의 "관리자" 링크 href + admin nav 첫 항목 세 곳을 함께 갱신함(§8 두 곳 동기화 규칙 + nav). 새 admin 홈을 또 바꾸려면 이 세 곳을 함께 수정.
- **다음 작업자의 혼란 방지 노트 (Phase 15)**:
  - "왜 신고하면 리뷰가 바로 숨겨지지 않나?" → spec D1. `ReviewReport` 행만 적재, `Review.status`는 불변. 검열 어뷰징 방지 설계. admin이 `/admin/reviews?status=REPORTED` 큐에서 확인 후 "숨기기(인정)" 버튼을 눌러야 HIDDEN 전이.
  - "`ReviewStatus.REPORTED` enum 값은 왜 있는데 안 쓰나?" → 미래를 위한 예약. 현재는 report-driven 큐(ReviewReport 테이블 OPEN 행 존재 여부로 식별). enum을 status-flip에 사용하면 검열 어뷰징 가능. 다음 Phase에서 활용 여지 있으나 신중 결정 필요 — 쓰려면 ADR 발행 먼저.
  - "신고됨 탭이 왜 status=REPORTED 필터가 아닌가?" → `listReviewsWithOpenReports`가 `reports: { some: { status: "OPEN" } }`로 ReviewReport 테이블을 기준으로 조회. Review.status와 무관하게 OPEN 신고가 있는 리뷰만 큐에 노출. `listReviewsForAdmin`의 status 필터는 전체/공개/숨김 탭에서만 사용.
  - "REPORT_REASON_LABELS를 admin 페이지에서 왜 `@/features/review-feed` 배럴로 가져오나?" → FSD 공개 API 컨벤션. `features/review-feed/model/reportSchema.ts`의 딥패스(`/model/reportSchema`) import는 금지. `app` 레이어는 feature 배럴을 통해서만 접근(§5 Architect 규칙). `features/review-feed/index.ts`가 `REPORT_REASON_LABELS`를 re-export함.
  - "`resolveReportsByHiding`이 왜 단일 Tx인가?" → 리뷰 HIDDEN 전환과 OPEN 신고 RESOLVED 처리를 분리하면 부분 적용 위험. HIDDEN만 되고 신고가 OPEN으로 남으면 큐에서 사라지지 않고 admin이 중복 처리. 단일 `$transaction`으로 원자성 보장.
  - "신고 처리 후 큐에서 즉시 사라지나?" → `resolveReportsAction`/`dismissReportsAction` 모두 `revalidatePath("/admin/reviews")`와 `revalidatePath("/admin/reviews/${reviewId}")`를 호출. `force-dynamic` 페이지라 캐시 무효화 즉시 반영. 새로고침 시 큐 갱신.
- **다음 작업자의 혼란 방지 노트 (Phase 16)**:
  - "테마 부스트가 왜 이진이 아니라 비율이지?" → [ADR-0045]. `buildThemeScore`가 `EXISTS → +0.1`(이진)에서 `0.1 × matchCount/requested`(요청 커버리지 비율)로 전환. 다태그 매칭 상품이 단일 매칭보다 상위. 천장 0.1 불변 → 가중치 밸런스(벡터 0.5/키워드 0.2/geo 0.2/테마 0.1) 무손상. `ProductTag @@unique([productId,tag])`가 matchCount ≤ requested 보장 → cap 불필요.
  - "공식이 왜 두 곳(순수함수 + SQL)에 있지?" → SSOT는 순수 함수 `themeBoost`, DB-단 `buildThemeScore` SQL이 동일 산술을 미러. SQL은 DB가 실행해 코드로 동기화 강제 불가 → 양쪽 JSDoc `⚠️` 경고 + 이원 테스트(불변식 6케이스 vs SQL 배선)로 방어. 한쪽 수정 시 반드시 양쪽 갱신.
  - "폴백은 왜 graduated가 아니지?" → (Phase 16) 의도적 YAGNI. 키워드 폴백(pgvector 부재)은 희귀 강등 경로라 binary theme-first 정렬 유지. `keywordFallback` 건드리지 말 것 — "폴백 경로는 graduated가 아닌..." 회귀 가드 테스트가 깨지면 의도적 정책 변경임을 강제.
- 시드 데이터는 `prisma/seed.ts`. 검증용 10개 상품(JP/VN/TH/EU/ID/PH) + 1개 보라카이 Draft + 1개 QA 테스트 상품 = 총 12건(시드 외 2건은 관리자 직접 생성).
- 자세한 진행 상황은 `docs/superpowers/plans/done/` 의 완료된 plan, 의사결정은 `docs/superpowers/adr/` 참조.

---

## 9. 참고 문서

- 페르소나: `docs/superpowers/skills/{architect,frontend-expert,backend-expert,qa-engineer,domain-booking}.md`
- 계획: `docs/superpowers/plans/`
- 설계: `docs/superpowers/specs/`
- **ADR**: `docs/superpowers/adr/` (인덱스: `README.md`, 양식: `template.md`)
- Prisma: `prisma/schema.prisma`, `prisma/seed.ts`
