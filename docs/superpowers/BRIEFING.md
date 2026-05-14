# Nextour M-PAYMENT 프로젝트 총정리 브리핑

> **대상**: 신규 시니어 멘토 AI (Gemini)  
> **목적**: 전체 시스템 아키텍처, 도메인 설계, 진척도 일목요연 파악  
> **작성일**: 2026-05-14

---

## 1. 프로젝트 도메인 및 기술 스택

### 서비스 정의
**Nextour** — AI 기반 맞춤형 패키지 여행 플랫폼
- 사용자: 여행객이 상품(패키지 투어)을 검색·예약·결제
- 핵심 거래 흐름: Product Browse → Booking Reserve → Payment Confirm → Departure (출발)
- 법적 성격: 결제·좌석·환불이 중앙화된 금전 플랫폼 (손실 = 회사 책임)

### 기술 스택 (Phase 1.5)
| 계층 | 기술 |
|------|------|
| **Frontend** | Next.js 15 App Router, React 19, RSC 우선 |
| **Backend** | Node.js, TypeScript strict, Server Actions |
| **Database** | PostgreSQL + Prisma 5 |
| **Payment** | Toss Payments v2 API (결제 PG) |
| **Validation** | Zod 3 |
| **Testing** | Vitest 2 + TDD |
| **Architecture** | FSD (Feature-Sliced Design) 단방향 의존성 |
| **UI** | Tailwind CSS |

---

## 2. FSD 아키텍처 현황

### 레이어 구조 (단방향)
```
app/
  ├─ page.tsx, layout.tsx, error.tsx (라우팅·페이지 선언만)
  ├─ api/**/*.ts (Server Actions, route handlers)
  └─ [비즈니스 로직 금지]

widgets/
  ├─ ProductCard/, BookingForm/ (entity UI 조합)
  └─ [직접 DB 호출 금지]

features/
  ├─ checkout/ (사용자 인터랙션: 결제 플로우)
  ├─ search/ (검색)
  └─ ['use client' 허용, 상태 관리]

entities/
  ├─ booking/ (도메인: 예약)
  │  ├─ api/ (비즈니스 로직: 좌석 차감, 상태 전이)
  │  ├─ model/ (타입·스키마)
  │  └─ ui/ (Booking 컴포넌트)
  ├─ payment/ (도메인: 결제) ← **M-PAYMENT 신설**
  │  ├─ api/ (3-Phase confirm, webhook, refund)
  │  ├─ model/ (Zod 스키마, 타입)
  │  └─ ui/ (Payment 컴포넌트, 향후)
  ├─ departure/, product/, user/ (기존)
  └─ index.ts (barrel: 명시적 named export만)

shared/
  ├─ lib/
  │  ├─ db.ts (Prisma client)
  │  ├─ env.ts (환경변수 추상화)
  │  ├─ toss/ (Toss HTTP client, signature, types)
  │  └─ [도메인 무지]
  ├─ ui/ (Button, Card 등)
  └─ index.ts (barrel)
```

### 의존성 규칙 (Non-negotiable)
```
app → widgets → features → entities → shared
 (역방향 import 절대 금지)
```

### 구체적 제약
- ❌ `app/**/page.tsx`에 `'use client'` 선언 금지
- ❌ `entities/**/ui/*.tsx`에 `'use client'` 추가 금지
- ❌ `entities/X`에서 `entities/Y` cross-slice import 금지
- ❌ `shared/`에서 `entities/` import 금지
- ✅ `entities/payment/index.ts`는 `export * from "./api/..."` 금지, 명시적 named export만
- ✅ `@/entities/payment` (barrel)로만 import, `@/entities/payment/api/...` (deep import) 금지

---

## 3. 핵심 백엔드 설계 사상 (도메인-북킹)

### 3.1 3-Phase Payment Flow (spec §3.3)

**문제**: 결제 승인 중 토스 PG는 성공했는데 DB 업데이트 실패 → 사용자 돈 빠져나감

**해결**: DB 트랜잭션 *밖*에서 PG 호출, 실패 시 보상 처리

```
Phase 1 (TX-1): DB 내부
  - Payment 조회/신규 생성 (PENDING)
  - Booking 소유권/상태 검증

Phase 2 (외부 IO): DB TX 밖
  - tossClient.confirm({ paymentKey, orderId, amount })
  - 네트워크 에러 → Payment.status = FAILED, PaymentEvent(FAILED) 기록

Phase 3a (PG 성공): TX-2 + TX-3
  - TX-2: Payment.status = PAID (tossPaymentKey, paidAt, receiptUrl)
          + PaymentEvent(result=PROCESSED)
  - TX-3: transitionStatus({ to: "PAID", actor: "system:payment:confirm" })
  - TX-2 또는 TX-3 실패 → compensateCancel(paymentKey, ...) 호출 (async)
    - cancel 성공: Payment.status = CANCELED, PaymentEvent(COMPENSATE_CANCEL)
    - cancel 실패: RefundJob(PENDING) 생성 + critical 로그 (별도 cron 처리)

Phase 3b (PG 실패):
  - Payment.status = FAILED + 에러 코드/메시지 + PaymentEvent(FAILED)
```

### 3.2 보상 트랜잭션 (Compensation Transaction)

**RefundJob** — 토스 cancel 실패 시 복구 큐

```ts
interface RefundJob {
  id: string;
  paymentId: string; bookingId: string;
  amount: Int; // 원 단위 정수
  reason?: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  attempts: Int; // exponential backoff: 30s, 5m, 30m, 2h, 6h
  nextRunAt: DateTime;
}
```

**Flow**: PG cancel 실패 → RefundJob(PENDING) enqueue → 별도 cron 워커가 주기적으로 `nextRunAt <= now` 항목 처리 → 성공하면 SUCCEEDED, 실패하면 다음 시도 시간 갱신

### 3.3 멱등성 보장 (Idempotency)

**문제**: 네트워크 재시도/웹훅 중복 → 중복 결제/환불

**해결**:

#### confirm 요청 (클라이언트 → 서버)
```ts
// 1. DB에서 tossOrderId로 기존 Payment 검색
const existing = db.payment.findUnique({ where: { tossOrderId } });
if (existing.status === "PAID") return { bookingId, status: "PAID" }; // 멱등
if (existing.status === "PENDING") { /* 진행 중 */ }
if (!existing) { /* 신규 생성 */ }

// 2. Toss HTTP 헤더
Idempotency-Key: confirm:${paymentKey}
// Toss API 자체가 같은 key로 재호출 시 캐시 반환 (멱등성)
```

#### webhook (Toss → 서버)
```ts
// PaymentEvent.providerEventId UNIQUE 제약
const idemKey = `webhook:${event.eventId}`;
const existing = db.paymentEvent.findUnique({ where: { providerEventId: idemKey } });
if (existing) return 200; // 이미 처리했음, no-op
db.paymentEvent.create({ providerEventId: idemKey, ... }); // 트랜잭션 내부
```

### 3.4 Zod를 이용한 I/O 경계 방어

**모든 외부 입력은 Zod로 파싱 → 실패면 400 응답**

```ts
// 1. POST /api/payments/confirm
const parsed = ConfirmPaymentRequestSchema.safeParse(body);
if (!parsed.success) return 400; // Zod 에러 메시지 포함

// 2. POST /api/payments/webhook/toss
const event = TossWebhookEventSchema.parse(JSON.parse(rawBody));
// 미지원 type도 수용 (type: string) → 핸들러에서 switch default: IGNORED

// 3. amount 정수 강제
amount: z.number().int().positive() // 소수·0·음수·NaN 거부
```

**Key Benefit**: 라우트 핸들러 진입 후 `if (amount % 1 !== 0)` 같은 방어 코드 불필요 → Zod가 이미 보장

### 3.5 에러 분류 (PaymentError)

**3가지 에러 타입 → 3가지 롤백 전략**

```ts
class PaymentError {
  constructor(code: PaymentErrorCode, context?: Record<string, unknown>) { ... }
  
  isPgError(): boolean  // PG_NETWORK_ERROR, PG_HTTP
  isDbError(): boolean  // DB_UPDATE_FAILED
  isBusinessError(): boolean  // 나머지 11개
}
```

**rollback 전략**:
- isPgError() → `compensateCancel` 시도 후 실패 시 `RefundJob` enqueue
- isDbError() → 즉시 `RefundJob` enqueue (cancel 안 함, 이미 DB 실패했으므로)
- isBusinessError() → 롤백 불필요, 400 응답

### 3.6 Booking 상태머신 (assertTransition)

**문제**: 잘못된 상태 전이 (예: CANCELED → CONFIRMED) 방지

**해결**:

```ts
// entities/booking/api/stateMachine.ts
type BookingStatus = "RECEIVED" | "DEPARTURE_CONFIRMED" | "PAID" 
                   | "CANCELED_BY_USER" | "CANCELED_BY_AGENCY" | ...

const validTransitions: Record<BookingStatus, BookingStatus[]> = {
  RECEIVED: ["DEPARTURE_CONFIRMED", "CANCELED_BY_USER"],
  DEPARTURE_CONFIRMED: ["PAID", "CANCELED_BY_USER"],
  PAID: ["CANCELED_BY_USER"],
  // ...
};

function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!validTransitions[from].includes(to)) {
    throw new InvalidTransitionError(`${from} → ${to}`);
  }
}

// 사용처
await assertTransition(booking.status, "PAID");
await db.booking.update({ where: { id }, data: { status: "PAID" } });
```

---

## 4. `skills` 폴더 내 5개 마크다운 지침서 분석

### 구조
```
docs/superpowers/skills/
  ├─ architect.md          (🏛️ 레이어·의존성·barrel)
  ├─ frontend-expert.md    (🎨 React 19, RSC, 메모리 누수)
  ├─ backend-expert.md     (⚙️ Prisma, NextAuth, Server Actions)
  ├─ qa-engineer.md        (🔬 자동 증거 수집, curl·jq·DB)
  └─ domain-booking.md     (💳 결제·예약·좌석·멱등성·환불)
```

### 각 페르소나의 핵심 임무

#### 🏛️ Architect
- **발동 트리거**: `entities/`, `widgets/`, `features/`, `shared/`, `index.ts`(barrel), "레이어", "의존성", "공개 API"
- **core rules (R1~R5)**:
  - R1: barrel (`index.ts`)은 명시적 named export만, `export *` 금지
  - R2: deep import 금지 (`@/entities/payment/api/...` ❌ → `@/entities/payment` ✅)
  - R3: 도메인 모델(type, schema)과 API(로직)를 분리
  - R4: shared에서 entities로 가는 역방향 의존성 금지
  - R5: 슬라이스 내 `model/` `api/` `ui/` 3계층 구조 강제
- **최악의 위반**: 레이어 위반 → 이후 리팩토링 범위 광범위 + 팀 혼란 극증

#### 🎨 Frontend Expert
- **발동 트리거**: `'use client'`, `useEffect`, `useState`, `useRef`, `Suspense`, "폴링", "메모리 누수", "cleanup", "타이머", "이벤트 리스너"
- **core rules (R1~R8)**:
  - R1: page.tsx, layout.tsx는 RSC (no 'use client')
  - R2: useEffect 내 setInterval/setTimeout/addEventListener 반드시 cleanup
  - R3: 폴링 컴포넌트에서 router.replace 전에 clearInterval
  - R4: fetch(캐시 설정) 누수 방지
  - R5: ref 의존성 감시 + proper cleanup
  - R6: Suspense 경계 명시 (streaming 최적화)
  - R7: searchParams/params 직렬화 안전 확인
  - R8: hydration mismatch 검증
- **최악의 위반**: setTimeout 누락 → 메모리 누수 + 페이지 성능 급락

#### ⚙️ Backend Expert
- **발동 트리거**: `app/api/**`, "Server Action", `db.`, `prisma`, `auth()`, `$transaction`, `$queryRaw`, "캐시", "force-dynamic", "zod", "env"
- **core rules (R1~R7)**:
  - R1: Prisma N+1 쿼리 차단 (include/select 사용)
  - R2: 외부 API는 트랜잭션 밖에 (PG, 3rd-party)
  - R3-1: route handler·Server Action 입력은 Zod로 검증
  - R3-2: rawBody 보존 후 JSON.parse (webhook 서명용)
  - R3-3: auth() 미인증 → 401
  - R4: Prisma.sql 태그드 템플릿 (SQL injection 차단)
  - R5: process.env.X 직접 접근 금지 → env.X 경유
  - R6: middleware(Edge runtime)에서 Prisma 금지
  - R7: force-dynamic 선언 (캐시 제어)
- **최악의 위반**: findUnique → 검사 → update (TOCTOU race) → 오버부킹

#### 🔬 QA Engineer
- **발동 트리거**: "검증", "테스트", "확인", "완료", "증거", `curl`, `jq`, PR/리뷰 결과 보고 시점
- **core rules (R1~R8)**:
  - R1: 모든 코드 변경 후 `npm run typecheck` / `npm run test` / `npm run lint`
  - R2: HTTP 동작 검증은 curl + jq (dev 서버 실행 필수)
  - R3: 자동화 가능한 검증을 사용자에게 떠넘기지 말 것
  - R4: "이론적으로 동작할 것" ❌ → 실제 출력 인용 ✅
  - R5: 자동화된 test 환경 구축 (mock server, fixtures)
  - R6: 시나리오별 before/after 스냅샷
  - R7: 완료 보고 시 증거(출력) 없으면 보고 불인정
  - R8: **Plan 파일 체크박스 File-written 검증** (가장 중요)
    - 각 Task 완료 직후 `grep -n "\- \[ \]"` 로 미완료 항목 0건 확인
    - `git diff docs/superpowers/plans/` 로 파일에 실제로 반영됐는지 확인
- **최악의 위반**: "구현했습니다" 만 말하고 증거 불제출 → 다음 작업자 혼란 + 재검증 필요

#### 💳 Domain Booking
- **발동 트리거**: `booking`, `payment`, `checkout`, `departure.bookedSeats`, `webhook`, `refund`, `$transaction`, `idempotent`, `providerEventId`, "좌석", "hold", "TTL", "금액", "totalPrice"
- **core rules (R1~R10)**:
  - R1: 좌석 차감은 updateMany + 조건부 (CAS 패턴, TOCTOU 방지)
  - R2: Hold + TTL (결제 중단 시 자동 환원)
  - R3: 외부 IO는 DB 트랜잭션 밖 (2-Phase, 3-Phase)
  - R4: 멱등성 키(providerEventId) UNIQUE 제약 (webhook 중복 방지)
  - R5: booking status 직접 할당 금지 → assertTransition 통과 후 update
  - R6: 금액은 정수 원 단위만 (Decimal 또는 Int, float ❌)
  - R7: 보상 트랜잭션 (compensateCancel + RefundJob 큐)
  - R8: PaymentEvent append-only (감사, 타임라인)
  - R9: PG 서명 검증 필수 (webhook 신뢰)
  - R10: TDD (테스트 먼저, spec에 맞춰 구현)
- **최악의 위반**: 좌석 오버부킹 / 이중 결제 / 환불 손실 → 회사 신용도 파괴

---

## 5. 전체 마일스톤 및 진척도

### 현황: Task 1~8 완료 (44% 진행)

| Task | 제목 | 상태 | 핵심 성과 |
|------|------|------|---------|
| 1 | Prisma 마이그레이션 | ✅ | PaymentEvent, RefundJob, partial unique index |
| 2 | env.ts (Toss vars) | ✅ | production 게이트 (키 누락 시 부팅 거부) |
| 3 | Toss DTO 타입 | ✅ | TossConfirmResponse, TossCancelResponse, TossWebhookPayload |
| 4 | HMAC 서명 검증 | ✅ | verifyTossSignature (TDD, 5+ 케이스) |
| 5 | Toss HTTP client | ✅ | confirm/cancel (timeout 8s, Idempotency-Key) |
| 6 | Mock Toss server | ✅ | 4개 시나리오 (success, amount-tamper, network-error, fail) |
| 7 | Zod 스키마 (Payment) | ✅ | ConfirmPaymentRequestSchema, TossWebhookEventSchema, RefundRequestSchema (20 케이스) |
| 8 | PaymentError 클래스 | ✅ | isPgError/isDbError/isBusinessError (13 케이스) |

### 앞으로: Task 9~18 (56% 남음)

| Task | 제목 | 목적 | 예상 복잡도 |
|------|------|------|----------|
| 9 | orderId 인코딩 (TDD) | tossOrderId = bookingId + __ + seq | 🟢 낮음 |
| 10 | 금액 cross-check (TDD) | 요청 금액 = PG 응답 금액 (3중 검증) | 🟢 낮음 |
| 11 | confirmPayment (3-Phase) | 결제 승인 핵심 로직 + compensateCancel | 🟠 높음 |
| 12 | webhook 핸들러 (멱등성) | Toss 이벤트 처리 + PaymentEvent 기록 | 🟠 높음 |
| 13 | refund + RefundJob | 환불 + 보상 큐 | 🟠 높음 |
| 14 | entities/payment/index.ts (barrel) | 공개 API 제한 (15 named exports) | 🟢 낮음 |
| 15 | POST /api/payments/confirm | 라우트 핸들러 (auth, zod, error mapping) | 🟡 중간 |
| 16 | POST /api/payments/webhook/toss | 웹훅 라우트 (서명, rawBody) | 🟡 중간 |
| 17 | payment-evidence.ts | 11개 시나리오 자동화 script | 🟠 높음 |
| 18 | 전체 QA 종합 | typecheck/test/lint + grep 자가 검열 | 🟠 높음 |

### 흐름도
```
Tasks 1-5 (기반)  ← Toss API 통신 인프라
       ↓
Task 6 (mock 서버)  ← 자동 검증 환경 구축
       ↓
Tasks 7-8 (검증)  ← I/O 경계 방어 + 에러 분류
       ↓
Tasks 9-10 (유틸)  ← orderId 인코딩, 금액 검증
       ↓
Tasks 11-13 (핵심)  ← 3-Phase, 멱등성, 보상 (결제 도메인의 핵심)
       ↓
Tasks 14-16 (공개 API)  ← 라우트·barrel 완성
       ↓
Tasks 17-18 (검증)  ← end-to-end 증거 수집 + 최종 QA
```

---

## 6. 에이전트 통제 절대 규칙 (CLAUDE.md)

### 6.1 보고 양식 (신규 규정 §7.1)

**모든 Task 완료 보고 필수 포맷** (아래 3가지만 사용, 장황한 설명 금지)

```markdown
## 📋 Task N 완료 보고

### 🏗️ Core Architecture
[시스템 뼈대 해당하는 핵심 설계 의도 3줄 이내]

### ♻️ Boilerplate
[단순 UI/CRUD/타입 선언을 한 줄로 요약 및 스킵]

### 🧠 Concept Insight
[이번 Task의 핵심 백엔드/아키텍처 개념을 비유 들어 1문단]

---

**검증 증거**
- [실행된 명령의 출력 인용]
```

### 6.2 Plan Execution (§4.1) — 체크박스 갱신 절대 규칙

**Rule: Task 완료 즉시, 해당 Task의 모든 `[ ]` → `[x]`로 파일에 직접 Write**

- ✅ 각 Task 단위로 그 자리에서 즉시 처리
- ✅ QA 증거 수집과 동시에 체크박스 갱신
- ✅ commit 전 `git diff docs/superpowers/plans/` 확인
- ❌ "나중에 모아서 한꺼번에" 절대 금지
- ❌ R8 gate 미통과 시 즉시 중단

**검증**:
```bash
grep -nA <line_count> "^### Task N" docs/superpowers/plans/2026-05-14-payment.md \
  | grep "\- \[ \]" && echo "❌ FAIL" || echo "✅ PASS"
```

### 6.3 Plan Authoring (§4.2) — Pre-checking 금지

**Rule: 신규 plan 파일의 모든 체크박스는 `[ ]` 상태로 초기화. 단 하나의 예외도 없음.**

- ✅ `- [ ]` 초기 상태
- ✅ 구현 + QA 완료 후 `[ ]` → `[x]` 변경
- ✅ 문서 본문의 예시로 `` `- [x]` ``를 백틱으로 감싼 경우는 실제 체크박스 아님 (OK)
- ❌ `- [x]` 사전 기입 (pre-checking) = plan 신뢰도 무너짐
- ❌ 후속 작업자가 완료 여부 판별 불가

**실제 사고**: 2026-05-14 payment plan에서 Task 2~18 일괄 `[x]` 사전 기입 → 복구 필요

### 6.4 TDD 엄수 (qa-engineer.md R10)

**모든 비즈니스 로직은 테스트 먼저**

```
1. Test 작성 (FAIL 확인)
   ↓
2. 구현
   ↓
3. Test PASS 확인
   ↓
4. QA 증거 (npm run typecheck/test/lint)
   ↓
5. 체크박스 갱신 + commit
```

### 6.5 기타 Non-negotiable 규칙

#### Architect (❌ 절대 위반)
- deep import: `@/entities/payment/api/...`
- cross-slice: `widgets/A` → `widgets/B`
- 'use client' in entities/**/ui/*.tsx

#### Frontend Expert (❌ 절대 위반)
- 'use client' in page.tsx, layout.tsx
- useEffect 내 cleanup 누락
- 폴링 후 router.replace 전 clearInterval 누락

#### Backend Expert (❌ 절대 위반)
- 클라이언트 컴포넌트에서 db import
- `any`, `as any`, `@ts-ignore`, `@ts-expect-error` 사용
- zod 검증 누락 (Server Action, route handler)
- process.env.X 직접 접근 (env.X만 허용)

#### Domain Booking (❌ 절대 위반)
- findUnique → 검사 → update (TOCTOU race)
- 금액을 number(float)로 표현 (Int 또는 Decimal만)
- 웹훅에서 멱등성 키 검사 없이 처리
- booking status 직접 할당 (assertTransition 통과 필수)
- 단일 TX에 외부 PG 호출 포함

#### QA Engineer (❌ 절대 위반)
- typecheck/test 실패 채로 "완료" 보고
- 자동화 가능한 검증을 사용자에게 떠넘김
- 실행된 명령의 출력 없이 "동작할 것" 주장

### 6.6 Communication Norms

- **사용자 응답**: 한국어
- **코드/주석**: 한국어 주석 OK, 식별자는 영문
- **커밋 메시지**: 영문 Conventional Commits (`feat(scope):`, `fix(scope):`)
- **plan/spec 문서**: 한국어 본문 + 영문 식별자

---

## 7. 신규 시니어 AI를 위한 Hand-off Checklist

### 즉시 참고해야 할 파일

```
docs/superpowers/
  ├─ BRIEFING.md (본 문서)
  ├─ skills/
  │  ├─ architect.md (R1~R5)
  │  ├─ frontend-expert.md (R1~R8)
  │  ├─ backend-expert.md (R1~R7)
  │  ├─ qa-engineer.md (R1~R8)
  │  └─ domain-booking.md (R1~R10)
  ├─ plans/
  │  └─ 2026-05-14-payment.md (Task 1~18, 현재 Task 1~8 완료)
  └─ specs/
     └─ 2026-05-14-payment-design.md (상세 설계서)

CLAUDE.md (§1~§7: 기술 스택, FSD, 페르소나, 워크플로우, 절대 규칙, 권장 패턴, 커뮤니케이션)

src/
  ├─ entities/payment/ (신규, Task 7~13 작업 중)
  └─ shared/lib/toss/ (신규, Task 3~5 완료)

prisma/
  └─ schema.prisma (PaymentEvent, RefundJob, partial unique index 추가됨)
```

### 다음 Task (9) 착수 전 확인사항

- [ ] 이 BRIEFING.md 정독 완료
- [ ] CLAUDE.md §3 (5인 페르소나 오케스트레이션) 이해
- [ ] Task 1~8의 커밋 메시지 + 코드 스캔 (패턴 학습)
- [ ] 2026-05-14-payment.md Task 9~18 절차 숙지
- [ ] domain-booking.md R6 (정수 금액) + R7 (보상 트랜잭션) 핵심 이해

### 핵심 심볼/용어 정리

| 용어 | 의미 |
|------|------|
| **3-Phase** | DB(TX) → PG(외부) → DB(TX) 순서로 실행, 중간 실패 시 보상 |
| **compensateCancel** | PG cancel 호출하여 부분 실패 복구 |
| **RefundJob** | PG cancel 실패 시 대기열 저장 후 cron 재시도 |
| **Idempotency-Key** | HTTP 헤더로 중복 요청 방지 (Toss API 지원) |
| **providerEventId** | Toss eventId, webhook 중복 방지를 위한 UNIQUE 키 |
| **TOCTOU** | Time-of-check-to-time-of-use (race condition의 한 형태) |
| **CAS (Compare-and-Set)** | 조건부 원자적 업데이트 (updateMany with where) |
| **TTL (Time-to-Live)** | holdExpiresAt, 결제 중단 시 자동 환원 |
| **Barrel** | index.ts로 공개 API 제한 (deep import 금지) |
| **FSD** | Feature-Sliced Design, 단방향 의존성 보장 |

---

**최종 메모**

이 프로젝트는 **"결제 안전성이 곧 기능성"**이라는 설계 철학을 따른다.
- 3-Phase는 partial failure 대응
- RefundJob은 PG 장애 대응
- Zod는 입력 신뢰도 확보
- PaymentError 분류는 롤백 전략 결정

다음 Task들은 이 4가지 기둥 위에서 구현된다.
모든 코드 변경 직후 R1(typecheck/test) + R8(plan 파일 반영)은 생략 불가능한 의례(ritual)다.

