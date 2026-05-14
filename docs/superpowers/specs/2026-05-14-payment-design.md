# 결제 모듈 설계 (M-PAYMENT)

> **버전**: v1.0
> **작성일**: 2026-05-14
> **상위 문서**: [Phase 2 Roadmap](./2026-05-13-phase2-roadmap.md), [M-BOOKING Design](./2026-05-14-booking-design.md)
> **마일스톤**: M2 (Phase 2 — 예약/결제/체크아웃 묶음 중 두 번째 모듈)
> **선행 모듈**: M-AUTH(사용자 세션), M-BOOKING(`entities/booking`, 상태머신, 좌석 lock)
> **적용 페르소나**: 💳 Domain Booking ⭐, 🏛️ Architect ⭐, ⚙️ Backend Expert, 🔬 QA Engineer
> **PG**: 토스페이먼츠(Toss Payments) v2 — KRW 단일 통화, 카드 결제

---

## 0. 범위 및 비범위

### 범위 (이 spec)
- `entities/payment` slice 신설 — Toss API client, 결제 mutation/query, 멱등성 키 모델
- **결제 승인 API**: `POST /api/payments/confirm` — 토스 결제 승인 호출 + **금액 cross-check** + booking 상태 전이(`DEPARTURE_CONFIRMED → PAID`)
- **웹훅 라우트**: `POST /api/payments/webhook/toss` — 서명 검증 + `providerEventId` 멱등성 + 비동기 상태 보정
- **보상 트랜잭션**: 토스 승인 성공 후 DB 갱신 실패 시 즉시 `cancelPayment` 강제 호출, 재시도 큐로 자기 치유
- **환불(전액)**: 사용자/관리자 취소 요청 시 `CANCELLATION_PENDING` 의사 상태 → PG `cancelPayment` → 좌석 환원 + `CANCELED_BY_*` 전이
- **`PaymentEvent` 모델 신규** — `providerEventId UNIQUE`를 멱등성 키로 사용
- **Toss API client** — `shared/lib/toss/`(서버 전용) 추출, 서명 검증·재시도·timeout 정책 포함
- 모든 금액은 정수(원 단위). 응답 `amount`와 DB `Payment.amount`/`Booking.totalPrice`의 3중 일치 검증

### 비범위 (별도 작업)
- **카드 외 결제수단**(가상계좌·간편결제·휴대폰) — Phase 3
- **부분 환불·분할 결제·다중 통화** — Phase 3
- **체크아웃 UX**(`/products/[id]/checkout`, 결제 위젯 컴포넌트) — **M-CHECKOUT spec**
- **결제 만료 자동 취소 cron**(`DEPARTURE_CONFIRMED`에 머무는 booking을 X분 후 `CANCELED_BY_AGENCY`로) — admin/operations spec
- **정산·리포트** — 토스 대시보드에 위임
- **rate limit·DDoS 방어**(결제 시도 제한) — M-OBS 후 별도 spec

---

## 1. 도메인 모델 변경

### 1.1 기존 모델 재사용
| 모델 | 본 spec에서의 역할 |
|------|-------------------|
| `Booking` | 결제 대상. `status` 전이(`DEPARTURE_CONFIRMED → PAID`)를 `transitionStatus`로 일임 |
| `Payment` | 결제 1건 1행. `tossOrderId @unique`(가맹점 발급), `tossPaymentKey @unique`(토스 발급). 본 spec의 핵심 컬럼은 이미 존재 |
| `BookingEvent` | append-only 감사 로그(결제 성공 시 `DEPARTURE_CONFIRMED → PAID` 1건 자동 기록 — `transitionStatus` 위임) |

### 1.2 신규 모델 — `PaymentEvent` (필수)

웹훅·승인 응답 등 PG로부터 수신/시도하는 모든 이벤트의 멱등성 키.
**M-BOOKING spec에서 schema 변경 없음으로 두었던 항목 중 유일하게 본 spec에서 추가됨.**

```prisma
enum PaymentEventResult {
  PROCESSED       // 정상 반영
  SKIPPED         // 중복(idempotent no-op)
  IGNORED         // 알 수 없는 type, 의도적 무시
  FAILED          // 처리 중 예외 — 재시도 후보
}

model PaymentEvent {
  id              String              @id @default(cuid())
  providerEventId String              @unique  // 멱등 키. 토스 webhook eventId 또는 confirm-API call id
  bookingId       String?
  paymentId       String?
  type            String              // "CONFIRM_REQUEST" | "WEBHOOK:PAYMENT_DONE" | "WEBHOOK:PAYMENT_FAILED" | "REFUND_REQUEST" | "REFUND_DONE" | ...
  payload         Json                // 원본 페이로드 보존(감사용)
  result          PaymentEventResult
  errorMessage    String?
  createdAt       DateTime            @default(now())

  booking Booking? @relation(fields: [bookingId], references: [id], onDelete: SetNull)
  payment Payment? @relation(fields: [paymentId], references: [id], onDelete: SetNull)

  @@index([bookingId, createdAt])
  @@index([paymentId, createdAt])
  @@index([type, createdAt])
}
```

> 마이그레이션 시 `Booking.events` / `Payment` 모델에 `paymentEvents PaymentEvent[]` 역방향 관계 1줄씩 추가. 인덱스는 운영 쿼리(같은 bookingId의 시계열 추적, 타입별 통계)를 가정.

### 1.3 신규 모델 — `RefundJob` (선택, 권장)

환불은 PG 호출이 포함되므로 1회 실패 시 자동 재시도가 필요. cron이 정리.

```prisma
enum RefundJobStatus {
  PENDING
  IN_PROGRESS
  SUCCEEDED
  FAILED
}

model RefundJob {
  id          String          @id @default(cuid())
  bookingId   String
  paymentId   String
  amount      Int                              // 원 단위 정수, 전액
  reason      String?
  status      RefundJobStatus @default(PENDING)
  attempts    Int             @default(0)
  lastError   String?
  nextRunAt   DateTime        @default(now())   // exponential backoff
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  booking Booking @relation(fields: [bookingId], references: [id])
  payment Payment @relation(fields: [paymentId], references: [id])

  @@index([status, nextRunAt])
}
```

MVP에서 `RefundJob`이 필수는 아니지만(첫 호출 동기 시도로 90%+ 처리), **보상 트랜잭션이 진짜 동작하려면 재시도 채널이 있어야 한다**. cron 자체는 admin/M-OBS spec 범위지만, **모델·enqueue API는 본 spec에서 정의**한다.

### 1.4 `Booking` 보강 — `paymentDueAt`(권장)

M-BOOKING spec에서 보류했던 컬럼. 결제 만료 자동 취소 cron을 위해 본 spec에서 추가 권장.

```prisma
model Booking {
  // ... 기존
  paymentDueAt DateTime?    // DEPARTURE_CONFIRMED 진입 시 set (예: now + 24h)
  @@index([status, paymentDueAt])
}
```

본 spec 코드는 `paymentDueAt`이 있다고 가정하고 만료 검사를 한다. 실제 cron 구현은 admin spec.

---

## 2. 결제 플로우 (전체)

### 2.1 흐름 개요

```
[클라이언트: Toss SDK]
    │  ① requestPayment(orderId, amount, ...)
    │     - orderId = booking.id 또는 별도 발급(아래 §2.2 참조)
    │     - amount = booking.totalPrice (서버에서 미리 주입)
    ▼
[토스 결제창 / 인증]
    │  ② 성공 시 successUrl?paymentKey&orderId&amount 로 redirect
    ▼
[브라우저 → 우리 successUrl]
    │  ③ POST /api/payments/confirm { paymentKey, orderId, amount }
    ▼
[Server Action / Route: confirmPayment]
    ├─ [Phase 1] Booking 검증 + Payment row insert (status=PENDING, tossOrderId=orderId)
    │       - assertTransition 사전 검사 (DEPARTURE_CONFIRMED → PAID 가능?)
    │       - amount 3중 검증 (request.amount == booking.totalPrice == payment.amount)
    │
    ├─ [Phase 2] Toss POST /v1/payments/confirm 호출 (외부 IO, DB tx 밖)
    │       - 성공: paymentKey, status, approvedAt, totalAmount 수신
    │       - 실패: failure code 수신
    │
    ├─ [Phase 3-success] DB 트랜잭션:
    │       - 응답 totalAmount === booking.totalPrice 재검증
    │       - Payment update (status=PAID, tossPaymentKey, paidAt, receiptUrl)
    │       - booking transitionStatus → PAID  (좌석 환원 X, BookingEvent 자동 기록)
    │       - PaymentEvent insert (type=CONFIRM_REQUEST, result=PROCESSED, providerEventId=`confirm:${paymentKey}`)
    │
    ├─ [Phase 3-failure] DB 트랜잭션:
    │       - Payment update (status=FAILED, failureCode/Message)
    │       - booking 상태 유지(재시도 가능) — 만료 정책은 cron
    │       - PaymentEvent insert (result=FAILED)
    │
    └─ [Phase 3-rollback] Toss 승인 성공 + DB 실패:
            - 즉시 Toss cancelPayment(paymentKey, cancelReason="db_failure", cancelAmount=totalAmount) 동기 호출
            - cancel 성공 → Payment.status=CANCELED, booking 무전이
            - cancel 실패 → RefundJob enqueue(이미 결제됨, 좌석 점유 중) + critical 로그

[병행: 토스 → POST /api/payments/webhook/toss]
    │  ④ PAYMENT_STATUS_CHANGED, DONE, CANCELED 등
    │     - 서명 검증
    │     - providerEventId(`webhook:${eventId}`) 멱등성 검사
    │     - PaymentEvent insert
    │     - confirm-API가 이미 처리한 booking이면 SKIPPED
    │     - 아직 PENDING이면 동일 로직으로 보정 처리
    ▼
[브라우저 redirect → /bookings/[id] (M-CHECKOUT 범위)]
```

### 2.2 `orderId` 결정 정책

- `Payment.tossOrderId`는 토스에 보내는 식별자이자 우리 DB의 `@unique` 멱등 키.
- **MVP 정책**: `orderId = ${booking.id}__${attemptSeq}` 형태로 매 결제 시도마다 신규 발급.
  - 첫 시도 실패 후 재시도하면 `__2`, `__3`. tossOrderId UNIQUE 충돌 회피.
  - booking 1건당 PAID Payment는 최대 1개(아래 §3.4의 sql 조건으로 보장).
- 노출 길이 제한(64자) 안에 booking.id(cuid 25자) + suffix 충분.

> 단순히 `orderId = booking.id`로 두면 재시도 불가(unique 충돌). 반드시 suffix 부여.

---

## 3. `POST /api/payments/confirm` 상세 설계

### 3.1 입력·출력 스키마

```ts
// entities/payment/model/schemas.ts
export const ConfirmPaymentRequestSchema = z.object({
  paymentKey: z.string().min(1).max(200),
  orderId:    z.string().min(1).max(64),
  amount:     z.number().int().positive(),   // 원 단위 정수만
});

export type ConfirmPaymentRequest = z.infer<typeof ConfirmPaymentRequestSchema>;

export const ConfirmPaymentResponseSchema = z.object({
  bookingId: z.string(),
  status:    z.enum(["PAID", "FAILED"]),
  failureMessage: z.string().optional(),
});
```

### 3.2 라우트 핸들러 (App Router Route Handler)

`src/app/api/payments/confirm/route.ts`. RSC가 아닌 mutation 진입점이므로 **Route Handler**로 구현(Server Action도 가능하나, 외부 IO + 명시적 HTTP 응답 필요로 Route 선호).

```ts
// src/app/api/payments/confirm/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/features/auth";
import { confirmPayment } from "@/entities/payment";
import { ConfirmPaymentRequestSchema } from "@/entities/payment";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = ConfirmPaymentRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "BAD_REQUEST", issues: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await confirmPayment({
      userId: session.user.id,
      ...parsed.data,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return mapPaymentError(err);   // §3.6 참고
  }
}
```

### 3.3 핵심 함수 `confirmPayment` (3-phase)

```ts
// entities/payment/api/confirm.ts
export async function confirmPayment(input: {
  userId: string;
  paymentKey: string;
  orderId: string;
  amount: number;
}): Promise<{ bookingId: string; status: "PAID" | "FAILED"; failureMessage?: string }> {

  // ── Phase 1: 사전 검증 + Payment row 멱등성 확보 ─────────────
  const { bookingId, payment } = await db.$transaction(async (tx) => {
    // (1) tossOrderId로 Payment 조회 — 재시도/중복 호출 방어
    const existing = await tx.payment.findUnique({
      where: { tossOrderId: input.orderId },
      include: { booking: { select: { id: true, userId: true, status: true, totalPrice: true } } },
    });

    let payment = existing;
    let booking = existing?.booking ?? null;

    if (!payment) {
      // 신규 시도 — orderId 패턴에서 bookingId 추출
      const bookingId = parseBookingIdFromOrderId(input.orderId);  // "{cuid}__{seq}"
      booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: { id: true, userId: true, status: true, totalPrice: true },
      });
      if (!booking) throw new PaymentError("BOOKING_NOT_FOUND");

      // (2) 소유권 검증
      if (booking.userId !== input.userId) throw new PaymentError("FORBIDDEN");

      // (3) 사전 전이 검사 — 락은 아니지만 명백한 오류는 즉시 거부
      if (booking.status !== "DEPARTURE_CONFIRMED") {
        throw new PaymentError("BOOKING_NOT_PAYABLE", { current: booking.status });
      }

      // (4) 금액 1차 검증: request.amount === booking.totalPrice
      if (input.amount !== booking.totalPrice) {
        throw new PaymentError("AMOUNT_MISMATCH_REQUEST", {
          request: input.amount, booking: booking.totalPrice,
        });
      }

      // (5) Payment row 생성
      payment = await tx.payment.create({
        data: {
          bookingId: booking.id,
          method: "CARD",
          amount: booking.totalPrice,
          status: "PENDING",
          tossOrderId: input.orderId,
        },
        include: { booking: { select: { id: true, userId: true, status: true, totalPrice: true } } },
      });
    } else {
      // (6) 기존 Payment — 이미 PAID면 같은 응답으로 멱등 반환
      if (payment.status === "PAID") {
        return { bookingId: payment.bookingId, payment };
      }
      // PENDING이면 동일 paymentKey 재시도 — 진행
      if (payment.bookingId !== booking!.id || booking!.userId !== input.userId) {
        throw new PaymentError("FORBIDDEN");
      }
    }

    return { bookingId: payment.bookingId, payment };
  });

  // 이미 PAID였다면 위에서 일찍 반환되었어야 함(타입상은 흐름 유지)
  if (payment.status === "PAID") {
    return { bookingId, status: "PAID" };
  }

  // ── Phase 2: 외부 PG 호출 (DB 트랜잭션 밖) ───────────────────
  let pg: TossConfirmResponse;
  try {
    pg = await toss.confirm({
      paymentKey: input.paymentKey,
      orderId: input.orderId,
      amount: input.amount,
    });
  } catch (err) {
    // 네트워크/타임아웃 등 — 결제 성공 여부 불명 → 웹훅에 위임
    await db.$transaction([
      db.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED", failureCode: "PG_NETWORK", failureMessage: String(err) },
      }),
      db.paymentEvent.create({
        data: {
          providerEventId: `confirm:${input.paymentKey}:network-error:${Date.now()}`,
          bookingId, paymentId: payment.id,
          type: "CONFIRM_REQUEST",
          payload: { error: String(err) },
          result: "FAILED",
          errorMessage: String(err),
        },
      }),
    ]);
    throw new PaymentError("PG_NETWORK_ERROR");
    // 웹훅이 동일 paymentKey에 대해 DONE을 보내면 그 때 PAID로 보정됨
  }

  // ── Phase 3a: PG 응답 검증 + DB 갱신 ───────────────────────
  if (pg.status === "DONE") {
    // (1) 응답 금액 2차 검증: pg.totalAmount === payment.amount === booking.totalPrice
    if (pg.totalAmount !== payment.amount) {
      // 금액 불일치 — 신뢰할 수 없는 상태, 즉시 보상 cancel
      await compensateCancel({
        paymentKey: input.paymentKey,
        bookingId, paymentId: payment.id,
        cancelAmount: pg.totalAmount,
        reason: "AMOUNT_MISMATCH_PG_RESPONSE",
      });
      throw new PaymentError("AMOUNT_MISMATCH_PG_RESPONSE", {
        pg: pg.totalAmount, expected: payment.amount,
      });
    }

    // (2) booking 상태 + Payment + PaymentEvent 단일 트랜잭션
    try {
      await db.$transaction(async (tx) => {
        // booking 상태 전이 — assertTransition + BookingEvent는 transitionStatus 내부에서 처리
        // ⚠️ transitionStatus는 자체 트랜잭션을 연다. tx 컨텍스트를 받지 않으므로
        //    여기서는 트랜잭션을 그대로 두고, 끝난 후 transitionStatus를 호출하거나
        //    transitionStatus의 tx 주입형 오버로드를 사용한다(§5.2 hand-off 참조).
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: "PAID",
            tossPaymentKey: input.paymentKey,
            paidAt: new Date(pg.approvedAt),
            receiptUrl: pg.receipt?.url ?? null,
          },
        });
        await tx.paymentEvent.create({
          data: {
            providerEventId: `confirm:${input.paymentKey}`,
            bookingId, paymentId: payment.id,
            type: "CONFIRM_REQUEST",
            payload: pg as any,
            result: "PROCESSED",
          },
        });
      });

      // booking 상태 전이는 별도 호출 (트랜잭션 분리는 의도적, §5.2)
      await transitionStatus({
        bookingId,
        to: "PAID",
        actor: `system:payment:confirm:${input.paymentKey}`,
        reason: `tossPaymentKey=${input.paymentKey}`,
      });
    } catch (dbErr) {
      // ⛑️ 보상 트랜잭션: PG는 승인됐는데 우리 DB가 못 따라잡음 → 강제 환불
      await compensateCancel({
        paymentKey: input.paymentKey,
        bookingId, paymentId: payment.id,
        cancelAmount: pg.totalAmount,
        reason: "DB_UPDATE_FAILED",
      });
      throw new PaymentError("DB_UPDATE_FAILED", { cause: dbErr });
    }

    return { bookingId, status: "PAID" };
  }

  // ── Phase 3b: PG가 명시적 실패 응답 ──────────────────────────
  await db.$transaction([
    db.payment.update({
      where: { id: payment.id },
      data: {
        status: "FAILED",
        failureCode: pg.failure?.code ?? "UNKNOWN",
        failureMessage: pg.failure?.message ?? null,
      },
    }),
    db.paymentEvent.create({
      data: {
        providerEventId: `confirm:${input.paymentKey}:failure`,
        bookingId, paymentId: payment.id,
        type: "CONFIRM_REQUEST",
        payload: pg as any,
        result: "FAILED",
        errorMessage: pg.failure?.message ?? "PG returned non-DONE",
      },
    }),
  ]);
  return { bookingId, status: "FAILED", failureMessage: pg.failure?.message };
}
```

### 3.4 금액 cross-check (3중 검증)

| 검증 시점 | 비교 대상 | 실패 시 |
|----------|----------|--------|
| Phase 1 (1차) | `request.amount` ⇔ `booking.totalPrice` | 즉시 400, PG 호출 안 함 |
| Phase 2 진입 직전 | `payment.amount` ⇔ `booking.totalPrice` | 동일(보강용, Payment row 생성 직후라 동일해야 함) |
| Phase 3a (2차) | `pg.totalAmount` ⇔ `payment.amount` | 보상 cancel 즉시 호출, 422 응답 |

> 외부 PG 응답이 변조될 가능성은 낮으나, 사용자 측 SDK가 `amount`를 임의로 바꿔 보내는 경우는 흔한 공격 벡터. 1차 검증으로 차단되지만 2차 검증으로 이중 안전.

### 3.5 booking에 PAID 결제는 최대 1건 보장

이중 결제(같은 booking에 두 PG 승인) 방어. Postgres partial unique index 1줄 추가:

```sql
CREATE UNIQUE INDEX payment_one_paid_per_booking
  ON "Payment" ("bookingId")
  WHERE status = 'PAID';
```

Prisma `schema.prisma`에 raw migration으로 추가. 두 번째 PAID 시도는 unique 위반 → 보상 cancel로 회수.

### 3.6 에러 매핑

```ts
// entities/payment/api/errors.ts
export class PaymentError extends Error {
  constructor(public code: string, public context?: Record<string, unknown>) {
    super(code);
    this.name = "PaymentError";
  }
}

// route 측 매핑
function mapPaymentError(err: unknown) {
  if (err instanceof PaymentError) {
    switch (err.code) {
      case "FORBIDDEN":                  return NextResponse.json({ error: err.code }, { status: 403 });
      case "BOOKING_NOT_FOUND":          return NextResponse.json({ error: err.code }, { status: 404 });
      case "BOOKING_NOT_PAYABLE":
      case "AMOUNT_MISMATCH_REQUEST":    return NextResponse.json({ error: err.code, context: err.context }, { status: 409 });
      case "AMOUNT_MISMATCH_PG_RESPONSE":
      case "DB_UPDATE_FAILED":           return NextResponse.json({ error: err.code }, { status: 422 });
      case "PG_NETWORK_ERROR":           return NextResponse.json({ error: err.code }, { status: 503 });
    }
  }
  if (err instanceof InvalidTransitionError) {
    return NextResponse.json({ error: "INVALID_TRANSITION", message: err.message }, { status: 409 });
  }
  console.error("[payments/confirm] unhandled", err);
  return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
}
```

---

## 4. 웹훅 라우트 설계 (`POST /api/payments/webhook/toss`)

### 4.1 책임
- **신뢰의 단일 소스**: 가상계좌·비동기 결제·취소 알림 등 confirm-API에서 놓친 상태 변경을 보정.
- **멱등성 절대 보장**: 같은 `eventId`가 N번 와도 결과는 1번 적용.
- **서명 검증**: Toss `toss-signature` 헤더(또는 v2에서 정의된 헤더)로 위조 차단.

### 4.2 핸들러

```ts
// src/app/api/payments/webhook/toss/route.ts
import { NextResponse } from "next/server";
import { handleTossWebhook } from "@/entities/payment";

export async function POST(req: Request) {
  // 1) 원본 body 보존 (서명 검증용 — JSON.parse 전)
  const rawBody = await req.text();
  const signature = req.headers.get("toss-signature");

  try {
    await handleTossWebhook({ rawBody, signature });
    return new NextResponse("OK", { status: 200 });
  } catch (err) {
    if (err instanceof InvalidSignatureError) {
      return new NextResponse("Invalid signature", { status: 401 });
    }
    console.error("[webhook/toss] unhandled", err);
    // 5xx로 응답하면 토스가 재시도 → 멱등성으로 안전
    return new NextResponse("Server error", { status: 500 });
  }
}

// 200을 빠르게 회신하기 위해 force-dynamic + 짧은 timeout 권장
export const dynamic = "force-dynamic";
export const runtime = "nodejs";   // Edge 금지 — Prisma 사용
```

### 4.3 멱등성 + 처리 함수

```ts
// entities/payment/api/webhook.ts
export async function handleTossWebhook({
  rawBody, signature,
}: { rawBody: string; signature: string | null }) {

  // (1) 서명 검증 — Toss가 정의한 알고리즘(HMAC-SHA256(env.TOSS_WEBHOOK_SECRET, rawBody) 등)
  if (!signature || !verifyTossSignature(rawBody, signature, env.TOSS_WEBHOOK_SECRET)) {
    throw new InvalidSignatureError();
  }

  // (2) 파싱 + 스키마 검증
  const json = JSON.parse(rawBody);
  const event = TossWebhookEventSchema.parse(json);
  const idemKey = `webhook:${event.eventId}`;

  // (3) 멱등성 + 처리 — 단일 트랜잭션
  await db.$transaction(async (tx) => {
    const existing = await tx.paymentEvent.findUnique({
      where: { providerEventId: idemKey },
    });
    if (existing) return;   // ✅ 중복 — no-op

    // 결제 row 조회
    const payment = await tx.payment.findUnique({
      where: { tossOrderId: event.orderId },
      include: { booking: { select: { id: true, status: true, userId: true, totalPrice: true } } },
    });

    if (!payment) {
      // 우리에게 없는 orderId — 의도적 무시(SKIPPED). 토스 콘솔에서 테스트 발신했을 가능성.
      await tx.paymentEvent.create({
        data: {
          providerEventId: idemKey,
          type: `WEBHOOK:${event.type}`,
          payload: event as any,
          result: "IGNORED",
          errorMessage: "Unknown orderId",
        },
      });
      return;
    }

    // 분기 처리 — 모든 분기는 같은 트랜잭션 내, 마지막에 PaymentEvent insert
    switch (event.type) {
      case "PAYMENT_DONE":
      case "PAYMENT_CONFIRMED": {
        if (payment.status === "PAID") {
          // confirm-API가 이미 처리한 케이스 — SKIPPED 기록
          await recordEvent(tx, idemKey, event, payment, "SKIPPED");
          return;
        }
        if (event.totalAmount !== payment.amount) {
          await recordEvent(tx, idemKey, event, payment, "FAILED", "Amount mismatch");
          // ⚠️ 보상 cancel은 트랜잭션 밖에서 호출해야 하므로 마커만 남기고 백그라운드 잡으로
          // (단순화: 본 spec MVP에서는 critical 로그 + RefundJob enqueue로 처리, §5.4)
          throw new PaymentError("WEBHOOK_AMOUNT_MISMATCH");
        }
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: "PAID",
            tossPaymentKey: event.paymentKey,
            paidAt: new Date(event.approvedAt),
            receiptUrl: event.receipt?.url ?? null,
          },
        });
        await recordEvent(tx, idemKey, event, payment, "PROCESSED");
        // booking 전이는 트랜잭션 밖에서(아래)
        break;
      }
      case "PAYMENT_FAILED":
      case "PAYMENT_ABORTED": {
        if (payment.status === "FAILED" || payment.status === "CANCELED") {
          await recordEvent(tx, idemKey, event, payment, "SKIPPED");
          return;
        }
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: "FAILED",
            failureCode: event.failure?.code ?? "UNKNOWN",
            failureMessage: event.failure?.message ?? null,
          },
        });
        await recordEvent(tx, idemKey, event, payment, "PROCESSED");
        break;
      }
      case "PAYMENT_CANCELED": {
        // 환불 완료 알림 — confirmCancel이 이미 처리했을 가능성 큼
        if (payment.status === "CANCELED") {
          await recordEvent(tx, idemKey, event, payment, "SKIPPED");
          return;
        }
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: "CANCELED", canceledAt: new Date(event.canceledAt) },
        });
        await recordEvent(tx, idemKey, event, payment, "PROCESSED");
        break;
      }
      default: {
        await recordEvent(tx, idemKey, event, payment, "IGNORED", `Unknown type: ${event.type}`);
        return;
      }
    }
  });

  // 트랜잭션 성공 후 booking 상태 보정 (별도 트랜잭션)
  // — handleTossWebhook은 멱등이므로 transitionStatus의 assertTransition이 두 번째 호출은 자동 거부
  await maybeApplyBookingTransition(event);
}
```

### 4.4 booking 상태 보정 `maybeApplyBookingTransition`

```ts
async function maybeApplyBookingTransition(event: TossWebhookEvent) {
  const payment = await db.payment.findUnique({
    where: { tossOrderId: event.orderId },
    select: { bookingId: true, status: true, booking: { select: { status: true } } },
  });
  if (!payment) return;

  // PAID 보정
  if (event.type === "PAYMENT_DONE" || event.type === "PAYMENT_CONFIRMED") {
    if (payment.status === "PAID" && payment.booking.status === "DEPARTURE_CONFIRMED") {
      try {
        await transitionStatus({
          bookingId: payment.bookingId,
          to: "PAID",
          actor: `system:webhook:toss:${event.eventId}`,
          reason: `webhook ${event.type}`,
        });
      } catch (e) {
        if (e instanceof InvalidTransitionError) return; // 이미 PAID 등 — no-op
        throw e;
      }
    }
  }
  // CANCELED 보정도 동일 패턴 (PAID → CANCELED_BY_USER/AGENCY)
  // — 단, 환불 트리거 측이 booking 전이를 동기로 처리하므로 여기서는 SKIPPED가 대부분.
}
```

### 4.5 웹훅 응답 정책
- 200을 빠르게 회신해야 토스가 재시도 폭주를 안 함.
- 5xx 응답 시 토스는 재시도 → 멱등성 키로 안전하게 흡수.
- 401/4xx는 토스가 재시도를 멈춤 → 서명 검증 실패에만 사용.

### 4.6 멱등성 보강 — `providerEventId` 발급 규칙

| 출처 | 형식 | 비고 |
|------|-----|------|
| confirm-API 성공 | `confirm:${paymentKey}` | confirm은 1번만 시도해도 paymentKey는 영구 고유 |
| confirm-API 네트워크 오류 | `confirm:${paymentKey}:network-error:${timestamp}` | 재시도 시 동일 paymentKey여도 별도 기록 |
| webhook | `webhook:${event.eventId}` | 토스가 eventId를 발급(없을 경우 `orderId+type+createdAt` 해시 폴백) |
| 환불 시도 | `refund-request:${paymentKey}:${attempt}` | RefundJob.attempts 사용 |
| 환불 결과 | `refund-result:${paymentKey}` | PG의 cancel response 단일 |

---

## 5. 상태머신 연동 (Booking ↔ Payment)

### 5.1 상태 매핑

| Booking.status (M-BOOKING) | Payment.status (본 spec) | 트리거 |
|---------------------------|--------------------------|--------|
| `DEPARTURE_CONFIRMED` | (없음) 또는 `PENDING` | M-BOOKING cron이 부여 → 결제 가능 시점 |
| `DEPARTURE_CONFIRMED` | `PENDING` | confirm-API Phase 1에서 Payment row 생성 |
| `DEPARTURE_CONFIRMED` | `FAILED` | confirm 실패 — booking은 재시도 가능 |
| `PAID` | `PAID` | confirm-API Phase 3a 성공 |
| `CANCELED_BY_USER`/`CANCELED_BY_AGENCY` | `CANCELED` | 환불 완료 — `refund` 함수가 두 update를 묶음 |

### 5.2 트랜잭션 경계 (왜 분리하는가)

**원칙**: 외부 PG 호출은 DB 트랜잭션 밖. booking `transitionStatus`는 자체 트랜잭션을 연다.

```
confirm-API:
  ┌─ DB Tx-1 ─┐         ┌─ External: Toss /confirm ─┐         ┌─ DB Tx-2 ─┐  ┌─ DB Tx-3 ──┐
  │ Payment   │  ────▶  │   외부 호출 (~수 초)        │ ────▶ │ Payment   │  │ booking    │
  │ create    │         │   응답 amount 수신         │        │ update    │  │ transition │
  │ PENDING   │         └────────────────────────┘        │ PaymentEvt│  │ DEP→PAID   │
  └───────────┘                                            └───────────┘  └────────────┘
                                                              ↑                ↑
                                            Tx-2 실패 → 보상 cancel      Tx-3 실패 → 보상 cancel
```

`transitionStatus`를 별도 트랜잭션으로 두는 이유:
1. M-BOOKING이 `db.$transaction`을 내부에 캡슐화 → tx 주입형 오버로드를 만들지 않은 상태.
2. Payment update(Tx-2)와 booking transition(Tx-3)이 분리되면 **Tx-3 실패만 보상 대상이 좁아져 추적이 쉬움**.
3. 단, Tx-2는 성공 + Tx-3 실패 시 PaymentEvent에 정합성 마커를 남기고 RefundJob enqueue (§5.4).

> **후속 검토**: M-BOOKING에 `transitionStatus(tx, ...)` 오버로드를 추가해 confirm-API의 Tx-2와 Tx-3를 합치는 게 더 안전. 본 spec MVP는 합치지 않음(단순성), §11에 ADR 후보로 명시.

### 5.3 환불(전액) 흐름

```ts
// entities/payment/api/refund.ts
export async function refundBooking(input: {
  bookingId: string;
  actor: string;             // "user:{id}" | "admin:{id}"
  reason?: string;
}): Promise<void> {

  // (1) booking + payment 조회 + 사전 검증
  const booking = await db.booking.findUniqueOrThrow({
    where: { id: input.bookingId },
    include: {
      payments: { where: { status: "PAID" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (booking.status !== "PAID" && booking.status !== "READY") {
    throw new PaymentError("BOOKING_NOT_REFUNDABLE", { current: booking.status });
  }

  const payment = booking.payments[0];
  if (!payment || !payment.tossPaymentKey) {
    throw new PaymentError("PAID_PAYMENT_NOT_FOUND");
  }

  // (2) Phase 1: cancel job enqueue (DB) — 중복 환불 방지를 위한 RefundJob.unique 조건
  const job = await db.$transaction(async (tx) => {
    const existing = await tx.refundJob.findFirst({
      where: { paymentId: payment.id, status: { in: ["PENDING", "IN_PROGRESS", "SUCCEEDED"] } },
    });
    if (existing) throw new PaymentError("REFUND_ALREADY_REQUESTED", { jobId: existing.id });
    return tx.refundJob.create({
      data: {
        bookingId: booking.id,
        paymentId: payment.id,
        amount: payment.amount,
        reason: input.reason,
        status: "IN_PROGRESS",
        attempts: 1,
      },
    });
  });

  // (3) Phase 2: PG cancel 호출
  let cancelResp;
  try {
    cancelResp = await toss.cancel({
      paymentKey: payment.tossPaymentKey,
      cancelReason: input.reason ?? "user request",
      cancelAmount: payment.amount,
    });
  } catch (err) {
    // cron 재시도에 위임. booking은 PAID/READY 그대로 유지(좌석 점유 유지).
    await db.refundJob.update({
      where: { id: job.id },
      data: {
        status: "PENDING",
        lastError: String(err),
        nextRunAt: backoff(job.attempts),
      },
    });
    throw new PaymentError("REFUND_DEFERRED");
  }

  // (4) Phase 3: 성공 — Payment + RefundJob + PaymentEvent
  await db.$transaction([
    db.payment.update({
      where: { id: payment.id },
      data: { status: "CANCELED", canceledAt: new Date() },
    }),
    db.refundJob.update({
      where: { id: job.id },
      data: { status: "SUCCEEDED" },
    }),
    db.paymentEvent.create({
      data: {
        providerEventId: `refund-result:${payment.tossPaymentKey}`,
        bookingId: booking.id, paymentId: payment.id,
        type: "REFUND_DONE",
        payload: cancelResp as any,
        result: "PROCESSED",
      },
    }),
  ]);

  // (5) booking 상태 전이 — 좌석 환원은 transitionStatus가 자동 처리(shouldReturnSeats)
  const toStatus = input.actor.startsWith("user:")
    ? "CANCELED_BY_USER"
    : "CANCELED_BY_AGENCY";
  await transitionStatus({
    bookingId: booking.id,
    to: toStatus,
    actor: input.actor,
    reason: `refund: ${input.reason ?? "n/a"}`,
  });
}
```

### 5.4 보상 cancel `compensateCancel`

```ts
async function compensateCancel(input: {
  paymentKey: string;
  bookingId: string;
  paymentId: string;
  cancelAmount: number;
  reason: string;
}) {
  // 동기 1회 시도
  try {
    await toss.cancel({
      paymentKey: input.paymentKey,
      cancelReason: input.reason,
      cancelAmount: input.cancelAmount,
    });
    // 성공 시 Payment + Event 기록
    await db.$transaction([
      db.payment.update({
        where: { id: input.paymentId },
        data: { status: "CANCELED", canceledAt: new Date(), failureCode: input.reason },
      }),
      db.paymentEvent.create({
        data: {
          providerEventId: `compensate:${input.paymentKey}`,
          bookingId: input.bookingId, paymentId: input.paymentId,
          type: "COMPENSATE_CANCEL",
          payload: { reason: input.reason } as any,
          result: "PROCESSED",
        },
      }),
    ]);
  } catch (err) {
    // ⚠️ 가장 위험한 상태: PG는 결제 보유, DB는 부정합. RefundJob에 즉시 enqueue + critical 알림
    await db.$transaction([
      db.refundJob.create({
        data: {
          bookingId: input.bookingId, paymentId: input.paymentId,
          amount: input.cancelAmount,
          reason: `auto-compensate: ${input.reason}`,
          status: "PENDING",
          attempts: 1,
          lastError: String(err),
          nextRunAt: new Date(Date.now() + 30_000),  // 30초 후 첫 재시도
        },
      }),
      db.paymentEvent.create({
        data: {
          providerEventId: `compensate:${input.paymentKey}:failed:${Date.now()}`,
          bookingId: input.bookingId, paymentId: input.paymentId,
          type: "COMPENSATE_CANCEL",
          payload: { reason: input.reason, error: String(err) } as any,
          result: "FAILED",
          errorMessage: String(err),
        },
      }),
    ]);
    logger.error({
      kind: "payment.compensate.failed",
      paymentKey: input.paymentKey,
      bookingId: input.bookingId,
      error: String(err),
    });
  }
}
```

### 5.5 보상 시나리오 의사결정 매트릭스

| PG 결과 | DB 결과 | 조치 |
|---------|---------|------|
| 성공 | 성공 | ✅ 정상 — 응답 반환 |
| 성공 | 실패(예: DB 다운) | ⛑️ `compensateCancel` 즉시 호출 — 환불 |
| 성공 | 부분 실패(Payment update만 실패) | Tx-2 롤백 → `compensateCancel` |
| 실패 | (DB 무영향) | ✅ Payment FAILED 기록, booking 유지, 사용자 재시도 가능 |
| 타임아웃 | (불명) | Payment FAILED 임시 기록 + 웹훅에 보정 위임. 동일 paymentKey 웹훅 도착 시 PAID로 복구 |
| 금액 불일치 응답 | (DB 무영향) | ⛑️ `compensateCancel` 호출, 422 |
| 서명 위조 웹훅 | — | 401 + 처리 안 함 |
| 중복 웹훅 | — | `PaymentEvent.providerEventId` UNIQUE로 no-op |

---

## 6. FSD 매핑 (Architect)

### 6.1 신규 slice 구조

```
src/entities/payment/
├── model/
│   ├── types.ts              ← TossConfirmResponse, TossWebhookEvent, ...
│   ├── constants.ts          ← PAYMENT_METHOD_LABEL_KR 등(M-CHECKOUT용 재export)
│   ├── schemas.ts            ← ConfirmPaymentRequestSchema, TossWebhookEventSchema
│   └── __tests__/
│       └── schemas.test.ts
├── api/
│   ├── confirm.ts            ← confirmPayment (3-phase)
│   ├── webhook.ts            ← handleTossWebhook, maybeApplyBookingTransition
│   ├── refund.ts             ← refundBooking, compensateCancel, backoff
│   ├── errors.ts             ← PaymentError, InvalidSignatureError
│   ├── orderId.ts            ← buildOrderId, parseBookingIdFromOrderId (순수 함수)
│   ├── crossCheck.ts         ← assertAmountMatches (순수 함수)
│   └── __tests__/
│       ├── orderId.test.ts            ← cuid + suffix 파싱
│       ├── crossCheck.test.ts         ← 금액 검증 케이스
│       ├── webhookIdempotency.test.ts ← 같은 eventId 두 번 호출
│       └── compensate.test.ts         ← cancel 실패 시 RefundJob enqueue
└── index.ts                  ← barrel

src/shared/lib/toss/
├── client.ts                 ← Toss API HTTP client (fetch + auth header + timeout + retry)
├── signature.ts              ← verifyTossSignature (HMAC)
├── types.ts                  ← Toss API DTO
└── __tests__/
    └── signature.test.ts

src/app/api/payments/
├── confirm/route.ts          ← POST handler → confirmPayment
└── webhook/toss/route.ts     ← POST handler → handleTossWebhook
```

### 6.2 의존성 방향 (R1 준수)

```
app/api/payments/**  →  entities/payment  →  entities/booking  →  entities/departure(간접, Booking include)
                              ↓
                       shared/lib/toss/*
                       shared/lib/db, shared/lib/logger, shared/lib/env
```

- `entities/payment`가 `entities/booking`을 import — booking이 더 코어 도메인이므로 OK.
- `entities/booking`은 `entities/payment`를 import하지 않음 — booking은 결제 무지.
- Toss SDK는 **서버 전용 client만**. 클라이언트 SDK는 M-CHECKOUT의 `features/checkout`(`'use client'`)에서만 사용.

### 6.3 barrel 공개 API

```ts
// src/entities/payment/index.ts
export {
  ConfirmPaymentRequestSchema,
  TossWebhookEventSchema,
} from "./model/schemas";
export type {
  ConfirmPaymentRequest,
  TossConfirmResponse,
  TossWebhookEvent,
} from "./model/types";

export { confirmPayment } from "./api/confirm";
export { handleTossWebhook } from "./api/webhook";
export { refundBooking } from "./api/refund";

export {
  PaymentError,
  InvalidSignatureError,
} from "./api/errors";
```

- 내부 헬퍼(`compensateCancel`, `buildOrderId`, `parseBookingIdFromOrderId`, `assertAmountMatches`)는 export하지 않음.
- 단, `buildOrderId`는 M-CHECKOUT의 결제창 호출 직전 사용해야 하므로 **export 필요** → barrel에 추가.

### 6.4 R3 (레이어 책임) 준수
- `entities/payment/model/`: Zod 스키마·타입·상수만. 비즈니스 로직 0.
- `entities/payment/api/`: Prisma + Toss client 호출. `'use client'` 금지.
- `entities/payment/ui/`: **본 spec에서 생성 안 함**(영수증 UI 등은 M-CHECKOUT에서).
- `app/api/payments/**`: 라우팅 + 인증 + 입력 검증 + 에러 매핑만. 비즈니스 로직은 `entities/payment` 호출.

### 6.5 Architect 자가 점검

| R# | 항목 | 적용 |
|----|-----|------|
| R1 | 단방향 의존성 | `entities/payment → entities/booking` OK, 역방향 없음 |
| R2 | barrel 공개 API | 모든 외부 import는 `@/entities/payment` 경유 |
| R3 | 레이어 책임 | model=스키마/타입, api=Prisma/외부 IO, ui 없음 |
| R4 | 클라이언트 경계 | 본 spec 산출물에 `'use client'` 0건 |
| R5 | 슬라이스 구조 | model/api/__tests__ + barrel — 표준 구조 |
| R6 | 절대 import | `@/...` 일관 |
| R7 | 신규 slice 체크 | `payment`는 entity 레이어, barrel 동시 생성, 의존 하위 레이어만 |

---

## 7. 환경 변수

`src/shared/lib/env.ts`에 이미 정의되어 있는 항목 활용 + 1개 추가:

| 변수 | 본 spec에서의 용도 | 기존 여부 |
|------|--------------------|----------|
| `TOSS_CLIENT_KEY` | 클라이언트 SDK용(M-CHECKOUT) | ✅ (optional → required로 승격 권장) |
| `TOSS_SECRET_KEY` | 서버 API 인증 Basic auth용 | ✅ (optional → required) |
| `TOSS_WEBHOOK_SECRET` | 웹훅 서명 검증 키 | ✅ (optional → required) |
| `TOSS_API_BASE_URL` | Toss API base URL (sandbox vs prod 분기) | ❌ **추가 필요** — `https://api.tosspayments.com` default |
| `NEXT_PUBLIC_APP_URL` | successUrl/failUrl 조합 | ✅ |

본 spec에서 production 진입 시 위 3개를 production-only required로 검증 (env.ts에 `z.refine` 추가).

---

## 8. 테스트 전략

| 대상 | 종류 | 위치 | 우선순위 |
|------|------|------|---------|
| `assertAmountMatches` 금액 검증 (3중) | 단위 | `entities/payment/api/__tests__/crossCheck.test.ts` | TDD 필수 |
| `buildOrderId`/`parseBookingIdFromOrderId` 라운드트립 | 단위 | `orderId.test.ts` | TDD 필수 |
| `verifyTossSignature` HMAC 검증 | 단위 | `shared/lib/toss/__tests__/signature.test.ts` | TDD 필수 |
| `ConfirmPaymentRequestSchema` zod | 단위 | `model/__tests__/schemas.test.ts` | TDD 필수 |
| `TossWebhookEventSchema` zod | 단위 | 동일 | TDD 필수 |
| 웹훅 멱등성 (같은 eventId × 2회) | 통합(DB+mock toss) | `__tests__/webhookIdempotency.test.ts` | M2 종료 전 필수 |
| `compensateCancel` — cancel 실패 시 RefundJob enqueue | 통합 | `compensate.test.ts` | M2 종료 전 필수 |
| confirm-API end-to-end (HTTP) | E2E (mock toss server) | `app/api/payments/__tests__/confirm.e2e.ts` | 권장 |
| 동시 confirm (같은 paymentKey × 2회) | 통합 | 별도 | 권장 |

**TDD 순서**: 순수 함수(crossCheck, orderId, signature) → zod 스키마 → 통합 테스트.

---

## 9. 보안 체크리스트 (Backend Expert + Booking 합동)

| 항목 | 조치 |
|------|------|
| 결제 승인 API 인증 | `auth()` 세션 필수 + `booking.userId === session.user.id` 강제 |
| 금액 변조 (사용자 → confirm-API) | Phase 1 1차 검증 — `request.amount === booking.totalPrice` |
| 금액 변조 (위조 PG 응답) | Phase 3a 2차 검증 — `pg.totalAmount === payment.amount`. 불일치 시 보상 cancel |
| 이중 결제 (한 booking에 2회 PAID) | Postgres partial unique index `payment_one_paid_per_booking` |
| 이중 환불 | RefundJob `paymentId` + `status IN (PENDING,IN_PROGRESS,SUCCEEDED)` 단일행 검사 |
| 웹훅 위조 | `verifyTossSignature` 필수, 실패 시 401 |
| 웹훅 재전송 | `PaymentEvent.providerEventId UNIQUE` |
| PII (영수증 URL 등) | DB 저장만, 응답에 미노출 — 사용자 본인 조회 시에만 |
| Toss secret 노출 | 서버 환경변수만, `NEXT_PUBLIC_` 절대 금지(✅ env.ts에서 분리됨) |
| Edge runtime 사용 금지 | 웹훅·confirm 라우트 모두 `runtime = "nodejs"` 명시 (Prisma) |
| 클라이언트 db import 금지 | confirm/webhook 모두 Route Handler — RSC만, `'use client'` 0 |

---

## 10. 관측 가능성 (Booking R8)

모든 결제·환불 이벤트는 `PaymentEvent` + 구조화 로그 양쪽에 기록.

```ts
// shared/lib/logger.ts 사용
logger.info({  kind: "payment.confirm.started", bookingId, orderId });
logger.info({  kind: "payment.confirm.succeeded", bookingId, paymentKey });
logger.warn({  kind: "payment.confirm.failed", bookingId, code });
logger.error({ kind: "payment.compensate.failed", bookingId, error });
logger.error({ kind: "payment.amount.mismatch", source: "pg-response" | "request", bookingId });
```

대시보드 KPI (M-OBS에서 시각화):
- 결제 성공률 (`confirm result PROCESSED / total`)
- 보상 cancel 발생 빈도 (`type=COMPENSATE_CANCEL`)
- 웹훅 멱등 hit률 (`result=SKIPPED / total`)
- RefundJob 적재 길이 (`status=PENDING count`)

---

## 11. 미결정 / 가정 / ADR 후보

- **transitionStatus tx 주입 오버로드**: 본 spec MVP는 분리. 운영 데이터로 Tx-3 실패율 1% 이상 관찰되면 ADR로 통합 검토.
- **결제 만료 시각(`paymentDueAt`)**: 본 spec에서 schema 추가, cron 구현은 admin spec.
- **재시도 backoff 정책**: `RefundJob.nextRunAt`은 30s → 5m → 30m → 2h → 6h (지수). 5회 실패 시 manual 알림.
- **booking 1건당 1 PAID Payment**: partial unique index로 강제. 변경 결제 흐름 도입 시 Phase 3.
- **가상계좌·간편결제**: Phase 3. 본 spec은 카드만 가정하지만 웹훅 핸들러는 `type` switch라 확장은 용이.
- **부분 환불**: 본 spec 비범위. `RefundJob.amount`는 항상 `payment.amount`와 동일.
- **위약금**: PAID/READY 단계에서 사용자 취소 시 위약금 차감은 비범위 — 전액 환불로 일관. Phase 3.

---

## 12. 후속 plan 구성 (예상)

`plans/2026-05-XX-payment.md`로 약 **18~22개 태스크**:

1. Prisma migration — `PaymentEvent` + `RefundJob` + `Booking.paymentDueAt` + partial unique index
2. `shared/lib/toss/types.ts` — Toss DTO
3. `shared/lib/toss/signature.ts` + 테스트 (TDD)
4. `shared/lib/toss/client.ts` — confirm/cancel 함수, fetch + Basic auth + timeout + retry
5. `entities/payment/model/schemas.ts` + 테스트 (TDD)
6. `entities/payment/model/types.ts`
7. `entities/payment/api/orderId.ts` + 테스트 (TDD)
8. `entities/payment/api/crossCheck.ts` + 테스트 (TDD)
9. `entities/payment/api/errors.ts`
10. `entities/payment/api/confirm.ts` (3-phase) + 통합 테스트
11. `entities/payment/api/webhook.ts` + 멱등성 테스트
12. `entities/payment/api/refund.ts` + 보상 테스트
13. `entities/payment/index.ts` — barrel
14. `app/api/payments/confirm/route.ts`
15. `app/api/payments/webhook/toss/route.ts`
16. `env.ts` — Toss vars production refine
17. `npm run typecheck` + `npm run test` 통과
18. (선택) sandbox 결제 시드 — confirm/webhook 시뮬레이션 스크립트
19. spec §9 보안 체크리스트 자가 점검
20. 수동 검증 체크리스트(샌드박스 결제 → confirm-API 200 → booking PAID 확인 → 환불 → CANCELED_BY_USER 확인)

---

## 13. Domain Booking 스킬 적용 매핑

| 규칙 | 본 spec 적용 |
|------|------------|
| R1 좌석 원자적 차감 | M-BOOKING이 처리. 결제 시점에 좌석은 이미 hold됨. |
| R2 좌석 hold + TTL | M-BOOKING `Booking.paymentDueAt`(본 spec에서 컬럼 추가), 만료 cron은 admin spec |
| R3 2-phase 결제 | §3.3 Phase 1/2/3 분리, 외부 IO는 DB tx 밖 |
| R4 웹훅 멱등성 | §4.3 `PaymentEvent.providerEventId UNIQUE` 사전 검사 |
| R5 상태 전이 화이트리스트 | booking 전이는 `transitionStatus` 위임 → `assertTransition` 자동 통과 |
| R6 돈은 정수 | 모든 amount는 `Int`. `pg.totalAmount === payment.amount === booking.totalPrice` |
| R7 보상 트랜잭션 | §5.4 `compensateCancel` + RefundJob 재시도 큐 |
| R8 관측 | `PaymentEvent` append-only + 구조화 로그 |
| R9 Toss 특이사항 | paymentKey 저장, orderId unique, 서명 검증, cancel cancelAmount 정수 |
| R10 테스트 | §8 — 멱등성·금액·보상·서명 모두 단위/통합 테스트 |
