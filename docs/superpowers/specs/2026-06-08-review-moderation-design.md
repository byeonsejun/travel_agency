# Phase 15 — 리뷰 신고 & 모더레이션 큐 (Review Reporting & Moderation Queue)

> 작성일: 2026-06-08
> 상태: 승인됨 (brainstorming → spec)
> 도메인: review (moderation). 돈·좌석 비관여 → TOCTOU 비크리티컬.

## 1. 배경 & 목표

리뷰 시스템(Phase 4-C)은 admin 수동 모더레이션(`PUBLISHED↔HIDDEN`)까지 구현됐고,
`ReviewStatus.REPORTED` enum 값과 `REPORTED→PUBLISHED|HIDDEN` 전이는 **다음 Phase 예약**으로 보존돼 있었다.
Phase 15는 그 진입점을 채운다 — **사용자가 부적절한 리뷰를 신고**하고, **관리자가 신고 큐에서 일괄 처리**하는 닫힌 루프.

### 비목표 (Non-goals / YAGNI)
- 자동 takedown(임계치 N건 자동 숨김) — 추후 확장.
- 신고자 알림/이의제기 워크플로우.
- 신고 통계 대시보드(`entities/analytics` 편입).
- SMS/메일 신고 접수 통지.

## 2. 핵심 설계 결정 (확정)

### D1. 신고는 리뷰 노출을 바꾸지 않는다 (큐 적재 방식)
신고는 `ReviewReport` 행만 생성하고 **`Review.status`는 PUBLISHED 그대로 유지** → PDP 계속 노출.
관리자가 큐에서 보고 `숨기기(인정)` 또는 `반려` 결정.

**근거:** PDP는 `status: "PUBLISHED"`만 조회하므로 신고가 status를 `REPORTED`로 flip 하면
**단 1건의 악의적 신고가 정상 리뷰를 즉시 검열**한다(어뷰징 벡터). 큐 적재 방식은 검열 악용 0 + 감사추적 + 사유 누적.

**귀결:** `ReviewStatus.REPORTED` enum 값은 **status-flip 용도로 사용하지 않는다.** schema에 남겨두되 "미사용/예약".
과거 노트("REPORTED 진입점은 다음 Phase")를 **의도적으로 뒤집는** 결정 → **ADR 발행 대상**.
admin 큐는 status-driven 이 아니라 **report-driven**(OPEN 신고 존재 여부)으로 구동.

### D2. 로그인 필수 + 1인 1신고 (멱등 dedup)
- 로그인 사용자만 신고 가능. 비로그인 → 로그인 유도.
- `@@unique([reviewId, reporterId])` DB 제약으로 중복 차단.
- 같은 리뷰 재신고 → **에러가 아니라 멱등 성공**("이미 신고됨" 토스트). `P2002` catch 로 흡수.
- 본인 리뷰는 신고 불가(서버 거부 + UI 버튼 숨김).

### D3. 사유 enum + 신고 생명주기
- `ReportReason`: `SPAM | ABUSIVE | IRRELEVANT | PRIVACY | OTHER` + 선택적 `note`(≤500자, OTHER 시 UI 권장).
- `ReportStatus`: `OPEN → RESOLVED`(숨김 인정) | `DISMISSED`(반려).
- admin 처리 시 해당 리뷰의 OPEN 신고를 **일괄 close**. 추후 다른 사용자가 다시 신고하면 새 OPEN 행 → 큐 재진입.

## 3. 데이터 모델

```prisma
enum ReportReason { SPAM ABUSIVE IRRELEVANT PRIVACY OTHER }
enum ReportStatus { OPEN RESOLVED DISMISSED }

model ReviewReport {
  id         String       @id @default(cuid())
  reviewId   String
  reporterId String
  reason     ReportReason
  note       String?      @db.Text
  status     ReportStatus @default(OPEN)
  createdAt  DateTime     @default(now())
  resolvedAt DateTime?

  review   Review @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  reporter User   @relation(fields: [reporterId], references: [id], onDelete: Cascade)

  @@unique([reviewId, reporterId])  // 1인 1신고 (멱등 dedup)
  @@index([status, createdAt])      // admin OPEN 큐 정렬 (createdAt asc = 오래된 신고 우선)
  @@index([reviewId])               // 리뷰별 신고 조회
}
```

역관계 추가:
- `Review.reports ReviewReport[]`
- `User.reviewReports ReviewReport[]`

`Review.status`/`ReviewStatus` enum 변경 없음 (REPORTED 값 보존, 미사용).

### 마이그레이션 주의 (프로젝트 우회)
shadow DB + pgvector 충돌로 `prisma migrate dev` 직접 사용 불가.
3-step 우회: `prisma db push` → 수동 SQL(필요 시) → `prisma migrate resolve --applied`.
(`project_prisma_migration_workaround` 메모리 참조)

## 4. 백엔드 (entities/review + features)

### 4.1 entities/review/api/mutations.ts (신규)
- `createReviewReport(input): Promise<{ outcome: "created" | "duplicate" } | { outcome: "self" } | null>`
  - `null` = 리뷰 없음. `"self"` = 본인 리뷰. `"duplicate"` = 이미 신고(멱등). `"created"` = 신규.
  - `db.reviewReport.create` 시 `P2002` → `"duplicate"` 로 흡수(또는 사전 findUnique — 경합 무해).
  - 신고자 본인 여부는 `review.userId === reporterId` 비교.
- `resolveReportsByHiding(reviewId): Promise<{ productId } | null>`
  - 단일 `$transaction`: `assertReviewTransition(PUBLISHED→HIDDEN)` 가드 후 `review.update(status: HIDDEN)`
    + `reviewReport.updateMany({ reviewId, status: OPEN }, { status: RESOLVED, resolvedAt })`.
  - 이미 HIDDEN 이면 전이 가드가 throw(현재 상태에서 변경 불가) → 액션이 우아한 에러.
- `dismissReports(reviewId): Promise<{ productId } | null>`
  - `reviewReport.updateMany({ reviewId, status: OPEN }, { status: DISMISSED, resolvedAt })`. status 불변.

### 4.2 entities/review/api/queries.ts (신규/확장)
- `listReviewsWithOpenReports(opts): Promise<AdminReportedReviewListPage>`
  - OPEN 신고가 1건 이상인 리뷰 목록 + 신고 건수 + 대표 사유 분포.
  - `db.review.findMany({ where: { reports: { some: { status: OPEN } } }, ... })` + 신고 집계.
    또는 `reviewReport.groupBy` 후 hydrate. N+1 차단 위해 단일 쿼리/`_count` 활용.
  - 정렬: 가장 오래된 OPEN 신고 우선(또는 신고 건수 desc) — 구현 시 확정, createdAt 기반 안정 정렬.
  - 작성자 displayName 즉시 마스킹(기존 `maskAuthorDisplayName` 재사용, raw email 미유출).
- `getReportsForReview(reviewId): Promise<ReviewReportSummary>`
  - admin 상세용. 사유별 집계 + 신고자 마스킹 + 일시. OPEN/전체 구분.

### 4.3 features/review-report/server/actions.ts (신규)
- `reportReviewAction = withRateLimitAction(..., { tier: "mutation", idStrategy: "userFirst" })`
  - auth 가드(비로그인 → `{ type:"error", reason:"unauthenticated" }`).
  - Zod: `ReportInputSchema = { reviewId: cuid, reason: enum, note: string.max(500).optional }`.
  - `createReviewReport` 위임 → outcome 매핑:
    `created`→success, `duplicate`→success("이미 신고됨"), `self`→error, `null`→error(리뷰 없음).
  - 캐시 무효화 없음(리뷰 노출 불변 = D1).

### 4.4 features/admin-review-moderation/server/actions.ts (확장)
- `resolveReportsAction(reviewId)` → `resolveReportsByHiding` → `revalidatePath('/products/{productId}')` + admin paths.
- `dismissReportsAction(reviewId)` → `dismissReports` → admin paths revalidate(PDP 무변경).
- 기존 ADMIN role 가드 + Zod 패턴 재사용. 전이 위반 시 우아한 에러 매핑.

## 5. 프론트엔드

### 5.1 사용자향 (PDP)
- `widgets/product-detail/ui/ProductReviewsSection`(RSC): `auth()` 로 `viewerId` 획득 → `ReviewFeed`/`ReviewCard` 로 주입.
- 리뷰 아이템에 `isOwn: boolean` 추가(서버 계산, PII 누출 없는 boolean만). loadMore 액션도 세션에서 동일 계산.
- `features/review-report/ui/ReportReviewButton`(client) + `ReportReviewDialog`:
  - 본인 리뷰(`isOwn`) → 버튼 미노출.
  - 비로그인(`viewerId == null`) → 클릭 시 로그인 유도(로그인 링크 토스트/모달).
  - 로그인 → 사유 라디오 5종 + 선택 메모 → `reportReviewAction` → `useActionState`/토스트.
  - 멱등 성공("이미 신고됨")도 친화적 토스트.
- Frontend 페르소나: 모달 open/close 로컬 state, 리스너/타이머 cleanup(토스트 auto-dismiss 시 clearTimeout), `env` import 금지(client-safe).

### 5.2 관리자향
- `/admin/reviews` "신고됨" 탭 **재해석**: status 필터(`REPORTED`)가 아니라 `listReviewsWithOpenReports` 호출.
  전체/공개/숨김 탭은 기존 `listReviewsForAdmin({ status })` 유지 → 페이지 내 분기. 신고 건수·대표 사유 컬럼 추가.
- `/admin/reviews/[id]`: 신고 패널(사유별 집계, 신고자 마스킹, 일시) + 액션 2종:
  - `숨기기(신고 인정)` → `resolveReportsAction` (PUBLISHED→HIDDEN + OPEN 신고 RESOLVED).
  - `신고 반려` → `dismissReportsAction` (OPEN 신고 DISMISSED, status 불변).
  - 기존 `ReviewStatusToggle`(공개↔숨김) 존치(일반 모더레이션).

## 6. 컴포넌트 경계 (FSD 단방향 무손상)

| 레이어 | 변경 |
|---|---|
| `prisma/schema.prisma` | `ReviewReport` 모델 + 2 enum + 역관계 |
| `entities/review` | mutations(create/resolve/dismiss), queries(listWithOpenReports/getReportsForReview), 타입, barrel export |
| `features/review-report` (신규) | `reportReviewAction` + `ReportReviewButton`/`ReportReviewDialog` + Zod 스키마 |
| `features/admin-review-moderation` | `resolveReportsAction`/`dismissReportsAction` + admin 상세 신고 패널 UI |
| `widgets/product-detail` | `ProductReviewsSection` viewer 컨텍스트 주입 |
| `features/review-feed` | `ReviewCard` 신고 버튼 슬롯, `isOwn` 전달, loadMore isOwn |
| `app/(admin)/admin/reviews` | "신고됨" 탭 report-driven 분기 + 상세 신고 패널 |

## 7. 테스트 (TDD 우선)

**순수/단위:**
- `createReviewReport` 멱등(중복 신고 → duplicate, 본인 → self, 없는 리뷰 → null).
- `ReportInputSchema` Zod(reason enum 강제, note 길이).
- `resolveReportsByHiding` Tx(PUBLISHED→HIDDEN 전이 가드 + OPEN→RESOLVED 일괄), 이미 HIDDEN 시 throw.
- `dismissReports`(OPEN→DISMISSED, status 불변).
- `listReviewsWithOpenReports` 집계/정렬, 마스킹.

**액션:**
- `reportReviewAction`: 비로그인 거부, rate-limit, 본인거부, 멱등 성공.
- `resolveReportsAction`/`dismissReportsAction`: ADMIN 가드, revalidate 호출.

## 8. 에러 처리 매트릭스

| 상황 | 동작 |
|---|---|
| 비로그인 신고 | error → 로그인 유도 |
| 본인 리뷰 신고 | error("본인 리뷰는 신고 불가") + UI 버튼 숨김 |
| 중복 신고 | 멱등 성공("이미 신고됨") |
| 존재하지 않는 리뷰 | error |
| admin 숨기기인데 이미 HIDDEN | 전이 가드 throw → "현재 상태에서 변경 불가" |
| admin 처리인데 OPEN 신고 0건 | updateMany no-op 성공(멱등) |
| rate-limit 초과 | mutation tier onBlock 네이티브 에러 shape 반환 |

## 9. ADR 후보

- **`REPORTED` status-flip 포기 / `ReviewReport` 큐 적재 선회** — 단일 신고 검열 어뷰징 차단.
  과거 결정("REPORTED 진입점 다음 Phase")을 뒤집음. Alternatives: 즉시 flip(검열 악용), 임계치 자동숨김(복잡도).
  → 구현 완료 보고 직전 ADR 발행 제안 예정.
