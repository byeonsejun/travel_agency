# ADR-0026: 임베딩 파이프라인 — 비동기 EmbeddingJob 큐 + contentHash 멱등 + Cron Worker

- **상태**: Accepted
- **결정일**: 2026-06-01
- **영향 범위**: `src/shared/lib/embedding-job/`, `src/entities/product/api/buildEmbeddingText.ts`, `src/features/admin-product/server/actions.ts`, `src/app/api/cron/embedding-job/route.ts`, `prisma/schema.prisma`
- **관련 commit**: `d25a2e2` (EmbeddingJob 스키마), `835d228` (enqueue SSOT), `7cc25a5` (worker 3-layer), `6b6d4f7` (cron 엔드포인트), `fac4e50` (Server Actions wiring)

## Context (배경)

Phase 2에서 RAG 검색 엔진(`searchProductsByVector`)이 완성됐으나, 콘텐츠 파이프라인이 시드 10개 상품에만 의존하고 있었다. B3 Admin CMS에서 관리자가 상품을 등록·수정할 수 있게 되면, 변경된 내용이 검색 인덱스(`ProductEmbedding`)에 자동 반영되어야 한다.

임베딩 생성에는 OpenAI API 호출(평균 1~3초)이 필요하다. 이 호출을 admin Server Action의 트랜잭션 내부에서 동기적으로 실행하면 세 가지 문제가 발생한다:

1. **admin UX 지연**: 상품 저장마다 2~5초 대기 강제
2. **장애 전파**: OpenAI API 장애 시 상품 저장 자체가 실패
3. **부분 실패 위험**: DB 트랜잭션 커밋 후 OpenAI 호출이 실패하면 저장은 됐지만 검색 누락 상태 발생

## Decision (결정)

**EmbeddingJob 비동기 큐(DB 테이블) + contentHash 멱등 + Cron Worker 2분 배치** 방식을 채택.

```ts
// Server Action (product save) — 동일 $transaction 내 원자적 enqueue
await db.$transaction(async (tx) => {
  await tx.product.upsert(/* ... */);
  await enqueueProductEmbeddingJob(tx, productId, actor); // SSOT
});

// Cron worker (*/2 * * * *) — 3-layer idempotency
const owned = await db.embeddingJob.updateMany({
  where: { status: "PENDING", nextRunAt: { lte: now } },
  data: { status: "IN_PROGRESS", version: { increment: 1 } },
  take: 5,
});
// Layer 2: contentHash 비교 → 동일하면 OpenAI 호출 skip
// Layer 3: 실패 시 지수 백오프 (2^attempts × 60s, max 1h)
```

핵심 설계 결정 4가지:

1. **Product 저장 ↔ Job 영속화 atomicity**: 동일 `$transaction` 내에서 enqueue하여 "저장은 됐지만 검색 누락" 상태를 원천 차단
2. **contentHash 멱등**: 입력 텍스트 SHA-256으로 변동 여부 판별 — 필드 변경 없이 재저장 시 OpenAI 호출 0건 절약
3. **CAS Claim(ADR-0005 차용)**: `updateMany(status=PENDING → IN_PROGRESS)` 단일 쿼리로 worker 간 TOCTOU 원천 차단
4. **attempts ≥ 5 영구 FAILED**: 무한 재시도 폭풍 차단, admin 수동 재시도(`retryEmbeddingJobAction`)로 복구

## Consequences (결과)

**얻은 것:**
- admin 상품 저장 응답 시간에서 OpenAI 지연(1~3s) 완전 제거
- OpenAI 장애가 상품 저장 실패로 전파되지 않음
- contentHash 비교로 불필요한 OpenAI 호출 절약(무변동 재저장 시 `skipped: 1`)
- modelVersion bump 시 hash 무관 강제 재호출로 일괄 재인덱싱 자연스럽게 처리
- admin-only 모니터링 페이지(`/admin/embedding-jobs`)에서 Job 상태 실시간 확인 + 수동 재시도

**포기한 것 / 미해결:**
- 상품 저장 후 검색 반영까지 최대 2분 지연(Cron 주기) — 즉시성 보장 불가
- 추가 인프라: `EmbeddingJob` DB 테이블 + Cron 엔드포인트 1개
- 미완료 Job의 storage path cleanup 스크립트 부재(고아 row 주기적 정리 미구현)
- `publishProductAction` / `archiveProductAction`의 동시 클릭 TOCTOU는 admin 단일 사용자 저빈도로 1차 마일스톤에서 `findUnique → update` 패턴 그대로 유지 (follow-up으로 `updateMany` race-free 전환 가능)

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: 동기 호출 — Server Action 트랜잭션 내 OpenAI 직접 호출

- **어떤 방식**: `createProductAction` 내 `await openai.embed(text)` + `productEmbedding.upsert` 를 동일 `$transaction` 안에 포함
- **왜 거부**:
  - admin 저장마다 1~3s UI 블로킹 (저사양 네트워크 환경에서 더 악화)
  - OpenAI API 장애 = 상품 등록 불가. CMS가 AI API 가용성에 종속
  - DB 트랜잭션 시간 연장 → lock 경쟁 증가
  - **단일 DB 트랜잭션에 외부 PG 호출 포함** — CLAUDE.md §5 Domain Booking 절대 규칙 위반 패턴과 동일 (트랜잭션 롤백 시 외부 상태 되돌릴 수 없음)

### 옵션 B: After-commit fire-and-forget — 트랜잭션 커밋 후 비동기 호출

- **어떤 방식**: DB commit 후 `openai.embed(text).then(upsert).catch(log)` fire-and-forget
- **왜 거부**:
  - 영속화 부재 — 프로세스 재시작, 메모리 압박, Vercel 함수 시간 초과 시 Job 유실
  - 실패해도 재시도 불가 → 검색에서 영구 누락 가능성
  - 모니터링·재시도 UI 구축 불가

### 옵션 C: 별도 메시지 큐(Redis/SQS) — Job 브로커 도입

- **어떤 방식**: Redis Streams / AWS SQS / Upstash QStash를 Job 브로커로 사용
- **왜 거부**:
  - 추가 인프라 운영 비용 및 복잡도
  - 본 프로젝트는 Prisma + PostgreSQL을 이미 갖고 있어 "DB as Queue" 패턴이 인프라 추가 없이 동일 ACID 보장
  - admin CMS 빈도(일 수십 건)에서 Redis 큐의 처리량 이점이 없음
  - ADR-0005의 RefundJob 선례가 DB Queue 패턴의 운영 검증을 완료한 상태

## Notes

- **contentHash vs updatedAt**: `updatedAt`은 필드 변경 없이도 갱신될 수 있어 OpenAI 빈 호출이 발생. 입력 텍스트의 SHA-256이 유일한 진실의 원천.
- **Departure CMS 제외**: Departure(좌석·가격·status)는 💳 Domain Booking 도메인과 🛑 NO-REAL-MONEY 정책이 끼어있어 별도 마일스톤으로 분리.
- **Cron 환경 이식성**: `CRON_SECRET` Bearer 가드 엔드포인트이므로 Vercel 외 환경(Docker, GitHub Actions timer)에서도 동일하게 호출 가능 — ADR-0024 Vercel 분기 패턴과 양립.
- **2분 주기 근거**: 스키마 변경이나 대량 임베딩 갱신 시 배치당 limit=5 × 2분 = 시간당 최대 150건 처리. admin 등록 빈도(일 수십 건)에 충분하며, Vercel Cron 최소 단위가 1분임을 감안해 2분 선택.
