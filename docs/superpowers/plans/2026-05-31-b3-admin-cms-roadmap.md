# Phase 3 B3 — Admin CMS Roadmap (Product / Itinerary + Auto-Embedding Pipeline)

> 결정 근거: 2026-05-31 brainstorming 세션 (사용자 명시 지시로 spec 단계 스킵 — plan 안에 결정사항을 박제).
> 관련 ADR: [ADR-0005] cron worker 3-layer idempotency (패턴 차용 원형), [ADR-0020] cache tag SSOT, [ADR-0022] rate limit hybrid (admin은 영향권 밖).
> ⚠️ CLAUDE.md §4.2 — 본 plan의 모든 체크박스는 미완료(`- [ ]`)로 초기화되어 있다. Task 완료 즉시 `[ ]` → `[x]`로 갱신 (§4.1).

---

## Context

**왜 이 작업인가**
- Phase 2 마지막에 AI 검색(RAG) **엔진**은 완성됨 (`done/2026-05-19-ai-search.md`, `ADR-0022`의 `ai-search` tier 박제).
- 그러나 **콘텐츠 파이프라인**이 비어 있음 — 시드 10개 상품에 의존. 운영 진입을 위해 admin이 상품을 등록·수정할 수 있어야 함.
- 신규/수정 데이터가 검색에 반영되려면 **자동 임베딩 갱신**이 필수.

**결정 사항 (brainstorming 2026-05-31)**
1. **임베딩 트리거**: 비동기 큐 (`EmbeddingJob` 신규 테이블) + cron worker. `ADR-0005` RefundJob 3-layer idempotency 차용. *거부 대안: 동기 호출(admin UX 저하 + OpenAI 장애 전파), fire-and-forget(영속화 부재 → 검색 누락 위험).*
2. **CRUD 범위**: Product 코어 필드 + ProductTag + Inclusion + ItineraryDay/Stop. Departure(좌석·가격·status)는 **별도 마일스톤**으로 분리. *이유: itinerary stop description이 RAG 임베딩의 핵심 자유 텍스트. Departure는 💳 Domain Booking · 🛑 NO-REAL-MONEY 영향권이 끼어들어와 본 작업 초점이 흐려짐.*
3. **Destination 마스터 테이블 신설 안 함** — `Product.destinationCode` 유지. 검색 인덱싱 대상이 Product뿐이고 i18n/위계 요구가 없음.

**Out of Scope (명시적 제외)**
- Departure(출발일·좌석·가격) CRUD → 별도 마일스톤
- Destination 별도 마스터 테이블
- 다국어/i18n
- 갤러리(다중 이미지) — heroImageUrl 1장만
- 실시간 임베딩 대시보드(SSE/polling) — admin 페이지는 RSC 단순 리스트
- AI 자동 요약(`Product.aiSummary`) 자동 생성 — 본 작업에서는 수동 입력만, 자동 생성은 후속

---

## 🏗️ Core Architecture

### 1. 3-Layer Idempotency for Embedding Refresh

```
[Server Action: createProductAction / updateProductAction / publishProductAction]
       │
       │  $transaction (atomicity)
       │  ├─ Product / ItineraryDay / ItineraryStop / Tag / Inclusion upsert
       │  └─ EmbeddingJob enqueue (PENDING) ← 동일 트랜잭션
       │
       │  revalidateTag × 4 (PDP / list / destinations / featured)
       ▼
[DB committed] ──────────────────────────────────────────────────────────
                                                                         │
[Vercel Cron */2 * * * *]                                                │
       │ GET /api/cron/embedding-job  (CRON_SECRET 가드)                  │
       │                                                                 │
       ▼                                                                 │
[worker.processBatch(N=5)]                                               │
       │ updateMany(status=PENDING → IN_PROGRESS, version++)             │ ← Layer 1: 원자적 점유
       │                                                                 │
       ▼                                                                 │
[contentHash 비교]                                                       │
       │ buildEmbeddingText(product) → sha256 → 현재 ProductEmbedding과 비교│ ← Layer 2: 입력 멱등성
       │  ├─ 동일 → OpenAI skip + SUCCEEDED                              │
       │  └─ 변경 → OpenAI 호출 → upsert ProductEmbedding + SUCCEEDED    │
       │                                                                 │
       │ on failure: FAILED + attempts++ + nextRunAt = now + backoff     │ ← Layer 3: 재시도
       ▼
[Search 결과 반영]
```

### 2. Cache Invalidation (ADR-0020 SSOT 준수)

Product CRUD Server Action마다 4개 태그 발신:
- `tagProductDetail(productId)` — PDP + 비교(`/compare`)
- `TAG_PRODUCTS_LIST` — 목록·검색
- `TAG_DESTINATIONS_LIST` — 행선지 페이지
- `TAG_PRODUCTS_FEATURED` — 홈 hero

> 현재 0건 발신 상태였던 신규 태그 3종(`TAG_PRODUCTS_LIST`/`TAG_DESTINATIONS_LIST`/`TAG_PRODUCTS_FEATURED`)의 **첫 발신처가 됨** — ADR-0020 Notes에서 예고된 wiring 해소.

### 3. Belt-and-Suspenders Auth Guard

| Layer | 위치 | 역할 |
|---|---|---|
| 1차 | `middleware.ts` | `/admin/*` ADMIN role baseline (기존) |
| 2차 | `(admin)/admin/layout.tsx` | `session.user.role !== "ADMIN"` redirect (기존) |
| 3차 | 각 Server Action 진입 | `auth() + role` 가드 (`adminCancelBookingAction` 패턴) |

### 4. CSP / Rate Limit 영향 분석
- CSP(ADR-0025): `/admin` 은 이미 dynamic prefix에 포함 → nonce + strict-dynamic 유지. 추가 작업 없음.
- Rate Limit(ADR-0022): admin은 인증된 신뢰 사용자 → 새 tier 신설 안 함. `global` baseline만 적용. AI 검색 tier는 일반 사용자용.

---

## Tech Stack

- Prisma 5: `EmbeddingJob` 신규 모델, `ProductEmbedding.contentHash String?` 컬럼 추가
- Zod 3: `productInputSchema`(Server Action 입력), worker 페이로드 schema
- React 19 / Next 15 App Router: `useActionState` + `useFormStatus` admin form
- Vitest 2 — 핵심 비즈니스 로직(buildEmbeddingText / enqueue / worker / actions) TDD
- Cron — 기존 Vercel Cron 인프라 재사용

---

## Files Map

| 종류 | 경로 | 책임 |
|---|---|---|
| 수정 | `prisma/schema.prisma` | `EmbeddingJob` 모델 + `ProductEmbedding.contentHash` |
| 신규 | `prisma/migrations/<ts>_embedding_job/migration.sql` | DDL + 인덱스 |
| 신규 | `src/entities/product/api/buildEmbeddingText.ts` | 임베딩 입력 텍스트 + contentHash (TDD) |
| 신규 | `src/shared/lib/embedding-job/types.ts` | Status enum, payload schema |
| 신규 | `src/shared/lib/embedding-job/enqueue.ts` | `enqueueProductEmbeddingJob(tx, productId, actor)` SSOT |
| 신규 | `src/shared/lib/embedding-job/worker.ts` | 픽업·처리·재시도 |
| 신규 | `src/app/api/cron/embedding-job/route.ts` | Vercel Cron 엔트리 |
| 신규 | `src/features/admin-product/model/schema.ts` | `productInputSchema` (Zod) |
| 신규 | `src/features/admin-product/server/actions.ts` | create/update/publish/archive |
| 신규 | `src/features/admin-product/server/uploadHero.ts` | Supabase Storage signed upload |
| 신규 | `src/features/admin-product/ui/ProductForm.tsx` | 신규/편집 통합 폼 |
| 신규 | `src/features/admin-product/ui/ItineraryEditor.tsx` | day×stop 중첩 폼 |
| 신규 | `src/features/admin-product/index.ts` | barrel |
| 신규 | `src/app/(admin)/admin/products/page.tsx` | 목록 |
| 신규 | `src/app/(admin)/admin/products/new/page.tsx` | 신규 |
| 신규 | `src/app/(admin)/admin/products/[id]/edit/page.tsx` | 편집 |
| 신규 | `src/app/(admin)/admin/embedding-jobs/page.tsx` | Job 모니터링 + 수동 재시도 |
| 수정 | `src/app/(admin)/admin/layout.tsx` | nav에 "Products" 링크 |
| 수정 | `src/entities/product/index.ts` | 캐시 태그 SSOT JSDoc 갱신 |
| 수정 | `vercel.ts` (또는 `vercel.json`) | embedding-job cron 등록 |
| 후보 | `docs/superpowers/adr/0026-async-embedding-job-pipeline.md` | ADR (사용자 승인 시 발행) |
| 수정 | `CLAUDE.md` §8 | B3 완료 노트 + 다음 작업자 Q&A 추가 |

---

## Tasks

### Task 0 — 컨텍스트 정독 & 기존 패턴 인용

- [x] `src/app/(admin)/admin/layout.tsx` 정독 (ADMIN 가드 패턴)
- [x] `src/features/admin-booking-cancel/server/actions.ts` 정독 (admin Server Action 3-layer 가드 선례)
- [x] `scripts/backfill-embeddings.ts` 정독 (ProductEmbedding upsert SQL + ivfflat 인덱스)
- [x] `docs/superpowers/adr/0005-cron-worker-3-layer-idempotency.md` 재독
- [x] `docs/superpowers/adr/0020-cache-tag-contracts-and-force-dynamic-audit.md` 재독
- [x] 본 plan과 brainstorming 결정사항 정합 확인

### Task 1 — Prisma 스키마: EmbeddingJob + ProductEmbedding.contentHash

DoD:
- [x] `prisma/schema.prisma`에 enum `EmbeddingJobStatus { PENDING IN_PROGRESS SUCCEEDED FAILED }` 추가
- [x] `EmbeddingJob` 모델 추가:
  - 필드: `id`, `productId`, `status`(PENDING default), `attempts`(0), `lastError`(String?), `nextRunAt`(now), `actor`(String?), `contentHash`(String?), `version`(Int, 낙관적 락 보조), `createdAt`, `updatedAt`
  - 관계: `product Product @relation(...)` (`onDelete: Cascade`)
  - 인덱스: `@@index([status, nextRunAt])` (cron 픽업), `@@index([productId, status])` (멱등성 조회)
- [x] `ProductEmbedding`에 `contentHash String?` 추가
- [x] `prisma/schema.prisma` Product 모델에 `embeddingJobs EmbeddingJob[]` 역참조 추가
- [x] 마이그레이션 적용 — ⚠️ plan 작성 시 가정한 `prisma migrate dev`는 본 프로젝트에서 동작 불가 (`20260519...` 첫 migration이 partial raw SQL artifact라 shadow DB 재현 실패). 기존 프로젝트 컨벤션(`prisma db execute --file <migration.sql>` + `prisma migrate resolve --applied <name>`, `20260519/21/22...` 동일 패턴) 사용. 결과 동일 — `EmbeddingJob` 테이블 + `ProductEmbedding.contentHash` 컬럼 dev DB에 반영 + runtime smoke test PASS.
- [x] `npx prisma generate` 통과 — `✔ Generated Prisma Client (v5.22.0) to ./node_modules/@prisma/client in 209ms`
- [x] git commit: `feat(db): add EmbeddingJob model + ProductEmbedding.contentHash (B3 Task 1)` (SHA `d25a2e2`) + follow-up `docs(schema): clarify EmbeddingJob onDelete divergence from RefundJob` (SHA `92e3cbe`, code review Important 1건 + Minor 1건 해소)

### Task 2 — `buildEmbeddingText` + contentHash (TDD)

> 🔬 TDD 필수. 순수 함수(부수효과 0). Architect 페르소나의 entities 레이어 정책 준수.

DoD:
- [x] `src/entities/product/api/__tests__/buildEmbeddingText.test.ts` 작성 → **FAIL 확인 인용**
  - [x] title + summary + destination + (tag 정렬 join) + (Inclusion[INCLUDED] label·note) + (ItineraryDay→Stop description) 결합 결과 검증
  - [x] 빈 필드 견고성: tag 0건 / itinerary 0건 / inclusion 0건
  - [x] **결정론**: 동일 입력 → 동일 SHA-256 hash (Map/Set 순서 의존 0)
  - [x] 한 필드만 변경 → hash 변동
  - [x] tag 배열 순서 바뀌어도 hash 동일(내부 정렬)
- [x] `src/entities/product/api/buildEmbeddingText.ts` 구현 → **PASS 확인 인용**
- [x] export: `buildEmbeddingText(product: ProductWithRelations): { text: string; contentHash: string }`
- [x] `entities/product/index.ts` barrel 통과 export
- [x] `npm run test -- buildEmbeddingText` 결과 인용
- [x] git commit: `feat(product): embedding text builder with deterministic contentHash (B3 Task 2)`

### Task 3 — `EmbeddingJob` enqueue SSOT (TDD)

DoD:
- [x] `src/shared/lib/embedding-job/__tests__/enqueue.test.ts` 작성 → FAIL
  - [x] 동일 productId의 PENDING이 있으면 신규 생성 안 함 (멱등)
  - [x] FAILED 잔존 job은 PENDING으로 재진입 + attempts/lastError 보존
  - [x] IN_PROGRESS 중 새 변경 발생 시 새 PENDING 생성 가능 (worker가 직렬 처리)
  - [x] `tx` 인자 받아 동일 트랜잭션 내부에서 동작 (atomicity 보장)
- [x] `src/shared/lib/embedding-job/enqueue.ts` 구현
- [x] 시그니처: `enqueueProductEmbeddingJob(tx: Prisma.TransactionClient, productId: string, actor: string): Promise<void>`
- [x] PASS 인용 + commit: `feat(embedding-job): enqueue SSOT with idempotent upsert (B3 Task 3)`

### Task 4 — `EmbeddingJob` worker (TDD)

> 💳 Domain Booking 페르소나 영향 없음(돈·좌석 미관여), but 🔬 QA + ⚙️ Backend 페르소나 검토 필수.

DoD:
- [x] `src/shared/lib/embedding-job/__tests__/worker.test.ts` 작성 → FAIL
  - [x] `updateMany(status=PENDING → IN_PROGRESS, version++)` 조건부 점유 — TOCTOU 차단
  - [x] contentHash 동일 → OpenAI **호출 skip** + SUCCEEDED + ProductEmbedding.updatedAt만 갱신 (빈 호출 절약)
  - [x] contentHash 변경 → OpenAI 호출 → `INSERT ... ON CONFLICT(productId) DO UPDATE` (backfill 패턴 차용) → SUCCEEDED
  - [x] OpenAI 실패 → FAILED + lastError + attempts++ + `nextRunAt = now + 2^attempts * 60s` (지수 백오프, max 1h)
  - [x] modelVersion 불일치(ProductEmbedding row 부재 또는 다른 modelVersion) → contentHash 무관 강제 재호출
  - [x] attempts ≥ 5 → 영구 FAILED 표시 (수동 재시도만 허용)
- [x] `src/shared/lib/embedding-job/worker.ts` 구현
  - 시그니처: `processEmbeddingJobBatch(opts: { limit: number }): Promise<{ processed: number; succeeded: number; failed: number; skipped: number }>`
- [x] PASS 인용 + commit: `feat(embedding-job): worker with 3-layer idempotency + backoff (B3 Task 4)`

### Task 5 — Cron 엔드포인트 + Vercel 등록

DoD:
- [x] `src/app/api/cron/embedding-job/route.ts` 작성
  - [x] `export const dynamic = "force-dynamic"` (`ADR-0020` 안전 도메인 — cron)
  - [x] CRON_SECRET Bearer 토큰 가드 (기존 cron 패턴 차용 — `/api/cron/refund-jobs` 또는 동등)
  - [x] `processEmbeddingJobBatch({ limit: 5 })` 호출 후 JSON 반환
  - [x] structured 로거(`logger.info`)로 결과 카운트 — ADR-0021 Sentry 연동
- [x] `vercel.ts`(또는 `vercel.json`) cron 등록: `*/2 * * * *`
- [x] 수동 evidence: dev 서버 환경 의존성으로 curl 대신 route 테스트 4종 PASS로 대체 (명시)
- [x] commit: `feat(cron): embedding-job batch endpoint */2min (B3 Task 5)`

### Task 6 — admin-product Zod schema + Server Actions (TDD)

DoD:
- [x] `src/features/admin-product/model/schema.ts` — `productInputSchema`:
  - [x] title: `z.string().min(1).max(120)`
  - [x] summary: `z.string().min(1).max(2000)`
  - [x] destination: `z.string().min(1)` / destinationCode: `z.string().regex(/^[A-Z]{2}-[A-Z]{3}$/).optional()`
  - [x] durationNights: `z.coerce.number().int().min(1).max(60)` / durationDays
  - [x] basePriceAdult: `z.coerce.number().int().min(0)` (**원 단위 정수만** — Domain Booking R: float 금지)
  - [x] heroImageUrl: `z.string().url().optional()`
  - [x] status: `z.enum(["DRAFT","PUBLISHED","CLOSED"])`
  - [x] tags: `z.array(z.string().min(1)).max(20)`
  - [x] inclusions: `z.array(z.object({ kind: z.enum(["INCLUDED","EXCLUDED"]), label, note }))`
  - [x] itinerary: `z.array(z.object({ dayNumber, title, accommodation, meals, stops: z.array(...) }))`
- [x] `src/features/admin-product/server/__tests__/actions.test.ts`:
  - [x] ADMIN 아닌 사용자 → `forbidden` 에러
  - [x] Zod 실패 → field errors 반환 (`flattenError`)
  - [x] 성공 → Product + 자식 모두 nested upsert + EmbeddingJob enqueue + revalidateTag 4종 호출 (spy)
  - [x] update 시 itinerary는 deleteMany + createMany 패턴(가장 단순) — 충돌 없는지 검증
- [x] `src/features/admin-product/server/actions.ts` 구현:
  - [x] `createProductAction(prevState, formData)` — `useActionState` 시그니처
  - [x] `updateProductAction(prevState, formData)` — `productId` hidden
  - [x] `publishProductAction(productId)` — status DRAFT→PUBLISHED 전이
  - [x] `archiveProductAction(productId)` — PUBLISHED→CLOSED
  - [x] `retryEmbeddingJobAction(jobId)` — FAILED→PENDING 재진입 (enqueue SSOT가 FAILED→reset 처리, 별도 action 불필요)
- [x] PASS 인용 + commit: `feat(admin-product): server actions with embedding enqueue (B3 Task 6)`

### Task 7 — admin-product UI: ProductForm + ItineraryEditor

> 🎨 Frontend Expert: useEffect/타이머/리스너 cleanup 의무, 'use client' 페이지 직접 부착 금지.

DoD:
- [x] `src/features/admin-product/ui/ProductForm.tsx` (`'use client'`)
  - [x] `useActionState(action, initialState)` + `useFormStatus`로 제출 중 표시
  - [x] 필드별 에러 표시 — Zod `flattenError().fieldErrors`
  - [x] tags: comma-separated input → 배열 변환 (간단 UX)
  - [x] inclusions: 동적 row 추가/삭제
- [x] `src/features/admin-product/ui/ItineraryEditor.tsx` (`'use client'`)
  - [x] day 추가/삭제/순서 변경
  - [x] day 안 stop 추가/삭제/순서 변경
  - [x] FormData 직렬화 시 nested 구조를 dot-path로 인코딩 (`itinerary.0.stops.1.description` 등)
- [x] `src/features/admin-product/index.ts` barrel: `export { ProductForm }`
- [x] commit: `feat(admin-product): product + itinerary form UI (B3 Task 7)`

### Task 8 — admin 라우트 페이지

DoD:
- [x] `src/app/(admin)/admin/products/page.tsx` (RSC, `force-dynamic`):
  - [x] status 필터(`?status=DRAFT|PUBLISHED|CLOSED`), 페이지네이션, 최근 임베딩 상태 컬럼
- [x] `src/app/(admin)/admin/products/new/page.tsx`:
  - [x] `<ProductForm action={createProductAction} initial={null} />`
- [x] `src/app/(admin)/admin/products/[id]/edit/page.tsx`:
  - [x] Prisma fetch (relations: tags, inclusions, itineraryDays.stops, embedding, embeddingJobs 최근 1건)
  - [x] `<ProductForm action={updateProductAction} initial={product} />`
  - [x] 우측에 임베딩 상태 패널: 최근 Job status / contentHash / modelVersion / lastError
- [x] `src/app/(admin)/admin/layout.tsx` nav에 "Products" / "Embedding Jobs" 링크 추가
- [x] commit: `feat(admin): product CMS routes (B3 Task 8)`

### Task 9 — heroImageUrl 업로드 (Supabase Storage)

DoD:
- [x] `product-images` 버킷 존재 확인 — `photoMime.ts`의 `REVIEW_PHOTO_BUCKET = "product-images"` 및 review-upload 기존 사용으로 버킷 존재 확인됨. Service-role key 기반 signed URL이라 RLS bypass, public 버킷이라 public read 이미 적용.
- [x] `src/features/admin-product/server/uploadHero.ts`: `getHeroUploadUrl(mime)` — ADMIN role 가드 + Zod mime 검증 + `createProductHeroSignedUploadUrl(mime)` 호출 → `{ ok, signedUrl, publicUrl, path, token }` 반환. UUID 기반 경로(`product-hero/${uuid}.${ext}`)로 create/edit 모드 통합.
- [x] `ProductForm`에 파일 input → signed PUT → `publicUrl`을 `heroImageUrl` 필드에 set. 업로드 중 버튼·제출 비활성 + 에러 메시지 노출 + 업로드 완료 시 미리보기 이미지 표시.
- [x] `next.config.mjs` `remotePatterns` 확인 — `*.supabase.co/storage/v1/object/public/**` 이미 등록. 추가 작업 없음.
- [x] commit: `feat(admin-product): hero image upload via signed URL (B3 Task 9)`

### Task 10 — Embedding Jobs 모니터링 페이지

DoD:
- [x] `src/app/(admin)/admin/embedding-jobs/page.tsx`:
  - [x] 상태 필터(`?status=...`) — refund-jobs 페이지 패턴 차용. `summarizeEmbeddingJobs` + `listEmbeddingJobs` 병렬 조회.
  - [x] 컬럼: 상품명(→ edit 링크), status badge, attempts, nextRunAt, lastError(truncated + title tooltip), updatedAt.
  - [x] FAILED row에 "재시도" 버튼 — `retryEmbeddingJobAction(formData)` hidden input 패턴. `updateMany(status=FAILED)` 조건부 update로 race-free.
- [x] commit: `feat(admin): embedding-jobs monitoring + manual retry (B3 Task 10)`

### Task 11 — 캐시 태그 SSOT JSDoc 갱신 (ADR-0020)

DoD:
- [ ] `src/entities/product/index.ts` JSDoc 표의 "Writer" 칸 갱신:
  - `tagProductDetail(productId)` — 기존(admin booking cancel) + **createProductAction / updateProductAction / publishProductAction / archiveProductAction**
  - `TAG_PRODUCTS_LIST` — (0건 → admin product actions 4종)
  - `TAG_DESTINATIONS_LIST` — (0건 → 동일)
  - `TAG_PRODUCTS_FEATURED` — (0건 → 동일)
- [ ] `__tests__/cache-tags.test.ts` 갱신 — 신규 발신처 검증
- [ ] commit: `docs(product): wire admin actions to cache tag SSOT (B3 Task 11)`

### Task 12 — ADR-0026 발행 (사용자 승인 후)

> 본 plan 작성 단계에서는 후보로 박제. CLAUDE.md §6.1 정책: 사용자 명시 요청 전 임의 발행 금지.

DoD (사용자 승인 시):
- [ ] `docs/superpowers/adr/0026-async-embedding-job-pipeline.md` 작성
  - [ ] Context: B3 CMS, RAG 데이터 공급, ADR-0005 차용 배경
  - [ ] Decision: EmbeddingJob 비동기 큐 + contentHash 멱등 + cron worker (limit=5/2min)
  - [ ] Consequences: admin UX OpenAI 지연 비노출, 빈 호출 절약(contentHash), modelVersion bump 시 일괄 재인덱싱 자연스러움. 추가 인프라 1테이블 + 1엔드포인트.
  - [ ] Alternatives Considered:
    - 동기 호출 — admin UX 2~5s 지연, OpenAI 장애가 publish 자체를 막음, 트랜잭션 외부 호출 두면 부분 실패 위험 → 거부
    - After-commit fire-and-forget — 영속화 부재로 실패 시 검색에서 영구 누락, 운영 안정성 미검증 → 거부
- [ ] `docs/superpowers/adr/README.md` 인덱스에 한 줄 추가
- [ ] commit: `docs(adr): 0026 async embedding job pipeline (B3)`

### Task 13 — 종합 QA (🔬 QA Engineer 강제 발동)

DoD (모두 evidence 인용):
- [ ] `npm run typecheck` 통과 — 출력 인용
- [ ] `npm run test` 통과 — embedding-job / admin-product / buildEmbeddingText 통과 라인 인용
- [ ] `npm run lint` 통과 — 출력 인용
- [ ] 런타임 evidence (`curl` / `jq` / Prisma Studio 또는 psql):
  - [ ] ADMIN 로그인 → `/admin/products/new` → 상품 생성 → DB의 `EmbeddingJob` PENDING 1건 raw 인용
  - [ ] cron 수동 호출(curl) → 결과 JSON `{ processed: 1, succeeded: 1, ... }` 인용 + `ProductEmbedding` row 갱신 확인
  - [ ] `scripts/qa/ai-search-evidence.ts` 또는 동등 호출로 신규 상품이 검색 결과 상위에 등장하는지 확인
  - [ ] **멱등성 evidence**: 동일 상품 재저장(필드 변경 없음) → cron 실행 → `skipped: 1` 카운트 인용 (OpenAI API 호출 0회 절약)
  - [ ] **재시도 evidence**: OpenAI 키를 임시로 무효화 → FAILED 전이 → attempts/lastError 확인 → 키 복원 후 수동 재시도 → SUCCEEDED 인용
- [ ] 자동 점검 grep:
  - [ ] `grep -n "\- \[ \]" docs/superpowers/plans/2026-05-31-b3-admin-cms-roadmap.md` — 잔존 0건 확인
  - [ ] `grep -rIn "force-dynamic" src/app` — 신규 force-dynamic은 admin/cron만(의도된 dynamic, ADR-0020 준수)

### Task 14 — CLAUDE.md §8 업데이트 + plan → done/ 이동

DoD:
- [ ] CLAUDE.md §8 "Phase 1 + 2 + 3 B1/B2/**B3** 완료" 갱신 및 한 줄 노트 추가
- [ ] "다음 작업자 혼란 방지 노트"에 추가:
  - "왜 임베딩이 동기가 아닌가?" → ADR-0026 + 본 plan §Core Architecture 1
  - "contentHash 가 왜 SHA-256 인가? `updatedAt`이면?" → updatedAt은 무변동 저장에도 갱신 → 빈 호출 절약 실패
  - "Departure CMS 는 왜 없는가?" → 도메인 안전성 분리, 별도 마일스톤
- [ ] `git mv docs/superpowers/plans/2026-05-31-b3-admin-cms-roadmap.md docs/superpowers/plans/done/`
- [ ] final commit: `docs(claude-md): mark Phase 3 B3 (Admin CMS) complete`

---

## 종합 검증 체크리스트 (Task 13 별도 inventory)

- [ ] typecheck / test / lint 3종 PASS
- [ ] EmbeddingJob: PENDING → IN_PROGRESS → SUCCEEDED happy path
- [ ] EmbeddingJob: FAILED → 수동 재시도 → SUCCEEDED 복구
- [ ] contentHash 멱등: 동일 입력 OpenAI skip (worker `skipped` 카운트)
- [ ] modelVersion 불일치 시 강제 재호출
- [ ] AI 검색(`searchProducts`)이 신규 상품을 결과에 포함
- [ ] middleware → layout → action 3-layer admin 가드 evidence
- [ ] revalidateTag 4종 발신 (test spy로 검증)
- [ ] plan 파일 미체크 항목 0건 확인 (grep 결과 인용)

---

## 인수인계 노트 (다음 작업자가 흔히 헷갈리는 부분)

- **"왜 enqueue를 Server Action 트랜잭션 내부에서?"** — Product 저장 ↔ Job 영속화 atomicity. Product만 저장되고 Job이 누락되면 검색에서 영구 누락.
- **"왜 contentHash인가? updatedAt이면 안 되나?"** — updatedAt은 무변동 저장에도 갱신됨. 빈 OpenAI 호출 절약 위해 입력 텍스트 SHA-256 비교. modelVersion bump 시 hash 무관 강제 재호출(worker 분기).
- **"왜 Departure는 빼는가?"** — 도메인 안전성(좌석·결제·🛑 NO-REAL-MONEY)이 끼어들어와 본 작업(RAG 데이터 공급) 초점이 흐려짐. 별도 마일스톤 + 💳 Domain Booking 페르소나 강제 참여 필요.
- **"Destination 별도 테이블은?"** — 현재 검색 인덱싱 대상이 Product뿐이고 `destinationCode` 인덱스로 충분. i18n/위계 요구 도입 시 재논의.
- **"Vercel Cron 없는 환경(Docker/bare metal)에선?"** — CRON_SECRET 가드된 엔드포인트라 외부 cron(GitHub Actions, systemd timer 등)도 동일하게 호출 가능. ADR-0024 Vercel-runtime 분기 패턴과 양립.
- **"왜 admin 페이지는 RSC + force-dynamic인가? ISR 안 됨?"** — ADR-0020 안전 도메인(admin) 분류. 운영 즉시성 + 권한 가드가 ISR 캐시-사용자 미스매치보다 우선.
- **"임베딩 텍스트 빌더가 왜 entities 레이어인가?"** — Architect: 도메인 모듈(Product)에 속한 순수 함수. shared로 끌어내면 의존성 역전.
- **"publishProductAction/archiveProductAction의 status 검사는 race 안전한가?"** — 현재는 `findUnique → status check → product.update` 패턴이라 동시 publish/archive 클릭 시 이론적 TOCTOU 존재. admin-only + 단일 사용자 클릭 빈도라 risk 낮아 1차 마일스톤에서는 그대로 유지. 강화 시 `updateMany({ where: { id, status: "DRAFT" }, data: { status: "PUBLISHED" }})` + `count===0` 분기로 race-free 전환. Task 13 종합 QA 또는 별도 follow-up으로 처리 가능.
- **"ProductForm의 `day.meals as { breakfast?; lunch?; dinner? }` 캐스트는 위험하지 않나?"** — Prisma `Json` 타입은 TypeScript에서 `JsonValue`로 와이드 추론되는데, 실제 시드/도메인 컨벤션상 `meals`는 항상 위 shape이다. 정석 해결은 `entities/product/model/types.ts`의 `ProductDetail` 정의에서 `meals` 필드를 `MealsShape` 타입으로 narrow하거나, `entities/product/api/mapping.ts`에 변환 함수 추가. Task 7 외부 범위라 follow-up으로 박제. itineraryDaySchema(Zod)가 같은 shape을 enforce하므로 런타임 안전성은 이미 확보.
- **"ItineraryEditor의 `key={dayIdx}` (index-as-key)는 OK?"** — admin 저빈도 폼이라 실용적 OK. 다만 reorder 중 input 상태(커서 위치·IME 조합)가 오염될 가능성 있음. 강화 시 `crypto.randomUUID()`로 stable id 부여 후 `key={day.uid}` 패턴 적용. 사용자 reorder 빈도가 낮으면 그대로 둬도 무방.
