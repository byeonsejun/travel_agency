# 2026-05-24 — Toss Webhook v2024-06-01 (v2) 마이그레이션

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`. 각 Task 의 모든 `- [ ]` 는 구현·검증 직후 그 자리에서 `- [x]` 로 갱신 (CLAUDE.md §4.1).

**Goal:** 토스 webhook v2(`eventType` + `data.*` 중첩 포맷)로 schema·dispatch·멱등 키를 마이그레이션해, dev 임시 우회로 인한 ZodError 500 을 정상 200 응답으로 전환한다.

**Architecture:** 최소 범위 1차 마이그레이션 — `PAYMENT_STATUS_CHANGED` 이벤트의 `data.status === "DONE"` 만 Payment PAID 전이 처리. 그 외 status·event type 은 `IGNORED` no-op (다음 plan). 멱등 키를 `event.eventId`(v1 부재) → 헤더 `Tosspayments-Webhook-Transmission-Id` 로 전환. Verification(서명) 은 본 plan 범위 외 — dev signature skip 분기는 그대로 유지하고 별도 plan 에서 정착.

**Tech Stack:** Zod 3 discriminated union, Prisma `$transaction`, 기존 `transitionStatus` / `recordEvent` 재사용.

**참조:** 토스 공식 가이드 https://docs.tosspayments.com/guides/webhook (Version 2)

---

## Context

- 2026-05-24 dev e2e 검증으로 `/api/payments/webhook/toss` 가 토스 v2 페이로드를 받자 `TossWebhookEventSchema.parse(json)` 에서 ZodError 500 (commit `a1b425d` 의 로깅으로 확정). top-level 필드 mismatch:
  | v1 (현 코드) | v2 (토스 실 발송) |
  |---|---|
  | `eventId` | (없음 — 헤더 transmission-id 가 대체) |
  | `orderId` | `data.orderId` |
  | `type: "PAYMENT_DONE"` | `eventType: "PAYMENT_STATUS_CHANGED"` + `data.status: "DONE"` |
  | `totalAmount` | `data.totalAmount` |
  | `paymentKey` | `data.paymentKey` |
  | `approvedAt` | `data.approvedAt` |
  | `receipt.url` | `data.receipt.url` |
  | `canceledAt` | `data.cancels[*].canceledAt` (취소 목록) |
- v2 가이드의 eventType 목록 8종 중 본 prj 결제 도메인 핵심은 `PAYMENT_STATUS_CHANGED` 단 하나. 나머지(`DEPOSIT_CALLBACK` 가상계좌, `CANCEL_STATUS_CHANGED` 취소 별도 채널, 브랜드페이·지급대행·셀러·링크페이 4종) 는 본 prj 도메인 외 또는 후속 plan.
- 결제 메인 흐름(`/api/payments/confirm`)이 booking → PAID 를 이미 정상 처리 중(`orderId cmpijy19p0002gfkxiqsxwz9r__1 → status: PAID` 확인). webhook 은 backup 멱등 채널이라 본 마이그레이션은 *블로커 해소*가 아닌 *안정성 강화*.
- v1 의 `PAYMENT_DONE / PAYMENT_CONFIRMED / PAYMENT_FAILED / PAYMENT_ABORTED / PAYMENT_CANCELED` 5분기 중, v2 의 단일 `PAYMENT_STATUS_CHANGED` 에서 `data.status` 로 매핑하면 동등 표현 가능. 1차는 PAID 만, 나머지는 별도 plan.
- 가이드 §4 — **10초 SLA**: dispatch + 단일 Tx 합쳐 1초 미만이 목표 (현재 dev measurement 16ms — 여유 충분).
- 가이드 §1 — verification(서명) 절차가 본 페이지에 명시 안 됨. body 의 `data.secret` 또는 토스 결제 조회 API 검증 가능성. **본 plan 은 verification 미포함** — dev signature skip 분기(commit a1b425d) 유지하고 별도 plan 에서 정착.

## Persona Activation

| 페르소나 | 발동 사유 |
|---|---|
| 🏛️ Architect | `TossWebhookEventSchema` 신규 설계 (discriminated union), `handleTossWebhook` 시그니처 변경, FSD 단방향 유지 |
| ⚙️ Backend Expert | Zod schema, Prisma `$transaction` 보존, 멱등 키 전환, env 직접 접근 0 |
| 💳 Domain Booking | PAID 전이 정확성, idempotency 키 의미(transmission-id) 변경에 따른 중복 처리 검증, status 매핑 invariant |
| 🔬 QA Engineer | 신포맷 테스트 픽스처, 기존 v1 테스트 마이그레이션, dev e2e로 200 OK 확인 |

Frontend/Review 비활성. NO-REAL-MONEY 무관 (read-only — 결제 확정은 confirm API 가 메인).

## Design Decisions

### 1. Schema 재설계 — Zod discriminated union

```ts
// model/schemas.ts (요지)
const PaymentStatusChangedData = z.object({
  paymentKey: z.string().min(1),
  orderId: z.string().min(1),
  status: z.enum([
    "READY", "IN_PROGRESS", "WAITING_FOR_DEPOSIT",
    "DONE", "CANCELED", "PARTIAL_CANCELED",
    "ABORTED", "EXPIRED",
  ]),
  totalAmount: z.number().int().nonnegative(),
  approvedAt: z.string().nullable().optional(),
  receipt: z.object({ url: z.string() }).nullable().optional(),
  failure: z.object({ code: z.string(), message: z.string() }).nullable().optional(),
  // ...기타는 .passthrough() 로 수용 (미사용 필드는 향후 확장)
}).passthrough();

export const TossWebhookV2EventSchema = z.discriminatedUnion("eventType", [
  z.object({
    eventType: z.literal("PAYMENT_STATUS_CHANGED"),
    createdAt: z.string().optional(),
    data: PaymentStatusChangedData,
  }),
  // 그 외 eventType 은 passthrough 캐치-올 (다음 plan)
]);
```

미지원 eventType 처리 옵션 두 가지:
- **(A) discriminatedUnion 만 — 미지원 시 ZodError throw → handler에서 catch → IGNORED 처리**
- **(B) catch-all object 로 미지원 type 도 schema 통과 → handler 에서 분기**

**선택: (B)** — webhook 재전송 폭주 방지(200 빠른 응답 우선). dispatch 에서 unknown eventType 만나면 `IGNORED` no-op + `PaymentEvent` 기록. 외부 시스템(토스)이 향후 새 type 추가해도 schema parse 실패로 500 떨어지지 않음 — 안정성 우선.

구현 형태:
```ts
const TossWebhookEnvelope = z.object({
  eventType: z.string().min(1),
  createdAt: z.string().optional(),
  data: z.record(z.unknown()),    // unknown 으로 받고 type별 inner parse
}).passthrough();
```

그리고 `eventType === "PAYMENT_STATUS_CHANGED"` 일 때만 `PaymentStatusChangedData.parse(envelope.data)` 로 내부 검증. 다른 type 은 검증 없이 IGNORED 기록.

### 2. Dispatch 마이그레이션 — `data.status` 기반 분기

본 plan 1차 범위:

| `eventType` | `data.status` | 동작 |
|---|---|---|
| `PAYMENT_STATUS_CHANGED` | `DONE` | Payment PAID + booking PAID 전이 (기존 PAYMENT_DONE 분기) |
| `PAYMENT_STATUS_CHANGED` | 그 외 (`READY`/`IN_PROGRESS`/`WAITING_FOR_DEPOSIT`/`CANCELED`/`PARTIAL_CANCELED`/`ABORTED`/`EXPIRED`) | `IGNORED` no-op + `PaymentEvent` 기록 (다음 plan) |
| 그 외 `eventType` (가상계좌·취소·브랜드페이 등) | * | `IGNORED` no-op + `PaymentEvent` 기록 (별도 plan) |

기존 v1 dispatch 의 `PAYMENT_FAILED` / `PAYMENT_ABORTED` / `PAYMENT_CANCELED` 분기는 v2 의 `data.status` 가 각각 `ABORTED` / `EXPIRED` / `CANCELED` 로 도착하므로 동등 매핑 가능 — 그러나 본 plan 은 PAID 만 처리, 나머지는 IGNORED 로 두고 별도 plan 에서 마이그레이션.

**Why minimal**: confirm API 가 결제 확정 메인. webhook PAID 분기만 v2 호환되면 backup 멱등 채널 회복으로 충분. 실패/취소 분기는 메인 흐름이 별도 경로(`cancelBookingAction`, refund saga)로 처리 중이라 우선순위 낮음.

### 3. 멱등 키 — `Tosspayments-Webhook-Transmission-Id` 헤더로 전환

v1 의 `event.eventId` 부재 → v2 는 헤더 `Tosspayments-Webhook-Transmission-Id` 가 발사별 유니크 id. 토스가 *동일 transmission* 재시도 시 같은 id (사용자 확인: `whtrans_a01ksat4h6cercdbfz52g67zhma` retry 1·6 동일). 따라서 멱등 키로 안전.

```ts
const idemKey = `webhook:${transmissionId}`;   // 기존 형식 호환
```

route handler 가 헤더를 추출해 `handleTossWebhook({ rawBody, signature, transmissionId })` 로 전달.

만약 transmissionId 헤더 부재 (toss 외 발신 또는 test) → 400 응답 또는 dev 한정 fallback (UUID). 보수적으로 400 — 외부 발신 검증.

### 4. 시그니처 변경 — `handleTossWebhook`

```ts
// before
handleTossWebhook({ rawBody, signature })

// after
handleTossWebhook({ rawBody, signature, transmissionId })
```

기존 호출처 1 곳 (route.ts) 만 영향.

### 5. Verification (서명) — 본 plan Out of Scope

가이드에 명시 안 됨. `data.secret` 기반 또는 토스 결제 조회 API 검증 가능성. 추측 구현은 위험. 별도 plan 으로 분리, 그 plan 에서 가이드 추가 페이지(개발자센터 > 결제 검증/보안) 확인 후 정착.

본 plan 은 dev signature skip 분기(`NODE_ENV === "development"` 한정) 그대로 유지. production 은 여전히 401 throw — 실거래 안전성 보존. 본 plan 완료 후에도 dev 만 webhook 200 OK, prod 는 verification 마이그레이션 plan 완료까지 401.

### 6. NO-REAL-MONEY 무관
- v1·v2 모두 샌드박스 키(`test_*`)로 한정. 실거래 결제·환불 흐름 무영향.

## Files Touched

| 작업 | 파일 | 종류 |
|---|---|---|
| 수정 | `src/entities/payment/model/schemas.ts` | `TossWebhookEventSchema` v2 재설계 — envelope + PaymentStatusChangedData |
| 수정 | `src/entities/payment/api/webhook.ts` | dispatch 마이그레이션 (`eventType`+`data.status` 분기), idemKey transmissionId 기반, 시그니처 변경 |
| 수정 | `src/app/api/payments/webhook/toss/route.ts` | `Tosspayments-Webhook-Transmission-Id` 헤더 추출 + handler 전달 |
| 수정 | `src/entities/payment/api/__tests__/webhook.test.ts` | 테스트 픽스처 v2 포맷으로 마이그레이션 |
| 수정 | `src/entities/payment/api/__tests__/observability-hooks.test.ts` | 동일 |

## Tasks

### Task 1 — RED: v2 schema 테스트

**Files:**
- Modify: `src/entities/payment/api/__tests__/webhook.test.ts`

- [x] **Step 1: 픽스처 헬퍼 v2 포맷으로 작성** — top-level `eventType` + `data.*` 중첩

```ts
function v2PaymentDoneEvent(overrides?: { orderId?: string; totalAmount?: number; paymentKey?: string }) {
  return {
    eventType: "PAYMENT_STATUS_CHANGED" as const,
    createdAt: "2026-05-24T01:18:13.957Z",
    data: {
      paymentKey: overrides?.paymentKey ?? "tviva20260524011743Nz442",
      orderId: overrides?.orderId ?? "order_ABC__1",
      status: "DONE" as const,
      totalAmount: overrides?.totalAmount ?? 100,
      approvedAt: "2026-05-24T01:18:13+09:00",
      receipt: { url: "https://dashboard-sandbox.tosspayments.com/receipt/..." },
    },
  };
}

function validRawBody(overrides?: Parameters<typeof v2PaymentDoneEvent>[0]) {
  return JSON.stringify(v2PaymentDoneEvent(overrides));
}

const VALID_TRANSMISSION_ID = "whtrans_test001";
```

- [x] **Step 2: `handleTossWebhook` 호출에 `transmissionId` 추가** — 기존 테스트 시그니처 전부 업데이트

```ts
await handleTossWebhook({
  rawBody: validRawBody(),
  signature: "test-sig",
  transmissionId: VALID_TRANSMISSION_ID,
});
```

- [x] **Step 3: 신규 케이스 — `IGNORED` no-op 검증 (unknown eventType / status)**

```ts
it("미지원 eventType: IGNORED no-op, schema parse 실패 없음", async () => {
  const body = JSON.stringify({
    eventType: "METHOD_UPDATED",
    data: { foo: "bar" },
  });
  await expect(
    handleTossWebhook({ rawBody: body, signature: "sig", transmissionId: "whtrans_unknown" })
  ).resolves.toBeUndefined();
  expect(mocks.db.payment.update).not.toHaveBeenCalled();
});

it("PAYMENT_STATUS_CHANGED + status=READY: IGNORED no-op (PAID 외 status)", async () => {
  const body = JSON.stringify(v2PaymentDoneEvent({ /* status override */ }));
  // ... status="READY" 로 변형해서 보냄
  // ... payment.update 호출 0 검증
});
```

- [x] **Step 4: `npx vitest run src/entities/payment/api/__tests__/webhook.test.ts`** → 실패 확인 (구 schema/dispatch 와 mismatch) — 10 fail (RED ✓)

---

### Task 2 — GREEN: v2 schema 구현

**Files:**
- Modify: `src/entities/payment/model/schemas.ts`

- [x] **Step 1: v2 envelope + PaymentStatusChangedData 정의**

```ts
// PAYMENT_STATUS_CHANGED 의 data.* 필드 (가이드 §1 표 참조).
// passthrough 로 미사용 필드 수용 — 향후 확장 시 schema 변경 없이 핸들러만 갱신.
const PaymentStatusChangedData = z.object({
  paymentKey: z.string().min(1),
  orderId: z.string().min(1),
  status: z.enum([
    "READY",
    "IN_PROGRESS",
    "WAITING_FOR_DEPOSIT",
    "DONE",
    "CANCELED",
    "PARTIAL_CANCELED",
    "ABORTED",
    "EXPIRED",
  ]),
  totalAmount: z.number().int().nonnegative(),
  approvedAt: z.string().nullable().optional(),
  receipt: z.object({ url: z.string() }).nullable().optional(),
  failure: z
    .object({ code: z.string(), message: z.string() })
    .nullable()
    .optional(),
}).passthrough();

export type TossPaymentStatusChangedData = z.infer<typeof PaymentStatusChangedData>;

// envelope — 미지원 eventType 도 schema parse 성공시키고 핸들러에서 IGNORED.
// 토스가 향후 새 type 추가해도 본 endpoint 가 500 으로 떨어지지 않게.
export const TossWebhookV2EventSchema = z
  .object({
    eventType: z.string().min(1),
    createdAt: z.string().optional(),
    data: z.record(z.unknown()),
  })
  .passthrough();

export type TossWebhookV2Event = z.infer<typeof TossWebhookV2EventSchema>;

// PAYMENT_STATUS_CHANGED 의 data 만 따로 parse 하는 helper
export function parsePaymentStatusChangedData(data: unknown): TossPaymentStatusChangedData {
  return PaymentStatusChangedData.parse(data);
}
```

- [x] **Step 2: 기존 `TossWebhookEventSchema` (v1) 는 *제거*** — `webhook.ts` 가 더 이상 사용 안 함. 호출처 grep 확인:

```bash
grep -rn "TossWebhookEventSchema\b" src/ | grep -v __tests__
# Expected: 0 (webhook.ts 마이그레이션 후)
```

남아 있으면 마이그레이션 미완료. typecheck 가 잡아낼 것.

- [x] **Step 3: type alias 정리** — `TossWebhookEvent` (v1) → `TossWebhookV2Event` 로 교체. export 도 업데이트.

---

### Task 3 — GREEN: handleTossWebhook 마이그레이션

**Files:**
- Modify: `src/entities/payment/api/webhook.ts`

- [x] **Step 1: 시그니처 변경 — `transmissionId` 인자 추가**

```ts
export async function handleTossWebhook({
  rawBody,
  signature,
  transmissionId,
}: {
  rawBody: string;
  signature: string | null;
  transmissionId: string | null;
}): Promise<void> {
  // ── 멱등 키 — transmissionId 부재 시 400 (외부 발신 검증) ─────
  if (!transmissionId) {
    metrics.incr("payment.webhook.toss.missing_transmission_id");
    throw new InvalidSignatureError("Missing Tosspayments-Webhook-Transmission-Id header");
  }

  // ── R9: 서명 검증 — v2 마이그레이션 시점에서는 dev skip 분기 그대로 ─
  //    (기존 a1b425d 의 development-only signature skip 유지)
  // ... 기존 분기 그대로 유지

  // ── 파싱: envelope ─────
  const json = JSON.parse(rawBody) as unknown;
  const envelope = TossWebhookV2EventSchema.parse(json);

  const idemKey = `webhook:${transmissionId}`;

  // ... 이하 dispatch
}
```

- [x] **Step 2: dispatch 로직 — `eventType` + `data.status` 분기**

```ts
await db.$transaction(async (tx) => {
  // (1) 중복 — transmissionId 기반
  const existing = await tx.paymentEvent.findUnique({
    where: { providerEventId: idemKey },
  });
  if (existing) {
    metrics.incr("payment.webhook.toss.duplicate");
    return;
  }

  // (2) eventType 분기 — 본 plan 은 PAYMENT_STATUS_CHANGED 만 처리
  if (envelope.eventType !== "PAYMENT_STATUS_CHANGED") {
    await tx.paymentEvent.create({
      data: {
        providerEventId: idemKey,
        type: `WEBHOOK:${envelope.eventType}`,
        payload: envelope as unknown as Prisma.InputJsonValue,
        result: "IGNORED",
        errorMessage: `Unsupported eventType: ${envelope.eventType}`,
      },
    });
    metrics.incr("payment.webhook.toss.ignored");
    return;
  }

  // (3) data 정밀 파싱
  const data = parsePaymentStatusChangedData(envelope.data);

  // (4) Payment 조회 — orderId 위치가 data.* 로 이동
  const payment = await tx.payment.findUnique({
    where: { tossOrderId: data.orderId },
    include: {
      booking: { select: { id: true, status: true, userId: true, totalPrice: true } },
    },
  });

  if (!payment) {
    await tx.paymentEvent.create({
      data: {
        providerEventId: idemKey,
        type: `WEBHOOK:${envelope.eventType}:${data.status}`,
        payload: envelope as unknown as Prisma.InputJsonValue,
        result: "IGNORED",
        errorMessage: "Unknown orderId",
      },
    });
    metrics.incr("payment.webhook.toss.ignored");
    return;
  }

  // (5) status 분기 — 본 plan 1차: DONE 만 PAID 전이, 나머지 IGNORED
  if (data.status !== "DONE") {
    await tx.paymentEvent.create({
      data: {
        providerEventId: idemKey,
        bookingId: payment.bookingId,
        paymentId: payment.id,
        type: `WEBHOOK:${envelope.eventType}:${data.status}`,
        payload: envelope as unknown as Prisma.InputJsonValue,
        result: "IGNORED",
        errorMessage: `Status ${data.status} not handled in v2 phase 1`,
      },
    });
    metrics.incr("payment.webhook.toss.ignored");
    return;
  }

  // (6) DONE 분기 — 기존 PAYMENT_DONE 로직 그대로
  if (payment.status === "PAID") {
    await tx.paymentEvent.create({
      data: {
        providerEventId: idemKey,
        bookingId: payment.bookingId,
        paymentId: payment.id,
        type: `WEBHOOK:${envelope.eventType}:DONE`,
        payload: envelope as unknown as Prisma.InputJsonValue,
        result: "SKIPPED",
      },
    });
    return;
  }

  if (data.totalAmount !== payment.amount) {
    await tx.paymentEvent.create({
      data: {
        providerEventId: idemKey,
        bookingId: payment.bookingId,
        paymentId: payment.id,
        type: `WEBHOOK:${envelope.eventType}:DONE`,
        payload: envelope as unknown as Prisma.InputJsonValue,
        result: "FAILED",
        errorMessage: "Amount mismatch",
      },
    });
    throw new PaymentError("WEBHOOK_AMOUNT_MISMATCH", {
      expected: payment.amount,
      received: data.totalAmount,
    });
  }

  await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: "PAID",
      tossPaymentKey: data.paymentKey,
      paidAt: data.approvedAt ? new Date(data.approvedAt) : new Date(),
      receiptUrl: data.receipt?.url ?? null,
    },
  });

  await tx.paymentEvent.create({
    data: {
      providerEventId: idemKey,
      bookingId: payment.bookingId,
      paymentId: payment.id,
      type: `WEBHOOK:${envelope.eventType}:DONE`,
      payload: envelope as unknown as Prisma.InputJsonValue,
      result: "PROCESSED",
    },
  });

  processedBookingId = payment.bookingId;
  metrics.incr("payment.webhook.toss.processed", { eventType: envelope.eventType, status: data.status });
});

if (processedBookingId !== null) {
  await maybeApplyBookingTransitionV2(processedBookingId, transmissionId);
}
```

- [x] **Step 3: `maybeApplyBookingTransition` 헬퍼 갱신** — v1 의 `event.type` 의존 제거. transmissionId 기반:

```ts
async function maybeApplyBookingTransitionV2(
  bookingId: string,
  transmissionId: string,
): Promise<void> {
  try {
    await transitionStatus({
      bookingId,
      to: "PAID",
      actor: `system:webhook:toss:${transmissionId}`,
      reason: `webhook PAYMENT_STATUS_CHANGED:DONE`,
    });
  } catch (err) {
    if (err instanceof InvalidTransitionError) return;
    throw err;
  }
}
```

기존 `maybeApplyBookingTransition` 는 제거(또는 v2 헬퍼로 rename).

- [x] **Step 4: `recordEvent` 헬퍼 정리** — v1 의 `event: TossWebhookEvent` 시그니처 의존 제거. payload 와 type 문자열 인자만 받도록 단순화하거나 inline.

---

### Task 4 — Route handler: 헤더 추출 + 전달

**Files:**
- Modify: `src/app/api/payments/webhook/toss/route.ts`

- [x] **Step 1: `Tosspayments-Webhook-Transmission-Id` 헤더 추출 + handler 전달**

```ts
export const POST = withObservedRoute('payments.webhook.toss', async (req: NextRequest): Promise<NextResponse> => {
  const rawBody = await req.text();
  const signature = req.headers.get('toss-signature');
  const transmissionId = req.headers.get('tosspayments-webhook-transmission-id');

  try {
    await handleTossWebhook({ rawBody, signature, transmissionId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof InvalidSignatureError) {
      return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 401 });
    }
    logger.error("payments.webhook.toss.error", err, { rawBody });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
});
```

- [x] **Step 2: 변경 외 로직 그대로 유지** — logger.error, dev signature skip 모두 그대로.

---

### Task 5 — 테스트 마이그레이션

**Files:**
- Modify: `src/entities/payment/api/__tests__/webhook.test.ts`
- Modify: `src/entities/payment/api/__tests__/observability-hooks.test.ts`

- [x] **Step 1: webhook.test.ts 의 모든 v1 픽스처 → v2 envelope+data 로 교체** (Task 1 의 helper 사용)

- [x] **Step 2: 모든 `handleTossWebhook(...)` 호출에 `transmissionId` 인자 추가** — 누락 시 typecheck 가 잡아냄

- [x] **Step 3: 시나리오 보존 — 기존 invariant 동일하게 검증** (각 시나리오 핵심만 picking)
  - null signature → InvalidSignatureError (production·test 환경, dev skip 분기는 별도 케이스)
  - 위조 서명 → InvalidSignatureError
  - 중복 transmissionId → SKIPPED (멱등성)
  - amount mismatch → PaymentError throw
  - DONE 정상 → Payment PAID + booking transition
  - Unknown orderId → IGNORED

- [x] **Step 4: 신규 시나리오 추가**
  - 미지원 eventType (`METHOD_UPDATED` 등) → schema parse 성공 + IGNORED 기록 + payment.update 0회
  - `PAYMENT_STATUS_CHANGED` + status `READY` → IGNORED (DONE 외 status 는 본 plan phase 1 범위 외)
  - transmissionId null → 400/InvalidSignatureError throw (Step 1 of Task 3 의 가드)

- [x] **Step 5: observability-hooks.test.ts 도 동일 마이그레이션** — metrics 키 `payment.webhook.toss.processed` 의 tags `{ eventType, status }` 로 변경된 점 반영

- [x] **Step 6: `npx vitest run src/entities/payment`** → 전 케이스 GREEN

---

### Task 6 — 정적 검증

- [x] **Step 1:** `npm run typecheck` → exit 0
- [x] **Step 2:** `npm run test` → 전체 GREEN, 회귀 0
- [x] **Step 3:** `npx next lint --file src/entities/payment --file src/app/api/payments/webhook` → 0 warning
- [x] **Step 4:** 잔여 v1 참조 grep:

```bash
grep -rn "PAYMENT_DONE\|PAYMENT_CONFIRMED\|PAYMENT_ABORTED\|PAYMENT_FAILED\|TossWebhookEventSchema\b" src/ | grep -v __tests__ | grep -v ".test."
# Expected: 0 (v1 식별자 잔존 없음)
```

---

### Task 7 — Dev e2e 검증

- [x] **Step 1:** `npm run dev`
- [x] **Step 2:** 토스 콘솔에서 "다시 시도" 또는 새 결제 1건 (시드 100원 QA 상품)
- [x] **Step 3:** 다음 모두 확인
  - ngrok 응답: `200 OK` (이전 500 → 200)
  - dev 터미널: `route.end status: 200` + `payment.webhook.toss.processed` event log
  - DB: 동일 booking 의 `PaymentEvent` row 추가 (`type: "WEBHOOK:PAYMENT_STATUS_CHANGED:DONE", result: "PROCESSED"`)
  - DB: booking status 이미 PAID (confirm 흐름이 먼저 처리해 SKIPPED 일 수도 있음 — 그것도 정상)
- [x] **Step 4:** 같은 webhook 재전송 (콘솔 "다시 시도") → 두 번째는 SKIPPED 응답 + DB row 추가 없음 (멱등성)
- [x] **Step 5:** ngrok 헤더에 `Tosspayments-Webhook-Transmission-Id` 확인 + dev log 의 `idemKey` 가 그것 기반인지 확인

---

### Task 8 — 완료 처리

- [x] **Step 1:** 본 plan 의 모든 `- [ ]` 를 작업 직후 `- [x]` 로 갱신
- [x] **Step 2:** PENDING_OPS.md 의 토스 webhook 항목을 `[x]` + 완료일 마킹 (200 OK 확인 시점)
- [x] **Step 3:** 보고 양식 §7.1 준수 (🏗️ / ♻️ / 🧠) + `※ recap:` 한국어 한 줄
- [x] **Step 4:** ADR-0013 후보 (v1 → v2 마이그레이션 의사결정 박제) 제안 — 옵션 A/B/C 분석 + Out of Scope 항목(verification, 그 외 eventType) 명시

---

## Verification Checklist (최종)

- [x] Schema: `TossWebhookV2EventSchema` envelope + `PaymentStatusChangedData` 분리, v1 schema 완전 제거
- [x] Dispatch: `PAYMENT_STATUS_CHANGED` + `status=DONE` 만 PAID 전이, 그 외 status·eventType 은 IGNORED no-op
- [x] 멱등: transmissionId 기반 — 동일 transmission 재시도 시 두 번째는 SKIPPED
- [x] dev e2e: ngrok 200 OK + PaymentEvent 기록 + booking PAID (이미 PAID 면 SKIPPED)
- [x] typecheck / test / lint 그린, 회귀 0건
- [x] dev signature skip 분기 (a1b425d) 그대로 유지 — verification plan 까지는 development 한정 통과 유지

## Out of Scope

- **Verification(서명) 마이그레이션** — body `data.secret` 기반 또는 토스 결제 조회 API 검증. 가이드 추가 페이지 확인 후 별도 plan. 본 plan 완료 후에도 production 은 401 throw 유지 (실거래 안전성).
- **그 외 eventType**:
  - `DEPOSIT_CALLBACK` (가상계좌 입금) — 별도 plan
  - `CANCEL_STATUS_CHANGED` (결제 취소 별도 채널) — 별도 plan
  - `METHOD_UPDATED` / `CUSTOMER_STATUS_CHANGED` (브랜드페이) — 도메인 외
  - `payout.changed` / `seller.changed` (지급대행/셀러) — 도메인 외
  - `ORDER_PAYMENT_STATUS_CHANGED` (링크페이) — 도메인 외
- **`PAYMENT_STATUS_CHANGED` + status 다른 값** (`CANCELED`, `PARTIAL_CANCELED`, `ABORTED`, `EXPIRED` 등) — 본 plan 은 PAID 만. 실패/취소 분기는 메인 흐름(`cancelBookingAction`, refund saga)이 처리 중이라 우선순위 낮음, 별도 plan.
- **dev signature skip 분기 제거** — verification plan 완료 시점.
- **`/api/payments/confirm` 변경** — 무관, 본 plan 은 webhook 만.
- **결제 흐름 자체 (booking → PAID 전이)** — 무관, confirm API 가 메인 처리 중. 본 plan 은 backup 멱등 채널 복구.
