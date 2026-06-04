# Phase 5-A — 도메인 알림 메일 파이프라인 (Email Notification Pipeline)

> 거래 종료 시점(결제 완료·환불 완료)에 고객 메일함으로 알림을 배달하는 비동기 파이프라인.
> 사용자 확정 설계: **트랜잭셔널 아웃박스 + EmailJob 비동기 큐 + Resend/React Email + Dev 콘솔 폴백**.

## Context

기존 시스템 분석 결과(착수 전 조사):

- **이메일 인프라는 단 1곳뿐** — NextAuth Resend provider(`src/features/auth/server/auth.ts`)의 매직링크 발송. `RESEND_API_KEY`/`RESEND_FROM_EMAIL` env 자리는 이미 존재(둘 다 optional). `resend@^4.0.0` 패키지도 이미 설치됨.
- **Dev 콘솔 폴백의 검증된 선례** — auth.ts의 `useDevConsoleFallback = env.NODE_ENV !== "production"`. 로컬에서 테스트 키가 설정돼 있어도 외부 발송이 일어나지 않게 콘솔로 폴백. Phase 5-A의 "@nextour.test 더미 계정 바운스 방지" 안전장치는 이 패턴을 그대로 계승한다.
- **비동기 큐 패턴이 2회 박제됨** — `EmbeddingJob`([ADR-0026]) + `RefundJob`([ADR-0003]/[ADR-0028])이 동일 골격:
  - 컬럼: `status / attempts / lastError / nextRunAt(지수 백오프) / actor`, `@@index([status, nextRunAt])`
  - 워커: CAS claim(`updateMany` status guard로 TOCTOU 차단) → 외부 IO는 DB Tx **밖**([ADR-0003]) → per-job try/catch 격리 → stale `IN_PROGRESS` reaper(10분) → `MAX_ATTEMPTS=5` 후 영구 FAILED
  - cron: `CRON_SECRET` Bearer 가드, `force-dynamic` + `runtime=nodejs`, `vercel.json` `*/2 * * * *`
  - **EmailJob은 이 패턴의 3번째 복제다.** 새 인프라가 아니라 검증된 골격의 재사용.
- **트랜잭션 종료지점이 모두 `transitionStatus`로 수렴** — 결제 완료(`confirm.ts`)·단건 환불(`refund.ts`)·환불 재시도(`refundRetry.ts`)·출발취소 cascade 모두 마지막에 `entities/booking`의 `transitionStatus(Tx)`를 호출해 booking 상태를 전이하고 `BookingEvent`를 append한다. → **outbox 훅을 `transitionStatusTx` 한 곳에만 꽂으면 모든 거래 종료 이벤트를 단일 지점에서 포착**한다.
- `User.email`은 `@unique` 필수 필드 → 수신자 주소 확보 가능.
- React Email(`@react-email/components`, `react-email`)은 **미설치** — Task 1에서 추가.

## 핵심 설계 결정

### D1. 트랜잭셔널 아웃박스 — `transitionStatusTx` 단일 훅

메일 발송 작업을 **상태 전이 트랜잭션과 같은 DB Tx 안에서** EmailJob 행으로 적재한다. 발송 자체(외부 IO)는 큐가 비동기로 처리한다.

```
transitionStatusTx(tx, { from, to, ... }):
  ... 기존: assertTransition → booking.update → BookingEvent.create (append-only) ...
  const descriptor = emailJobForTransition(from, to)   // 순수 정책 함수
  if (descriptor) await enqueueEmailJob(tx, { ...descriptor, bookingId })
```

**왜 outbox인가:** 발송을 별도 호출(예: `confirm.ts`에서 transition 후 `await sendEmail()`)로 두면, 전이는 커밋됐는데 프로세스가 죽어 메일이 영영 안 나가는 유실 창이 생긴다. EmailJob 행을 전이와 **원자적으로** 같이 커밋하면, 전이가 성공한 모든 거래는 반드시 큐에 메일 작업이 남는다(유실 0). 발송 실패는 큐의 백오프 재시도가 흡수.

**왜 단일 훅으로 두 메일이 다 커버되는가:** 환불은 `refund.ts`/`refundRetry.ts` 두 경로가 있지만 **둘 다 `transitionStatus`로 booking을 `CANCELED_*`로 전이**한다. 따라서 정책 함수가 전이 쌍을 보고 분기하면 환불 코드는 **한 줄도 건드리지 않고** 메일이 적재된다.

### D2. 전이 → 메일 정책 (`emailJobForTransition`, 순수 함수)

`entities/booking/model/`에 위치(booking 상태를 아는 레이어). 순수 함수 → TDD 대상.

| from | to | 메일 | dedupeKey |
|---|---|---|---|
| (any) | `PAID` | `BOOKING_CONFIRMATION` (예약확정 + 영수증 통합) | `booking-confirmation:{bookingId}` |
| `PAID` 또는 `READY` | `CANCELED_BY_USER` / `CANCELED_BY_AGENCY` | `REFUND_COMPLETED` | `refund-completed:{bookingId}` |
| 그 외 모든 전이 | — | `null` (메일 없음) | — |

**환불 메일 가드의 핵심:** `from ∈ {PAID, READY}`일 때만 환불 메일을 보낸다. `RECEIVED`/`AWAITING_GROUP`/`DEPARTURE_CONFIRMED`(결제 전 단계) → `CANCELED`는 **돈이 오간 적 없으므로** 환불 안내를 보내면 안 된다. 이 가드는 `refund.ts`의 `REFUNDABLE_STATUSES = ["PAID","READY"]`와 정확히 일치한다.

### D3. EmailJob 스키마 (RefundJob/EmbeddingJob 동형)

```prisma
enum EmailType {
  BOOKING_CONFIRMATION   // 예약 확정서 + 결제 영수증 (PAID 전이)
  REFUND_COMPLETED       // 환불 처리 완료 안내 (PAID/READY → CANCELED)
}

enum EmailJobStatus { PENDING IN_PROGRESS SUCCEEDED FAILED }

model EmailJob {
  id         String         @id @default(cuid())
  type       EmailType
  // 멱등 enqueue 키. outbox는 전이당 1회지만, 재시도 경로의 중복 전이 시도에
  // 대비해 unique 제약으로 구조적 1회성 보장. ex) "booking-confirmation:<bookingId>"
  dedupeKey  String         @unique
  bookingId  String         // 워커가 발송 시점에 전체 데이터를 hydrate하는 참조 키
  status     EmailJobStatus @default(PENDING)
  attempts   Int            @default(0)
  lastError  String?        @db.Text
  nextRunAt  DateTime       @default(now()) // 지수 백오프
  sentTo     String?        // 발송 시점 수신 주소 스냅샷 (감사 추적)
  providerId String?        // Resend 메시지 id (감사 + 멱등 추적)
  createdAt  DateTime       @default(now())
  updatedAt  DateTime       @updatedAt

  booking Booking @relation(fields: [bookingId], references: [id], onDelete: Cascade)

  @@index([status, nextRunAt]) // cron picker
}
```

**payload(JSON) 컬럼이 없는 이유:** 두 메일 모두 `bookingId` 하나로 모든 데이터(예약·사용자·출발일·상품·결제·영수증URL)를 워커가 발송 시점에 fresh hydrate할 수 있다. EmbeddingJob이 `productId`만 들고 워커가 product를 fetch하는 것과 동일. payload를 박제하면 stale 위험만 늘어난다.

### D4. 멱등성 — 3계층

1. **Enqueue 멱등**: `dedupeKey @unique`. `enqueueEmailJob`은 충돌 시(P2002) no-op. outbox는 원래 전이당 1회지만 다층 방어.
2. **Claim 멱등**: 워커의 `updateMany`(PENDING→IN_PROGRESS) CAS. 다중 cron 인스턴스 동시 실행 안전(RefundJob 동형).
3. **발송 멱등 (at-least-once → effectively-once)**: Resend API의 **idempotency key**에 `dedupeKey`를 전달. 워커가 "Resend 발송 성공 직후 SUCCEEDED 마킹 전" 죽어 stale reaper가 재claim해도, Resend가 서버측에서 동일 키를 dedupe → 고객은 메일을 1통만 받는다. (Resend가 키를 지원하지 않는 SDK 버전이면 드문 중복 허용 — `providerId`로 추적.)

### D5. 발송 provider + Dev 폴백 (`shared/email/provider.ts`)

```
const useDevConsoleFallback = env.NODE_ENV !== "production";
async function sendEmail({ to, subject, html, text, idempotencyKey }):
  if (useDevConsoleFallback):
    logger.info("email.dev", { to, subject });
    console.log(렌더된 subject + text 미리보기);   // 실제 발송 0 → 바운스 방지
    return { id: `dev-${idempotencyKey}` };
  const resend = new Resend(env.RESEND_API_KEY);
  return resend.emails.send({ from: env.RESEND_FROM_EMAIL, to, subject, html, text }, { idempotencyKey });
```

auth.ts의 `useDevConsoleFallback`과 **동일 기준**(NODE_ENV만). production이 아니면 `@nextour.test` 시드 계정에 절대 실메일이 나가지 않는다.

**env 보강(Backend Expert):** production에서 `RESEND_API_KEY`·`RESEND_FROM_EMAIL`를 **필수**로 승격(`env.ts` superRefine — `CRON_SECRET`과 동일 패턴). 비-production은 optional 유지. → prod 부팅 시 키 누락을 조기 차단.

### D6. React Email 템플릿 (`shared/email/templates/`)

- `BookingConfirmationEmail.tsx`, `RefundCompletedEmail.tsx` — **순수 프레젠테이션 컴포넌트**. 도메인 객체가 아닌 **평문 props**(문자열·정수)만 받는다 → 도메인 무지, 독립 테스트 가능.
- `render.ts` — `EmailType` + props → `{ subject, html, text }`. `@react-email/render`로 HTML/텍스트 생성.
- `'use client'` 없음(서버 렌더링으로 HTML 문자열만 산출) → Architect 규칙 무위반.

### D7. 데이터 hydration 로더 (소유 entity에 위치)

워커가 cross-entity 쿼리를 직접 짜지 않도록, 발송 데이터 조립은 소유 entity가 책임:

- `entities/booking/api/getBookingConfirmationEmailData(bookingId)` → 예약확정 메일 props DTO (booking + user.email + departure + product + PAID payment.receiptUrl). **단일 쿼리 + include**(N+1 차단).
- `entities/payment/api/getRefundCompletedEmailData(bookingId)` → 환불 메일 props DTO (환불 금액·결제수단·예약 요약).

워커는 이 로더 → 템플릿 render → provider send를 **오케스트레이션만** 한다.

### D8. 워커 + cron (`shared/lib/email-job/`)

`embedding-job/worker.ts`를 형틀로 복제:
- `processEmailJobBatch({ limit })` — due job 조회(PENDING+nextRunAt 도래 / stale IN_PROGRESS) → per-job 격리 처리.
- `processOneEmailJob(jobId)` — CAS claim → type별 hydrate → render → send(idempotencyKey=dedupeKey) → SUCCEEDED(+`sentTo`/`providerId` 기록). 실패 시 attempts<MAX면 PENDING+backoff, ≥MAX면 영구 FAILED.
- cron route `app/api/cron/email-job/route.ts` — `CRON_SECRET` 가드, `force-dynamic`+`nodejs`, `processEmailJobBatch({ limit: 10 })`, 구조화 로그.
- `vercel.json`에 `{ "path": "/api/cron/email-job", "schedule": "*/2 * * * *" }` 추가.

## FSD 레이어 배치

| 유닛 | 경로 | 책임 | 의존 |
|---|---|---|---|
| EmailJob 모델 | `prisma/schema.prisma` | 큐 테이블 | — |
| 전이 정책(순수) | `entities/booking/model/emailPolicy.ts` | `(from,to)→descriptor\|null` | `@prisma/client`(타입) |
| outbox 훅 | `entities/booking/api/mutations.ts`(`transitionStatusTx`) | 전이 Tx 내 enqueue 호출 | emailPolicy, email-job/enqueue |
| enqueue SSOT | `shared/lib/email-job/enqueue.ts` | 멱등 적재(unique dedupeKey) | `@prisma/client`(타입) |
| 발송 provider | `shared/email/provider.ts` | Resend send + dev 폴백 | resend, env, logger |
| 템플릿 | `shared/email/templates/*.tsx` | React Email 프레젠테이션 | @react-email/components |
| render | `shared/email/render.ts` | type+props → subject/html/text | templates, @react-email/render |
| hydration 로더 | `entities/booking/api`, `entities/payment/api` | 발송 DTO 단일쿼리 조립 | db |
| 워커 | `shared/lib/email-job/worker.ts` | claim→hydrate→render→send | db, entities loaders, shared/email |
| cron | `app/api/cron/email-job/route.ts` | 스케줄 진입점 | worker, env |

**Architect 주의 — 의도된 FSD 예외:** 워커(`shared/lib/email-job`)가 hydration을 위해 `entities/*`를 import한다. 이는 EmbeddingJob 워커(`shared/lib/embedding-job/worker.ts`가 `@/entities/product` import)에서 이미 확립된 백그라운드 워커 예외와 **동일 선례**다. 워커 파일 헤더에 허용 import를 명시한다. 템플릿/provider/enqueue는 도메인 무지 유지.

## 에러 처리 & 엣지 케이스

- **발송 실패(Resend 5xx/네트워크)**: 백오프 PENDING 재적재 → cron 재시도. MAX_ATTEMPTS=5 후 영구 FAILED(운영자가 로그로 인지).
- **이미 취소된 booking 재전이**(refundRetry의 `InvalidTransitionError` silent ignore 경로): 전이가 throw되면 그 Tx 자체가 롤백 → EmailJob도 미적재. 단, 최초 `PAID/READY→CANCELED` 전이가 이미 환불 메일을 적재했으므로 결과적으로 1통은 발송됨(중복 아님).
- **시드/더미 수신자**: dev 폴백이 전면 차단. production에서도 `User.email`이 실주소이므로 정상.
- **상품/출발일 하드 삭제로 hydration 실패**: 워커가 데이터 부재 감지 시 영구 FAILED(재시도 무의미) — EmbeddingJob의 orphan 처리와 동형.

## 테스트 전략 (TDD)

- `emailPolicy.test.ts` — 전이 매트릭스 전 분기(PAID→확정, PAID/READY→취소=환불, 그 외 null). **순수 함수 우선 작성**.
- `enqueue.test.ts` — 신규 적재 / 중복 dedupeKey no-op.
- `transitions.test.ts`(보강) — PAID 전이 시 EmailJob 1행, RECEIVED→CANCELED 시 0행, PAID→CANCELED 시 환불 EmailJob 1행.
- `render.test.ts` — type별 subject·핵심 데이터(예약번호·금액·영수증링크) 포함.
- `provider.test.ts` — dev 폴백이 Resend를 호출하지 않고 콘솔 경로 사용.
- `worker.test.ts` — claim/hydrate/send 성공 → SUCCEEDED; send 실패 → backoff; MAX 초과 → FAILED.
- `route.test.ts` — CRON_SECRET 가드(401), 배치 위임.

## Out of Scope (YAGNI)

- 매직링크 발송의 큐 이전(NextAuth가 동기 관리, 지연 민감 — 현행 유지).
- 출발확정 알림/결제 만료 리마인더/E-ticket 발급 메일(다음 Phase 후보).
- 사용자 메일 수신 거부(unsubscribe)·발송 이력 admin 대시보드.
- 다국어 템플릿(한국어 단일).
- 실제 운영(live) 발송 도메인 검증(SPF/DKIM은 Resend 콘솔 수동 — 사용자 위임).

## ADR 후보

- **ADR-0030**(후보): "트랜잭셔널 아웃박스 — `transitionStatusTx` 단일 훅으로 거래 종료 메일 적재 + Resend 멱등키로 effectively-once 발송". 거부 대안: (a) 호출부 직접 발송(유실 창), (b) 환불/결제 경로별 개별 enqueue(SSOT 분산·drift), (c) payload JSON 박제(stale).
