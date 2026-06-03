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
- **Phase 1 + Phase 2 + Phase 3 B1 + B2 + B3 + Phase 4-A + 4-B + 4-C + Phase 5-A + 5-B 완료** — Toss 웹훅 v2 envelope-first + cross-check([ADR-0013]/[ADR-0016]), 환불 Saga 3-phase([ADR-0003]), Cron 멱등 워커([ADR-0005]), 위시리스트 island + PDP ISR 시리즈([ADR-0012]/[ADR-0015]/[ADR-0017]/[ADR-0018]/[ADR-0019]), 데이터 레이어 unstable_cache 확장 + 무효화 컨트랙트 SSOT([ADR-0020]), Sentry SDK + CSP/HSTS([ADR-0021]), Rate Limit 4-tier hybrid 통합([ADR-0022]/[ADR-0023]), Admin CMS + 비동기 임베딩 파이프라인([ADR-0026]), Departure CMS + 좌석/가격 안전([ADR-0027]), 출발 취소 Cascade — 부모 배치 오케스트레이션 + 부분 실패 복구([ADR-0028]), 리뷰 시스템 완성 — 어드민 모더레이션(PUBLISHED↔HIDDEN) + PDP 더보기 island + 별점 분포·라이트박스([ADR-0029]), 거래 종료 알림 메일 파이프라인 — 트랜잭셔널 아웃박스 + Resend 멱등 발송 + React Email 템플릿([ADR-0030]), **부분 환불·시간경과 위약금 정책 — 표준약관 정률 + 동결 스냅샷 + PARTIAL_CANCELED([ADR-0031])** 박제 완료.
- **현재는 Phase 5-B(부분 환불·위약금) 완료 / 다음 마일스톤 미정** — `transitionStatusTx` 트랜잭셔널 아웃박스(`emailJobForTransition` 순수 정책 → `enqueueEmailJob` find-then-create 멱등 적재), `EmailJob` 큐(EmbeddingJob/RefundJob 동형 CAS-claim + 백오프 + stale reaper), React Email 템플릿 2종(예약확정+영수증/환불완료), `sendEmail` provider(NODE_ENV≠production 콘솔 폴백 + Resend `idempotencyKey=dedupeKey` effectively-once), hydration 로더 2종(소유 entity 단일쿼리 N+1 차단), cron(`/api/cron/email-job` `*/2`). 다음 후보: 사용자 신고(`REPORTED`) 진입점, themeTags soft boost, 금액분할/다회 부분환불, 상품별 위약금 정책 CMS, 또는 추가 알림 채널(SMS/카카오 알림톡).
- **다음 작업자의 혼란 방지 노트**:
  - "왜 어떤 페이지는 force-dynamic, 어떤 페이지는 ISR 이지?" → 도메인별 캐시 정책 분리. 결제·예약·웹훅·admin·cron 등 안정성 민감 도메인은 일부러 dynamic 유지(NO-REAL-MONEY + PPR 보류 정책, [ADR-0009] / [ADR-0020]).
  - "PPR opt-in 하면 더 깔끔하지 않나?" → 결정 시점에 experimental 이라 보류. [ADR-0012]/[ADR-0015]/[ADR-0017]/[ADR-0018]/[ADR-0020] 모두 같은 이유로 거부. PPR stable 승격 시 시리즈 일괄 재논의.
  - "wishlist hook 이 왜 `useOptimistic` 안 쓰지?" → [ADR-0019] 박제. Next dynamic 페이지의 `revalidatePath` no-op + transition 종료 시 base prop revert 의 조합으로 깜빡임 발생. manual `useState` + CustomEvent bus 가 채택.
  - "`getProductsByIds` 가 왜 per-id fan-out 태그를 쓰지?" → [ADR-0020] 박제. `tagProductDetail` 단일 namespace 를 PDP(`getProductById`) + 비교(`getProductsByIds`) 양쪽이 공유 → admin product 한 번의 `revalidateTag(tagProductDetail("X"))` 호출이 PDP + X 가 포함된 모든 비교 캐시 엔트리를 동시에 무효화. N-회 fan-out 호출 패턴(옵션 B)은 round-trip 증가로 거부.
  - "Rate Limit은 왜 middleware + wrapper 두 곳에 있지?" → 의도된 hybrid. middleware의 `global` tier는 *콜드스타트 비용 방어선* — pathname 무관 baseline. 각 route handler의 `withRateLimit` / Server Action의 `withRateLimitAction`은 *도메인별 정밀 한도*(auth=5/min IP, payment=10/min user, ai-search=20/min). middleware 단일 통합은 tier 식별이 pathname에 묶여 회귀 위험이 커 거부([ADR-0022]). Upstash 미설정 시 fail-open 강등([ADR-0023]) — cache graceful 패턴과 동일.
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
  - "EmailJob 에 payload 컬럼이 왜 없나?" → (Phase 5-A) [ADR-0030] 박제. `bookingId`만 저장하고 워커가 발송 시점에 hydration 로더(`getBookingConfirmationEmailData`/`getRefundCompletedEmailData`)로 최신 데이터 조립 → 주소·상품명·금액 stale 박제 회피. EmbeddingJob 무-payload 선례와 동일. 워커가 `@/entities/booking`·`@/entities/payment`를 직접 import 하는 것은 백그라운드 워커 레이어 예외(EmbeddingJob 워커→`@/entities/product` 선례, ADR-0026).
  - "메일 발송이 왜 enqueue 직후 안 나가고 cron 을 기다리나?" → (Phase 5-A) 외부 IO(Resend)는 booking 상태전이 Tx 바깥(ADR-0003). 동기 발송은 Resend 지연이 결제/환불 경로에 직결 + 롤백 시 메일-DB 불일치. enqueue(원자적, 유실 0) → cron 비동기 발송으로 분리. 멱등키(=dedupeKey)로 at-least-once 재시도가 effectively-once.
  - "부분 환불·위약금은 어디서 계산되나?" → (Phase 5-B) [ADR-0031]. 순수 함수 `computePenalty`(`entities/payment/model/penaltyPolicy.ts`)가 국외여행 표준약관 정률을 SSOT(`OVERSEAS_PENALTY_TIERS`)로 산출. **자가취소만** 위약금 적용(`refundBooking({ applyPenalty: true })`), admin 단건은 `!waivePenalty` 토글, 출발취소 cascade는 위약금 0(전액) 유지. D-day는 `ceil`(달력일 기준 — `floor`는 within-day drift). 위약금률 변경은 `OVERSEAS_PENALTY_TIERS` 한 곳만(RSC 미리보기·사가·메일 공유).
  - "위약금이 왜 cron 재시도에서 안 바뀌나?" → (Phase 5-B) `refundBooking`이 enqueue 시점에 `RefundJob.amount`(=환불액=base−penalty)와 `penaltyAmount`를 **동결 스냅샷**으로 저장. cron(`retryRefundJob`)은 이 값만 읽고 재계산 0 → PG 지연으로 며칠 뒤 재시도해도 금액 불변(`Booking.totalPrice` 스냅샷 [ADR-0027] 동형). `RefundJob.amount` 의미가 "결제 전액"→"실제 환불액"으로 재정의된 점 주의(위약금 0이면 동일).
  - "부분 취소면 `Payment.status` 가 뭐가 되나?" → (Phase 5-B) `penaltyAmount > 0` → `PARTIAL_CANCELED`, `=0` → 기존 `CANCELED`. 환불 메일(`getRefundCompletedEmailData`)은 금액을 `Payment.amount`(원결제액)가 아닌 **SUCCEEDED `RefundJob`**(실환불액+위약금)에서 읽어야 정확(부분환불 오보고 버그 수정됨). 좌석은 부분취소여도 100% 환원(booking이 cancel terminal로 가므로, 금액과 무관).
- 시드 데이터는 `prisma/seed.ts`. 검증용 10개 상품(JP/VN/TH/EU/ID/PH) + 1개 보라카이 Draft + 1개 QA 테스트 상품 = 총 12건(시드 외 2건은 관리자 직접 생성).
- 자세한 진행 상황은 `docs/superpowers/plans/done/` 의 완료된 plan, 의사결정은 `docs/superpowers/adr/` 참조.

---

## 9. 참고 문서

- 페르소나: `docs/superpowers/skills/{architect,frontend-expert,backend-expert,qa-engineer,domain-booking}.md`
- 계획: `docs/superpowers/plans/`
- 설계: `docs/superpowers/specs/`
- **ADR**: `docs/superpowers/adr/` (인덱스: `README.md`, 양식: `template.md`)
- Prisma: `prisma/schema.prisma`, `prisma/seed.ts`
