# Toss Webhook Verification — 결제 조회 API cross-check 정착 Plan (B3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ADR-0013 의 `development` 한정 signature skip 임시 우회 분기와 미사용 HMAC 인프라를 완전히 제거하고, 토스 결제 조회 API(`GET /v1/payments/{paymentKey}`) cross-check 기반의 단일 검증 경로로 정착한다. 검증 실패 시 401 INVALID_SIGNATURE 응답을 dev/test/prod 동일하게 반환한다.

**Architecture:** ADR-0016 채택. `PAYMENT_STATUS_CHANGED` payload 가 가진 paymentKey 를 토스 서버에 직접 조회 → 응답의 orderId/totalAmount/status 가 payload 와 일치할 때만 진위 인정. 외부 IO 는 DB 트랜잭션 바깥(R3). 미사용 HMAC 헬퍼·env·테스트는 YAGNI 로 완전 제거.

**Tech Stack:** Next.js 15 (App Router), TypeScript strict, Prisma 5, Vitest 2, Zod 3. `tossClient` (fetch 기반 HTTP 클라이언트), `entities/payment/api/webhook.ts` (도메인 핸들러).

---

## File Structure

신규/수정 대상 (5종 코드 + 1종 운영 가이드):

```
src/shared/lib/toss/
  client.ts             # MODIFY: tossClient.getPayment 추가
  types.ts              # MODIFY: TossPaymentResponse 추가
  index.ts              # MODIFY: verifyTossSignature export 제거, 새 타입 export 추가
  signature.ts          # DELETE
  __tests__/
    signature.test.ts   # DELETE
    client.test.ts      # CREATE: getPayment 단위 테스트
src/shared/lib/
  env.ts                # MODIFY: TOSS_WEBHOOK_SECRET zod field + 검증 분기 제거
  __tests__/env.test.ts # MODIFY: TOSS_WEBHOOK_SECRET 관련 테스트 케이스 제거
src/shared/lib/observability/
  pii.ts                # MODIFY: /secret$/i 패턴 보존 (다른 secret 도 매칭 — 그대로 둠)
  __tests__/pii.test.ts # MODIFY: TOSS_WEBHOOK_SECRET 테스트 케이스 정리
src/entities/payment/api/
  webhook.ts            # MODIFY: HMAC 분기 제거, cross-check 도입
  __tests__/
    webhook.test.ts     # MODIFY: signature mock 제거, tossClient.getPayment mock + 시나리오 재정의
    observability-hooks.test.ts  # MODIFY: signature mock 제거, cross-check 메트릭 케이스 추가
src/app/api/health/__tests__/
  route.test.ts         # MODIFY: TOSS_WEBHOOK_SECRET 참조 제거
docs/superpowers/
  PENDING_OPS.md        # MODIFY: TOSS_WEBHOOK_SECRET 운영 가이드 라인 제거 + 후속 안내 갱신
```

---

## Task 1: tossClient.getPayment 추가 (TDD)

**Files:**
- Create: `src/shared/lib/toss/__tests__/client.test.ts`
- Modify: `src/shared/lib/toss/types.ts` — `TossPaymentResponse` 추가
- Modify: `src/shared/lib/toss/client.ts` — `getPayment` 메서드 추가
- Modify: `src/shared/lib/toss/index.ts` — `TossPaymentResponse` export 추가

- [x] **Step 1: 실패 테스트 작성 — getPayment 정상/에러 케이스**

`src/shared/lib/toss/__tests__/client.test.ts` 신규 작성:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tossClient } from "../client";
import { PaymentError } from "../errors";

describe("tossClient.getPayment", () => {
  const PAYMENT_KEY = "tpayments_test_pk_001";
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("성공: GET /v1/payments/{paymentKey} 호출 + 응답 파싱", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          paymentKey: PAYMENT_KEY,
          orderId: "order_001",
          status: "DONE",
          totalAmount: 120_000,
          approvedAt: "2026-05-26T00:00:00+09:00",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await tossClient.getPayment(PAYMENT_KEY);

    expect(result.paymentKey).toBe(PAYMENT_KEY);
    expect(result.totalAmount).toBe(120_000);
    expect(result.status).toBe("DONE");

    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toMatch(/\/v1\/payments\/tpayments_test_pk_001$/);
    expect((call[1] as RequestInit).method).toBe("GET");
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Basic /);
  });

  it("HTTP 404: PaymentError(PG_HTTP) throw — body 포함", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ code: "NOT_FOUND_PAYMENT" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(tossClient.getPayment(PAYMENT_KEY)).rejects.toMatchObject({
      code: "PG_HTTP",
      context: expect.objectContaining({ status: 404 }),
    });
  });

  it("네트워크 에러: PaymentError(PG_NETWORK_ERROR) throw", async () => {
    fetchSpy.mockRejectedValue(new Error("ECONNRESET"));

    await expect(tossClient.getPayment(PAYMENT_KEY)).rejects.toBeInstanceOf(
      PaymentError,
    );
    await expect(tossClient.getPayment(PAYMENT_KEY)).rejects.toMatchObject({
      code: "PG_NETWORK_ERROR",
    });
  });
});
```

- [x] **Step 2: 테스트 실행 → 실패 확인 (RED)**

Run: `npm test -- src/shared/lib/toss/__tests__/client.test.ts`
Expected: FAIL — `tossClient.getPayment is not a function`

- [x] **Step 3: TossPaymentResponse 타입 추가**

`src/shared/lib/toss/types.ts` 끝부분에 추가:

```ts
/**
 * Toss 결제 조회 API (`GET /v1/payments/{paymentKey}`) 응답.
 *
 * webhook cross-check 용 (ADR-0016) — payload 의 paymentKey 로 조회해
 * orderId/totalAmount/status 가 일치하는지 검증한다.
 */
export interface TossPaymentResponse {
  paymentKey: string;
  orderId: string;
  status: TossConfirmStatus;
  /** 원 단위 정수. */
  totalAmount: number;
  approvedAt?: string;
  receipt?: TossReceiptInfo;
  failure?: TossFailureInfo;
}
```

- [x] **Step 4: tossClient.getPayment 구현 (read-only, Basic auth)**

`src/shared/lib/toss/client.ts` 의 `tossRequest` 아래에 GET 전용 헬퍼 추가, `tossClient` 객체에 `getPayment` 메서드 추가:

```ts
async function tossGet<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: basicAuthHeader() },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    throw new PaymentError("PG_NETWORK_ERROR", { url, cause: String(err) });
  }

  if (!res.ok) {
    let responseBody: unknown = null;
    try {
      responseBody = await res.json();
    } catch {
      /* ignore parse error */
    }
    throw new PaymentError("PG_HTTP", { status: res.status, body: responseBody });
  }

  return res.json() as Promise<T>;
}

export const tossClient = {
  confirm({ ... }) { ... },
  cancel({ ... }) { ... },

  /**
   * GET /v1/payments/{paymentKey} — webhook cross-check 전용 (ADR-0016).
   * read-only 라 Idempotency-Key 불필요. Basic auth 만으로 호출.
   */
  getPayment(paymentKey: string): Promise<TossPaymentResponse> {
    return tossGet<TossPaymentResponse>(
      `${env.TOSS_API_BASE_URL}/v1/payments/${encodeURIComponent(paymentKey)}`,
    );
  },
};
```

`TossPaymentResponse` import 도 함께 추가.

- [x] **Step 5: index.ts 에서 새 타입 export**

`src/shared/lib/toss/index.ts` 의 type export 목록에 `TossPaymentResponse` 추가:

```ts
export type {
  TossConfirmResponse,
  TossConfirmStatus,
  TossCancelResponse,
  TossCancelStatus,
  TossCancelEntry,
  TossPaymentResponse,    // ← 추가
  TossWebhookPayload,
  TossFailureInfo,
  TossReceiptInfo,
} from "./types";
```

- [x] **Step 6: 테스트 재실행 → 통과 확인 (GREEN)**

Run: `npm test -- src/shared/lib/toss/__tests__/client.test.ts`
Expected: PASS — 3 tests

- [x] **Step 7: 커밋** — Task 2/3 통합 커밋으로 변경 (전 변경이 동일 ADR-0016 작업 단위라 분할 시 webhook handler 가 미사용 import 로 typecheck FAIL 일관성 깨짐). Task 3 Step 10 통합 커밋으로 흡수.

---

## Task 2: 미사용 HMAC 헬퍼·env·테스트 제거 (RED 단계 — 의존성 정리)

**Files:**
- Delete: `src/shared/lib/toss/signature.ts`
- Delete: `src/shared/lib/toss/__tests__/signature.test.ts`
- Modify: `src/shared/lib/toss/index.ts` — `verifyTossSignature` export 제거
- Modify: `src/shared/lib/env.ts` — `TOSS_WEBHOOK_SECRET` zod field + production required 분기 + live\_ 차단 분기 제거
- Modify: `src/shared/lib/__tests__/env.test.ts` — `TOSS_WEBHOOK_SECRET` 관련 케이스 정리
- Modify: `src/shared/lib/observability/__tests__/pii.test.ts` — TOSS_WEBHOOK_SECRET 참조 정리
- Modify: `src/app/api/health/__tests__/route.test.ts` — TOSS_WEBHOOK_SECRET 참조 제거
- Modify: `docs/superpowers/PENDING_OPS.md` — env 변수 라인 제거

- [x] **Step 1: signature.ts 와 그 테스트 삭제**

Run:
```bash
rm src/shared/lib/toss/signature.ts \
   src/shared/lib/toss/__tests__/signature.test.ts
```

- [x] **Step 2: shared/lib/toss/index.ts 에서 export 제거**

`src/shared/lib/toss/index.ts` 의 `verifyTossSignature` export 라인 삭제:

```ts
// Before
export { verifyTossSignature } from "./signature";

// After (라인 삭제)
```

- [x] **Step 3: env.ts 에서 TOSS_WEBHOOK_SECRET zod field 제거**

`src/shared/lib/env.ts`:

- `TOSS_WEBHOOK_SECRET: z.string().optional(),` 라인 삭제
- `superRefine` 의 production required 배열에서 `"TOSS_WEBHOOK_SECRET"` 제거
- `superRefine` 의 NO-REAL-MONEY live\_ 차단 배열에서 `"TOSS_WEBHOOK_SECRET"` 제거

- [x] **Step 4: env.test.ts 의 관련 케이스 제거**

`src/shared/lib/__tests__/env.test.ts` 에서 `TOSS_WEBHOOK_SECRET` 가 등장하는 테스트 케이스(2개 — live\_ 차단 + test\_ 허용) 제거. 다른 키 검증 케이스가 같은 it 블록 안에 함께 있다면, 해당 expectation 라인만 제거하고 it 블록은 보존.

- [x] **Step 5: pii.test.ts 의 케이스 정리**

`src/shared/lib/observability/__tests__/pii.test.ts` 의 36–42 라인 — `TOSS_WEBHOOK_SECRET` 마스킹 테스트가 다른 secret 마스킹 케이스와 함께 있는지 확인. 함께 있다면 해당 키만 제거하되 다른 secret 키(`AUTH_SECRET` 등) 로 redaction 검증은 보존. 단독 케이스면 it 블록 자체 제거.

- [x] **Step 6: route.test.ts 의 참조 제거**

`src/app/api/health/__tests__/route.test.ts:21` — `TOSS_WEBHOOK_SECRET: undefined as string | undefined,` 라인 제거. 그 외 mock env 필드는 보존.

- [x] **Step 7: PENDING_OPS.md 의 운영 가이드 라인 갱신**

`docs/superpowers/PENDING_OPS.md` 의 토스 webhook 등록 섹션:

- `- 환경 변수: TOSS_WEBHOOK_SECRET` 라인 제거
- 검증 설명을 ADR-0016 기준으로 갱신: "Verification 은 결제 조회 API cross-check 로 정착 (ADR-0016). 별도 webhook secret 발급 불필요."

- [x] **Step 8: typecheck 로 import 누락 확인 (RED 보조)**

Run: `npm run typecheck`
Expected: FAIL — `webhook.ts` 가 아직 `verifyTossSignature`/`env.TOSS_WEBHOOK_SECRET` 를 import 하므로 에러. **이는 Task 3 에서 해결.** 진행.

증거 (실제 출력):
```
src/entities/payment/api/webhook.ts(20,10): error TS2305: Module '"@/shared/lib/toss"' has no exported member 'verifyTossSignature'.
src/entities/payment/api/webhook.ts(81,24): error TS2339: Property 'TOSS_WEBHOOK_SECRET' does not exist on type ...
```
**부수 발견**: `scripts/qa/payment-evidence.ts` 도 `env.TOSS_WEBHOOK_SECRET` + HMAC `signBody` 사용 → cross-check 환경에 맞게 placeholder signature 로 정리.

- [x] **Step 9: 커밋은 Task 3 GREEN 이후** — Task 2 단독 커밋 금지 (typecheck FAIL 상태)

---

## Task 3: webhook handler 에 cross-check 도입 (TDD)

**Files:**
- Modify: `src/entities/payment/api/__tests__/webhook.test.ts` — signature mock 제거, tossClient mock 추가, 시나리오 재정의
- Modify: `src/entities/payment/api/webhook.ts` — HMAC 분기 제거, cross-check 도입

- [x] **Step 1: 실패 테스트 작성 — cross-check 케이스 재정의**

`src/entities/payment/api/__tests__/webhook.test.ts` 수정:

`vi.hoisted` mock 객체에서:
- `verifyTossSignature: vi.fn(),` 제거
- `env.TOSS_WEBHOOK_SECRET` 제거 (env 객체에서 키 자체 삭제)
- 새 항목 추가:
  ```ts
  tossClient: { getPayment: vi.fn() },
  ```

`vi.mock("@/shared/lib/toss", …)` 블록 교체:
```ts
vi.mock("@/shared/lib/toss", () => ({
  tossClient: mocks.tossClient,
}));
```

기존 시나리오 1, 2 ("null signature → throw", "위조 서명 → throw") 를 다음 cross-check 시나리오로 교체 (전체 변경 — 기존 테스트 함수 자체 교체):

```ts
// ── 시나리오 1: cross-check orderId 불일치 → InvalidSignatureError ──
it("cross-check orderId 불일치: InvalidSignatureError throw, DB 미접촉", async () => {
  mocks.tossClient.getPayment.mockResolvedValue({
    paymentKey: PAYMENT_KEY,
    orderId: "different_order_xyz",   // payload 와 불일치
    status: "DONE",
    totalAmount: AMOUNT,
  });

  await expect(
    handleTossWebhook({
      rawBody: v2PaymentStatusChangedBody(),
      signature: null,
      transmissionId: TRANSMISSION_ID,
    }),
  ).rejects.toBeInstanceOf(InvalidSignatureError);

  expect(mocks.db.$transaction).not.toHaveBeenCalled();
});

// ── 시나리오 2: cross-check totalAmount 불일치 → InvalidSignatureError ─
it("cross-check totalAmount 불일치: InvalidSignatureError throw, DB 미접촉", async () => {
  mocks.tossClient.getPayment.mockResolvedValue({
    paymentKey: PAYMENT_KEY,
    orderId: ORDER_ID,
    status: "DONE",
    totalAmount: AMOUNT + 1,          // payload 와 불일치
  });

  await expect(
    handleTossWebhook({
      rawBody: v2PaymentStatusChangedBody(),
      signature: null,
      transmissionId: TRANSMISSION_ID,
    }),
  ).rejects.toBeInstanceOf(InvalidSignatureError);

  expect(mocks.db.$transaction).not.toHaveBeenCalled();
});

// ── 시나리오 2b: cross-check status 불일치 → InvalidSignatureError ───
it("cross-check status 불일치: InvalidSignatureError throw, DB 미접촉", async () => {
  mocks.tossClient.getPayment.mockResolvedValue({
    paymentKey: PAYMENT_KEY,
    orderId: ORDER_ID,
    status: "READY",                  // payload(DONE) 와 불일치
    totalAmount: AMOUNT,
  });

  await expect(
    handleTossWebhook({
      rawBody: v2PaymentStatusChangedBody(),
      signature: null,
      transmissionId: TRANSMISSION_ID,
    }),
  ).rejects.toBeInstanceOf(InvalidSignatureError);

  expect(mocks.db.$transaction).not.toHaveBeenCalled();
});

// ── 시나리오 2c: cross-check 토스 API 404 → InvalidSignatureError ────
it("cross-check 토스 API 404: InvalidSignatureError throw (위조 paymentKey), DB 미접촉", async () => {
  mocks.tossClient.getPayment.mockRejectedValue(
    Object.assign(new Error("PG_HTTP"), {
      name: "PaymentError",
      code: "PG_HTTP",
      context: { status: 404 },
    }),
  );

  await expect(
    handleTossWebhook({
      rawBody: v2PaymentStatusChangedBody(),
      signature: null,
      transmissionId: TRANSMISSION_ID,
    }),
  ).rejects.toBeInstanceOf(InvalidSignatureError);

  expect(mocks.db.$transaction).not.toHaveBeenCalled();
});
```

`beforeEach` 의 `mocks.verifyTossSignature.mockReturnValue(true);` 라인 제거. 대신 다음 라인 추가 (cross-check 기본 성공):

```ts
mocks.tossClient.getPayment.mockResolvedValue({
  paymentKey: PAYMENT_KEY,
  orderId: ORDER_ID,
  status: "DONE",
  totalAmount: AMOUNT,
});
```

시나리오 3 (transmissionId null) — 그대로 보존 (signature 와 무관, transmissionId 헤더 검증).

시나리오 6 (`PAYMENT_STATUS_CHANGED DONE 성공`), 7 (금액 불일치), 8 (이미 PAID + DONE), 9 (transition swallow), 10 (미지원 eventType), 11 (status 분기 IGNORED) — 모두 기본 cross-check 성공 mock 으로 그대로 통과 필요. `signature: null` 또는 `signature: "valid_sig"` 둘 다 cross-check 와 무관.

시나리오 4, 5 (Unknown orderId IGNORED, 중복 transmissionId) — cross-check 가 통과한 다음에 dispatch 단계에서 처리되므로, 기본 cross-check 성공 mock 으로 그대로 통과 필요.

**중요한 점**: cross-check 는 envelope/data parse 통과 후 호출되므로, 미지원 eventType(시나리오 10) 의 경우 cross-check 는 호출되지 않는다 (payload 에 paymentKey 가 없을 수 있음). 시나리오 10 의 mock 설정은 그대로 두되, `getPayment` 가 호출되지 않음을 검증할 수도 있음(optional). 일단 호출 가능성만 열어 두고 검증 expectation 은 추가하지 않음.

- [x] **Step 2: 테스트 실행 → 실패 확인 (RED)** — *부수 발견*: mock 이 옛 import 를 흡수하여 시나리오 1 이 cross-check 아닌 옛 signature 분기로 통과. webhook.ts 즉시 교체로 진위 cross-check 동작 확정.

Run: `npm test -- src/entities/payment/api/__tests__/webhook.test.ts`
Expected: FAIL — webhook.ts 가 아직 cross-check 를 호출하지 않으므로 시나리오 1/2/2b/2c 가 throw 없이 통과(=실패).

- [x] **Step 3: webhook.ts 구현 — HMAC 분기 제거, cross-check 도입**

`src/entities/payment/api/webhook.ts`:

- import 변경:
  - `verifyTossSignature` import 제거
  - `env` import 제거 (TOSS_WEBHOOK_SECRET 더 이상 안 씀)
  - `tossClient` import 추가: `import { tossClient } from "@/shared/lib/toss";`

- R9 주석 블록(`// ── R9: 서명 검증 ──` 부터 `// ── 파싱:` 직전까지) 전체 삭제, 대신 cross-check 로직을 envelope/data parse 다음에 배치.

신 구조 (handleTossWebhook 본문):

```ts
export async function handleTossWebhook({
  rawBody,
  signature,         // 시그니처는 더 이상 사용하지 않지만 라우트 호환 위해 받음
  transmissionId,
}: {
  rawBody: string;
  signature: string | null;
  transmissionId: string | null;
}): Promise<void> {
  // 헤더 부재 가드 (transmission-id) — 기존 그대로
  if (!transmissionId) {
    metrics.incr("payment.webhook.toss.missing_transmission_id");
    throw new InvalidSignatureError(
      "Missing Tosspayments-Webhook-Transmission-Id header",
    );
  }

  // envelope parse
  const json = JSON.parse(rawBody) as unknown;
  const envelope = TossWebhookV2EventSchema.parse(json);

  // ── R9: 진위 검증 — 결제 조회 API cross-check (ADR-0016) ──
  // PAYMENT_STATUS_CHANGED 만 cross-check 대상. 그 외 eventType 은 dispatch
  // 에서 IGNORED no-op 처리되므로 cross-check 스킵.
  if (envelope.eventType === "PAYMENT_STATUS_CHANGED") {
    const data = PaymentStatusChangedDataSchema.parse(envelope.data);
    await crossCheckPayment(data);
  }

  // 이하 기존 멱등성/dispatch 트랜잭션 코드 그대로
  const idemKey = `webhook:${transmissionId}`;
  // ...
}
```

`crossCheckPayment` 헬퍼는 같은 파일 상단(`maybeApplyBookingTransitionV2` 위)에 정의:

```ts
async function crossCheckPayment(
  data: z.infer<typeof PaymentStatusChangedDataSchema>,
): Promise<void> {
  let fresh;
  try {
    fresh = await tossClient.getPayment(data.paymentKey);
  } catch (err) {
    // 토스 API 404/네트워크/5xx → 위조 webhook 으로 간주 (보수적 401).
    // 합법 webhook 인데 토스 OUTAGE 면 토스 재전송으로 자동 복구.
    metrics.incr("payment.webhook.toss.invalid_sig");
    throw new InvalidSignatureError(
      `Cross-check failed: tossClient.getPayment threw (${(err as Error).message})`,
    );
  }
  if (
    fresh.orderId !== data.orderId ||
    fresh.totalAmount !== data.totalAmount ||
    fresh.status !== data.status
  ) {
    metrics.incr("payment.webhook.toss.invalid_sig");
    throw new InvalidSignatureError(
      "Webhook payload mismatched Toss record (cross-check)",
    );
  }
}
```

`z` import 가 webhook.ts 에 없다면 `import { z } from "zod";` 추가. (또는 `TossPaymentStatusChangedData` 타입 import 후 사용.)

핵심 주의:
- cross-check 는 `db.$transaction` **바깥**에서 호출 (R3 — 외부 IO 를 단일 DB tx 안에 넣지 않음)
- envelope parse 다음, dispatch 트랜잭션 진입 전 위치
- IGNORED eventType(예: METHOD_UPDATED) 은 paymentKey 가 schema 에 없을 수 있으므로 cross-check 스킵

기존 코드의 dispatch 트랜잭션 내부에서 `PaymentStatusChangedDataSchema.parse(envelope.data)` 가 한 번 더 호출되는데 — 중복이지만 schema parse 는 idempotent + 가벼움. 그대로 두거나, cross-check 후 변수를 outer scope 로 끌어올려 재사용 가능. **간결성 우선 — 그대로 둠.**

- [x] **Step 4: 테스트 재실행 → 통과 확인 (GREEN)** — 14 tests PASS

Run: `npm test -- src/entities/payment/api/__tests__/webhook.test.ts`
Expected: PASS — 모든 시나리오 통과

- [x] **Step 5: observability-hooks.test.ts 정리**

`src/entities/payment/api/__tests__/observability-hooks.test.ts`:

- `verifyTossSignature` mock 제거
- `env.TOSS_WEBHOOK_SECRET` mock 필드 제거
- `tossClient: { getPayment: vi.fn() }` mock 추가, `@/shared/lib/toss` mock 의 export 교체
- `beforeEach` 에 `mocks.tossClient.getPayment.mockResolvedValue({ paymentKey: PAYMENT_KEY, orderId: ORDER_ID, status: "DONE", totalAmount: AMOUNT })` 추가 — 기본 성공
- "null signature → invalid_sig" / "위조 서명 → invalid_sig" 케이스를 다음으로 교체:

```ts
it("cross-check 불일치 → metrics.incr('payment.webhook.toss.invalid_sig')", async () => {
  mocks.tossClient.getPayment.mockResolvedValue({
    paymentKey: PAYMENT_KEY,
    orderId: "wrong_order",
    status: "DONE",
    totalAmount: AMOUNT,
  });

  await expect(
    handleTossWebhook({ rawBody: validWebhookBody(), signature: null, transmissionId: TRANSMISSION_ID })
  ).rejects.toThrow();

  expect(metrics.snapshot().counters["payment.webhook.toss.invalid_sig"]).toBe(1);
});

it("cross-check 토스 API 에러 → metrics.incr('payment.webhook.toss.invalid_sig')", async () => {
  mocks.tossClient.getPayment.mockRejectedValue(new Error("network"));

  await expect(
    handleTossWebhook({ rawBody: validWebhookBody(), signature: null, transmissionId: TRANSMISSION_ID })
  ).rejects.toThrow();

  expect(metrics.snapshot().counters["payment.webhook.toss.invalid_sig"]).toBe(1);
});
```

`transmissionId 부재 → missing_transmission_id` 케이스 그대로 보존.

`PAYMENT_STATUS_CHANGED DONE 성공` 케이스 — `signature: "sig"` 를 그대로 두되, 기본 cross-check 성공 mock 으로 통과.

- [x] **Step 6: observability-hooks.test.ts 실행 → 통과 확인** — 12 tests PASS

Run: `npm test -- src/entities/payment/api/__tests__/observability-hooks.test.ts`
Expected: PASS

- [x] **Step 7: typecheck 전체 통과 확인** — exit 0

Run: `npm run typecheck`
Expected: PASS — Task 2 의 import 누락이 Task 3 으로 해소됨

- [x] **Step 8: 전체 테스트 실행 (회귀 점검)** — 479 PASS (47 files)

Run: `npm test`
Expected: PASS — 481 + 신규 케이스 (client.getPayment 3 + cross-check 4 + obs cross-check 2 - 제거 케이스 일부) — 순증 약 5–8

- [x] **Step 9: lint 통과 확인** — pre-existing 6개 외 신규 0

Run: `npm run lint`
Expected: PASS — pre-existing 경고 외 0

- [x] **Step 10: 통합 커밋 (Task 2 + Task 3 한 번에)** — ADR/plan/code 3-way split 으로 분리 commit (관례 §6.1).

```bash
git add src/shared/lib/toss/ src/shared/lib/env.ts \
  src/shared/lib/__tests__/env.test.ts \
  src/shared/lib/observability/__tests__/pii.test.ts \
  src/app/api/health/__tests__/route.test.ts \
  src/entities/payment/api/webhook.ts \
  src/entities/payment/api/__tests__/webhook.test.ts \
  src/entities/payment/api/__tests__/observability-hooks.test.ts \
  docs/superpowers/PENDING_OPS.md
git commit -m "$(cat <<'EOF'
feat(payments): toss webhook verification — cross-check 정착 + HMAC 제거 (ADR-0016)

- tossClient.getPayment 추가 (GET /v1/payments/{paymentKey}, ADR-0016)
- webhook handler: HMAC 분기 + dev signature skip 완전 제거,
  결제 조회 API cross-check 로 진위 검증 단일화
- verifyTossSignature 헬퍼 + signature.ts + 테스트 삭제 (YAGNI)
- TOSS_WEBHOOK_SECRET env 변수 + 관련 검증 분기 제거
- PENDING_OPS 업데이트 — 별도 webhook secret 발급 불필요

dev/test/prod 모두 동일 검증 경로. 토스 OUTAGE 시 합법 webhook 도
401 → 토스 재전송(7회) 으로 자동 복구. 메인 confirm-API 가 booking
전이를 이미 처리 중이라 backup 채널 단절 허용 가능.
EOF
)"
```

---

## Task 4: 최종 회귀 검증 + 보고

- [x] **Step 1: typecheck/test/lint 종합 통과**

Run (순차):
```bash
npm run typecheck && npm test && npm run lint
```
Expected: 3 명령 모두 exit 0

증거: typecheck exit 0, test 479 PASS (47 files), lint 신규 0 (pre-existing 6 외).

- [x] **Step 2: dev signature skip 분기 잔존물 grep 검사** — code/scripts 0 hit. `done/2026-05-14-payment.md` 의 historical reference 만 잔존 (의도된 박제).

Run:
```bash
grep -rn "dev_signature_skipped\|verifyTossSignature\|TOSS_WEBHOOK_SECRET\|toss-signature" src/ docs/ 2>/dev/null
```
Expected: 0 hit (ADR 본문 인용은 별도). 잔존 라인이 있으면 Task 2/3 미정리.

- [x] **Step 3: plan 체크박스 자가 점검** — 본 plan 의 모든 Task step 체크 완료.

Run:
```bash
grep -n "\- \[ \]" docs/superpowers/plans/2026-05-26-webhook-verification.md
```
Expected: 0 hit (모든 Task 완료 후)

- [ ] **Step 4: 보고 — 7.1 양식 (🏗️ Core / ♻️ Boilerplate / 🧠 Concept)**

CLAUDE.md §7.1 형식으로 사용자에게 보고:
- 🏗️ Core: cross-check 진위 검증, 외부 IO tx 외부 배치, 멱등 키 transmission-id 보존
- ♻️ Boilerplate: tossClient.getPayment 단순 GET, env 라인 정리
- 🧠 Concept: "위조 webhook 차단을 *발신자 신뢰* 가 아닌 *발신 내용 진위* 로 검증 — payload 의 paymentKey 가 토스 서버 record 와 정확히 일치해야 통과. 위조자는 토스 서버에 등록된 정확한 paymentKey+amount+status 조합을 만들 수 없음." (1문단 비유)

---

## Self-Review Checklist

플랜 완성 후 자가 검토:

1. **ADR-0016 의 결정 4종이 모두 plan 에 task 화되었는가?**
   - ✅ getPayment 추가 → Task 1
   - ✅ cross-check 도입 → Task 3 Step 3
   - ✅ HMAC 헬퍼·env·테스트 제거 → Task 2 전체
   - ✅ dev signature skip 분기 제거 → Task 3 Step 3 (R9 블록 전체 삭제)

2. **Placeholder 없음?** — 모든 step 에 실제 코드/명령 포함됨 확인

3. **타입 일관성?** — `TossPaymentResponse`, `tossClient.getPayment`, `crossCheckPayment` 헬퍼 이름이 Task 1–3 사이에 일관됨

4. **TDD 흐름?** — Task 1 (RED→GREEN), Task 3 (RED→GREEN). Task 2 는 단독 GREEN 불가 (typecheck FAIL 의도) → Task 3 와 통합 커밋

5. **R3 (외부 IO tx 외부) 준수?** — cross-check 는 `db.$transaction` 진입 *전*에 호출

6. **모든 체크박스가 `- [ ]` 초기 상태?** — §4.2 절대 규칙 준수

---

## Execution Handoff

Plan 저장 완료: `docs/superpowers/plans/2026-05-26-webhook-verification.md`.

사용자가 즉시 실행을 지시했으므로 본 세션에서 inline 실행으로 진행 (subagent dispatch 생략).
