# Cron 통합 — Master Dispatcher 리팩토링 설계

> 작성일: 2026-06-04
> 상태: 설계 확정 (사용자 결정 반영)
> 관련 도메인: cron · refund-job · email-job · embedding-job · infra(vercel.json)

---

## 1. 배경 & 문제

Vercel 배포가 **cron 요금제 제한**으로 실패한다(`vercel.link` → cron usage-and-pricing 문서 확인). 현재 `vercel.json`:

```json
"crons": [
  { "path": "/api/cron/process-refunds", "schedule": "*/2 * * * *" },
  { "path": "/api/cron/embedding-job",   "schedule": "*/2 * * * *" },
  { "path": "/api/cron/email-job",       "schedule": "*/2 * * * *" }
]
```

Vercel Hobby 플랜은 **cron 최대 2개 + 1일 1회 빈도**만 허용 → 3개 × `*/2`(2분)는 개수·빈도 모두 초과 → 배포 거부.

추가 정리 포인트: **`process-refunds`만 로직이 라우트에 인라인**(~75줄)이고, email/embedding은 이미 `shared/lib/*-job/worker.ts`로 추출돼 있어 비대칭이다. `isAuthorized()` Bearer 가드는 3벌 복제돼 있다.

## 2. 목표 & 범위

### In scope
- `process-refunds` 인라인 로직을 `shared/lib/refund-job/worker.ts` 순수 워커로 추출(email/embedding 패턴 정합).
- 공통 `isCronAuthorized()` 가드 추출(3벌 복제 제거).
- 기존 3개 라우트를 **얇은 래퍼**(auth → worker 호출 → JSON)로 정리.
- 단일 **Master Dispatcher**(`app/api/cron/dispatcher/route.ts`) 신설 — 3개 워커를 `Promise.allSettled` 병렬 호출.
- `vercel.json` → **dispatcher 1개 cron, `0 0 * * *`(1일 1회)** 로 변경.

### Out of scope (YAGNI)
- 실시간 2분 주기 트리거 자체 구현 — **외부 트리거(별도 스케줄러)가 dispatcher 또는 개별 라우트를 호출**할 예정. Vercel 설정엔 daily만.
- 워커 내부 로직(백오프·CAS·멱등성) 변경 — 추출만, 동작 보존.
- 새 job 타입 추가, 동적 limit 튜닝.

### 핵심 결정 (사용자 확정)
- 기존 3개 라우트는 **얇은 래퍼로 유지**(삭제 아님) — 외부 트리거가 per-worker 개별 호출도 가능하도록 유연성 보존.
- 디스패처 실행은 **병렬(`Promise.allSettled`)** — 서버리스 타임아웃 고려 시 독립·고속 실행이 안전.

## 3. 아키텍처

### 3.1 컴포넌트 & 책임
```
src/shared/lib/refund-job/
  worker.ts        # processRefundJobBatch({limit}): Promise<RefundBatchResult> — 추출된 순수 워커
  index.ts         # barrel
  __tests__/worker.test.ts

src/shared/lib/cron/
  authorize.ts     # isCronAuthorized(req): boolean — 공통 Bearer 가드 (3벌 복제 제거)

src/app/api/cron/
  process-refunds/route.ts   # 얇은 래퍼 → processRefundJobBatch (modify: 인라인 로직 제거)
  email-job/route.ts         # 얇은 래퍼 → processEmailJobBatch (modify: isCronAuthorized로 교체)
  embedding-job/route.ts     # 얇은 래퍼 → processEmbeddingJobBatch (modify: isCronAuthorized로 교체)
  dispatcher/route.ts        # 신설 — auth → Promise.allSettled([refund, email, embedding]) → 통합 summary

vercel.json                  # crons: dispatcher 1개, "0 0 * * *"
```

### 3.2 refund 워커 추출 (핵심)
현재 `process-refunds/route.ts`에 인라인된 로직을 그대로 옮긴다:
1. `listDueRefundJobs(limit)` 조회 → 빈 결과면 early return.
2. 각 job을 `try-catch`로 **격리** 실행(`retryRefundJob(job.id)`) — 한 job 실패가 루프를 막지 않음.
3. 처리된 job의 `cancellationBatchId`를 distinct 수집 → `recomputeBatchStatus(batchId)` 호출(`.catch` 격리). [ADR-0028]
4. `{ processed, summary, results }` 반환.

워커가 `@/entities/payment`·`@/entities/departure-cancellation`를 import하는 것은 **백그라운드 워커 레이어의 명시적 FSD 예외**(email 워커→`@/entities/booking`, embedding 워커→`@/entities/product` 선례, ADR-0026/0030와 동형).

### 3.3 디스패처 실행 흐름
```
GET /api/cron/dispatcher  (Authorization: Bearer ${CRON_SECRET})
  └─ isCronAuthorized? 아니면 401
  └─ Promise.allSettled([
       processRefundJobBatch({ limit: 10 }),
       processEmailJobBatch({ limit: 10 }),
       processEmbeddingJobBatch({ limit: 5 }),
     ])
  └─ 각 settled 결과를 { worker, status: "fulfilled"|"rejected", ...value | reason } 로 정규화
  └─ 200 JSON { ranAt, workers: [...] }   // 한 워커 rejected여도 200(격리) + 해당 항목에 error
```
- **격리**: `allSettled`라 한 워커의 throw가 다른 워커·전체 응답을 죽이지 않음. 각 워커는 내부에서 이미 per-job 격리.
- limit은 기존 개별 라우트 값 보존(refund 10 / email 10 / embedding 5).

### 3.4 얇은 래퍼 라우트 (공통 형태)
```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await process<X>JobBatch({ limit: N });
    logger.info("cron.<x>.run", { ...result });
    return NextResponse.json(result);
  } catch (err) { /* 기존 500 핸들링 보존 */ }
}
```
래퍼는 외부 트리거의 per-worker 개별 호출 진입점으로 계속 살아있다.

## 4. 에러 처리
- 워커 내부: per-job try-catch 격리 + 백오프 재적재(기존 보존).
- 디스패처: `Promise.allSettled` — 워커 단위 격리, 부분 실패 시에도 200 + 실패 워커만 `status:"rejected"` 표기.
- 인증 실패: 401(공통 가드).
- 예상 밖 예외(DB 단절 등): 워커가 throw → 디스패처는 settled로 흡수, 개별 래퍼는 기존 500 유지.

## 5. 검증 전략
- **단위(TDD)**: `refund-job/worker.test.ts` — 배치 recompute·격리·auth 무관 순수 동작(기존 `process-refunds/__tests__/batch-recompute.test.ts`의 검증을 워커 대상으로 이전).
- **라우트 테스트**: email/embedding route 테스트는 thin 래퍼에도 유효(worker mock + auth) — 보존. process-refunds route 테스트는 thin 래퍼용(auth 401 + worker 위임)으로 갱신.
- **디스패처 테스트**: 3개 워커가 모두 호출되는지(mock) + 한 워커 reject 시 나머지 fulfilled 유지(allSettled 격리).
- **통합 검증**: 로컬에서 `curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/dispatcher` → 3개 워커 결과 섹션이 모두 응답에 포함됨(Mock/seed 데이터, pending job 없으면 processed:0). 401(미인증)도 확인.
- `npm run typecheck` / `npm run test` / `npm run lint` 그린.
- `vercel.json` 유효성 + cron 1개·`0 0 * * *` 확인.

## 6. ADR 후보
- 후보: **단일 dispatcher + Vercel daily + 외부 트리거로 실시간성 분리** 결정. Vercel Hobby 제약 우회를 위한 차선책(workaround) 채택이며 "왜 Vercel 설정은 daily인데 실제는 2분인가"를 6개월 뒤 혼란 없이 설명할 가치가 있음. 구현 후 발행 제안.

---

## 부록 A — 디스패처 응답 스키마(예시)
```json
{
  "ranAt": "2026-06-04T03:30:00.000Z",
  "workers": [
    { "worker": "refund",    "status": "fulfilled", "processed": 0, "summary": {} },
    { "worker": "email",     "status": "fulfilled", "processed": 2, "succeeded": 2, "failed": 0, "skipped": 0 },
    { "worker": "embedding", "status": "rejected",  "error": "..." }
  ]
}
```
