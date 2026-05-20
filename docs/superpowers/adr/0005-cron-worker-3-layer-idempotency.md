# ADR-0005: Cron Worker의 3중 멱등성 패턴 — CAS Claim / Short-circuit / Silent transition

- **상태**: Accepted
- **결정일**: 2026-05-20
- **영향 범위**: `src/entities/payment/api/refundRetry.ts`, `src/app/api/cron/process-refunds/route.ts` (그리고 향후 모든 백그라운드 잡 큐)
- **관련 commit**: `bda9400`
- **관련 ADR**: [ADR-0003 Refund Saga 3-Phase](./0003-refund-saga-3-phase.md)

## Context (배경)

ADR-0003에서 환불 saga를 3-phase로 격리한 결과, PG cancel 실패 시 `RefundJob`이 PENDING으로 backoff 적재되어 cron worker가 재시도하는 self-healing 큐가 설계됐다. 그 cron worker를 실제로 구현(`/api/cron/process-refunds`)하면서 발견한 invariant는, 표면적으로 단순해 보이는 "DB에서 PENDING job 가져와 다시 호출하는" 루프가 **자기 자신을 여러 번 호출해도 안전해야** 한다는 추가 요건이었다.

구체적으로 다음 시나리오들이 자연스럽게 발생한다:

1. **다중 worker 동시 실행**: Vercel/CI cron이 *중복 트리거*되거나, 운영자가 수동으로 호출하는 사이 정규 cron이 도래하는 경우.
2. **이전 cron의 처리가 다음 cron까지 끝나지 않음**: PG 응답이 느려 다음 cron이 같은 job을 또 잡으려 함.
3. **외부 경로로 이미 해결된 환불**: 같은 booking이 webhook이나 admin 수동 작업으로 이미 처리됐는데 RefundJob만 남은 경우.
4. **부분적으로 진행된 worker**: Phase 2(PG)는 성공했는데 Phase 3(DB) 직전에 worker가 죽은 경우 → IN_PROGRESS인 채로 남음.

단순 구현(claim 없이 `for job of jobs: await retry(job)`)은 (1)에서 *같은 환불을 두 번 시도* → Toss는 HTTP 멱등성 키로 한 번만 수락하지만 우리 DB는 같은 `PaymentEvent`를 두 번 write, `transitionStatus`가 중복 호출되면 `InvalidTransitionError`로 깨진다.

## Decision (결정)

**3중 멱등성** — 각 단계가 자기 차원의 경합만 책임지고, 합쳐서 *어떤 호출 시퀀스에도 결과가 동일한* 진정한 멱등 시스템을 구성한다.

### Layer 1: Atomic CAS Claim

`db.$transaction` + `updateMany` 조건부 status 변경 — 최초 한 worker만 row 점유.

```ts
async function claimRefundJob(tx, jobId): Promise<boolean> {
  const now = new Date();
  const staleBoundary = new Date(now.getTime() - STALE_IN_PROGRESS_MS);
  const result = await tx.refundJob.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: "PENDING", nextRunAt: { lte: now } },
        { status: "IN_PROGRESS", updatedAt: { lt: staleBoundary } },
      ],
    },
    data: { status: "IN_PROGRESS" },
  });
  return result.count > 0;  // affected=1: 점유 성공 / 0: 다른 worker가 선점
}
```

- `findUnique → 검사 → update` 패턴은 *TOCTOU race*가 있어 절대 금지(CLAUDE.md §5).
- `updateMany`는 PostgreSQL row-level lock으로 직렬화 → 두 worker가 같은 row에 진입해도 **단 하나만 affected=1**.
- 부수적으로 `IN_PROGRESS + updatedAt < now-10min` 절은 stuck job의 reaper로 동작 — worker death/배포 중단으로 영구 lock된 job을 회복.

### Layer 2: Short-circuit on Pre-resolved State

claim에 성공했더라도 그 사이 다른 경로(webhook / admin reconcile / 외부 시스템)로 이미 종결됐을 수 있다 — PG 호출 전에 확인하고 정리.

```ts
// Payment가 이미 CANCELED → 외부에서 환불이 이미 일어남
if (job.payment.status === "CANCELED") {
  await db.refundJob.update({
    where: { id: jobId },
    data: { status: "SUCCEEDED", lastError: "payment already CANCELED; cleaned up" },
  });
  return { type: "skipped", reason: "payment_already_canceled" };
}

// tossPaymentKey 부재 (synthetic dev key 등) → 영원히 실패할 job, FAILED로 종료
if (!job.payment.tossPaymentKey) {
  await db.refundJob.update({
    where: { id: jobId },
    data: { status: "FAILED", lastError: "tossPaymentKey missing" },
  });
  return { type: "failed", reason: "no_toss_key" };
}
```

PG 호출 비용·외부 연결 부담을 회피하고, "이미 끝난 일"을 우리 측 DB만 정리.

### Layer 3: Silent Tolerant Transition

Phase 2(PG) + Phase 3(DB Tx) 성공 후 마지막 단계 — booking 상태 전이. 그런데 이 시점에 booking이 이미 다른 경로로 CANCELED 상태일 수 있다(예: 다른 worker가 동시에 다른 RefundJob을 처리하며 같은 booking에 도달).

```ts
try {
  await transitionStatus({
    bookingId: job.bookingId,
    to: targetStatus,
    actor: job.actor ?? "system:refund-retry",
    reason: job.reason ?? "환불 처리 완료 (재시도)",
  });
} catch (transitionErr) {
  if (!(transitionErr instanceof InvalidTransitionError)) {
    logger.error("payment.refund.retry.transition_failed", transitionErr, {...});
  }
  // booking이 이미 종료 상태 → 환불 자체는 성공이므로 silent
}
```

`InvalidTransitionError`는 *에러가 아니라 정상 동작 — 이미 끝난 booking*으로 해석하고 흡수. 진짜 에러(DB 연결 등)만 로깅·alerting.

### Outer Layer (격리): Per-job try-catch

route handler는 각 job retry를 try-catch로 감싸 한 job의 예측 못한 예외가 루프 전체를 끊지 않게 한다.

```ts
for (const job of due) {
  try {
    const result = await retryRefundJob(job.id);
    results.push(result);
  } catch (err) {
    // 격리: 다음 job 진행에 영향 0
    logger.error("cron.refund.job_unexpected_error", err, { jobId: job.id });
    results.push({ type: "error", jobId: job.id, error: String(err) });
  }
}
```

## Consequences (결과)

**얻은 것:**
- cron이 어느 주기로 돌아도(1분/10초/1초/동시 실행) 결과 동일 — 진정한 멱등 시스템
- 외부 멱등성 키(Toss `Idempotency-Key`)와 우리 측 DB-level claim이 *두 계층*에서 함께 동작 → 어느 하나가 빠져도 다른 하나가 막음
- stuck IN_PROGRESS(worker death)도 별도 reaper 잡 없이 자연스럽게 회복
- 한 job의 예외가 다른 job 진행을 막지 않음 → 큐 전체 throughput 보장

**포기한 것 / 미해결:**
- claim 성공 직후 worker가 죽으면 그 job은 `STALE_IN_PROGRESS_MS`(10분) 동안 처리 불가 — 가용성 trade-off. 줄이려면 heartbeat/lease renewal 필요(이번 단계 미구현)
- 동시 worker 수가 매우 많아지면 같은 후보 N개에 대한 claim 경합 증가 — N rps 수준에선 무시 가능, 그 이상이면 partitioning 필요

## Alternatives Considered

### 옵션 A: 별도 lock table / Redis distributed lock
- Redis SETNX 또는 별도 `RefundJobLock` 테이블
- **거부 이유**: 인프라 추가(Redis는 이미 Upstash가 있지만 cache용). DB 기반 CAS로 같은 안전성을 더 간단히 달성 가능. lock 만료/소실 처리 복잡도 추가.

### 옵션 B: SELECT FOR UPDATE + 동기 처리
- `BEGIN; SELECT * FROM refundJob WHERE id=? FOR UPDATE; ...; COMMIT;`
- **거부 이유**: 외부 PG 호출(Phase 2)이 Tx 안으로 들어가게 됨 — ADR-0003의 invariant 위반. row lock이 외부 응답시간만큼 잡혀 다른 트랜잭션 차단.

### 옵션 C: Queue 인프라(SQS/PubSub/BullMQ) 도입
- 표준 분산 큐 시스템의 visibility timeout / ack 패턴
- **거부 이유**: 추가 인프라·운영 부담. 현재 트래픽 규모에서 DB-CAS로 충분. 향후 처리량 증가 시 ADR로 supersede 평가.

### 옵션 D: claim 없이 매 cron이 PG 호출, Toss 멱등성에만 의존
- Toss `Idempotency-Key: cancel:${paymentKey}`가 동일 응답 반환
- **거부 이유**: PG 호출은 멱등이어도 *우리 측 부수 작업*(PaymentEvent insert, transitionStatus)이 중복 발생. DB-level 멱등을 우리가 책임지는 게 정공.

## Notes

### 향후 백그라운드 잡 큐에 적용할 표준 원칙

이 패턴은 환불 한정이 아닌 **모든 자가 치유 큐의 표준 origin**. 향후 다음 도메인에 같은 구조 권장:

- **이메일 발송 큐**: Resend API 호출 실패 시 backoff 재시도
- **알림 발송**: 푸시/SMS 외부 게이트웨이
- **검색 인덱싱**: pgvector embedding 재계산
- **외부 webhook fan-out**: 파트너 시스템 통지

각 도메인마다 필요한 것:

1. **Job 테이블** (status enum + `attempts` + `nextRunAt` + `lastError` + `actor` 컬럼)
2. **claim 함수**: `updateMany(WHERE id AND (PENDING+due OR IN_PROGRESS+stale))` 패턴
3. **short-circuit 분기**: 외부 시스템이 이미 처리했거나 영구 실패 조건
4. **silent transition**: 도메인의 부수 효과가 idempotent하지 않은 경우 try-catch 흡수
5. **outer try-catch**: route handler의 격리

### 모니터링 지표 후보

- `payment.refund.retry.success`, `.deferred`, `.already_canceled`, `.no_toss_key` (metrics.incr 이미 박혀 있음)
- `cron.refund.unexpected_error`: 격리된 예외 발생 — 0보다 크면 alert
- `staleness duration`: IN_PROGRESS → SUCCEEDED 전이까지의 평균 시간

### 후속 ADR 후보

- backpressure: due job 수가 임계값(예: 100건) 초과 시 처리량 제한 / alerting
- heartbeat: worker lease renewal로 stuck reaper의 10분 대기 시간 단축
