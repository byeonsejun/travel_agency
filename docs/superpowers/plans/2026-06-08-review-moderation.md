# Review Reporting & Moderation Queue (Phase 15) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 부적절한 리뷰를 신고하고 관리자가 신고 큐에서 일괄 처리(숨김 인정/반려)하는 닫힌 모더레이션 루프를 구현한다.

**Architecture:** 신고는 `Review.status`를 바꾸지 않고 신규 `ReviewReport` 테이블에 적재된다(검열 어뷰징 차단 = spec D1). 리뷰는 admin이 처리하기 전까지 계속 노출. admin 큐는 status-driven 이 아니라 OPEN 신고 존재 여부로 report-driven. `ReviewStatus.REPORTED` enum은 status-flip 용도로 미사용(예약 유지).

**Tech Stack:** Next.js 15 App Router, Prisma 5 (PostgreSQL), Zod 3, Vitest 2, `withRateLimitAction`(mutation tier), NextAuth.

> **FSD 주의:** spec 의 사용자향 "review-report" 기능은 별도 sibling feature 가 아니라 **`features/review-feed`** 안에 co-locate 한다. 신고 트리거가 `ReviewCard`(review-feed) 내부에 있어, 별도 feature 로 분리하면 `features/review-feed → features/review-report` 동일 레이어 cross-slice import(§5 Architect 금지)가 발생하기 때문. admin 향은 기존 `features/admin-review-moderation` 확장.

> **마이그레이션 주의:** 이 repo 는 shadow DB + pgvector 충돌로 `prisma migrate dev` 사용 불가. Task 1 의 3-step 우회(db push + 수동 SQL + migrate resolve)를 그대로 따른다. (`project_prisma_migration_workaround` 메모리)

---

## File Structure

| 파일 | 책임 |
|---|---|
| `prisma/schema.prisma` (modify) | `ReviewReport` 모델 + `ReportReason`/`ReportStatus` enum + 역관계 |
| `prisma/migrations/20260608010000_phase15_review_report/migration.sql` (create) | 수동 DDL |
| `src/entities/review/model/types.ts` (modify) | `isOwn` 추가, 신고 관련 타입 |
| `src/entities/review/api/mutations.ts` (modify) | `createReviewReport`/`resolveReportsByHiding`/`dismissReports` |
| `src/entities/review/api/queries.ts` (modify) | `listReviewsWithOpenReports`/`getReportsForReview` + `listReviewsByProduct` viewerId |
| `src/entities/review/index.ts` (modify) | 신규 export |
| `src/features/review-feed/model/reportSchema.ts` (create) | Zod `ReportInputSchema` + 사유 라벨 |
| `src/features/review-feed/server/reportReview.ts` (create) | `reportReviewAction` (rate-limited) |
| `src/features/review-feed/ui/ReportReviewButton.tsx` (create) | client 신고 버튼 + 모달 |
| `src/features/review-feed/ui/ReviewCard.tsx` (modify) | 신고 버튼 슬롯(!isOwn) |
| `src/features/review-feed/ui/ReviewFeed.tsx` (modify) | `isAuthenticated` prop 전달 |
| `src/features/review-feed/server/loadMore.ts` (modify) | viewerId 계산 → isOwn |
| `src/features/review-feed/index.ts` (modify) | export |
| `src/widgets/product-detail/ui/ProductReviewsSection.tsx` (modify) | viewer 컨텍스트 주입 |
| `src/features/admin-review-moderation/model/schemas.ts` (modify) | report 액션 입력 스키마 |
| `src/features/admin-review-moderation/server/actions.ts` (modify) | `resolveReportsAction`/`dismissReportsAction` |
| `src/features/admin-review-moderation/ui/ReportModerationActions.tsx` (create) | client 처리 버튼 2종 |
| `src/features/admin-review-moderation/index.ts` (modify) | export |
| `src/app/(admin)/admin/reviews/page.tsx` (modify) | "신고됨" 탭 report-driven 분기 |
| `src/app/(admin)/admin/reviews/[id]/page.tsx` (modify) | 신고 패널 + 처리 버튼 |

---

## Task 1: `ReviewReport` 스키마 마이그레이션

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260608010000_phase15_review_report/migration.sql`

- [ ] **Step 1: schema.prisma 에 enum + 모델 추가**

`prisma/schema.prisma` 의 `enum ReviewStatus { ... }` 블록 바로 아래에 추가:

```prisma
enum ReportReason {
  SPAM // 스팸/광고
  ABUSIVE // 욕설/비방
  IRRELEVANT // 관련 없는 내용
  PRIVACY // 개인정보 노출
  OTHER // 기타
}

enum ReportStatus {
  OPEN // 처리 대기 (admin 큐 진입)
  RESOLVED // 숨김 인정으로 종료
  DISMISSED // 반려로 종료 (리뷰 노출 유지)
}

// 사용자 리뷰 신고. Review.status 는 바꾸지 않고 본 테이블에만 적재(검열 어뷰징
// 차단 — spec D1). admin 큐는 status=OPEN 행의 존재로 report-driven 구동.
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

  @@unique([reviewId, reporterId]) // 1인 1신고 (멱등 dedup)
  @@index([status, createdAt]) // admin OPEN 큐 정렬
  @@index([reviewId])
}
```

- [ ] **Step 2: 역관계 추가**

`model Review { ... }` 의 `photos ReviewPhoto[]` 줄 아래에 추가:

```prisma
  reports ReviewReport[]
```

`model User { ... }` 블록 내 적당한 relation 목록에 추가(다른 `[]` relation 들과 같은 위치):

```prisma
  reviewReports ReviewReport[]
```

- [ ] **Step 3: schema 포맷 검증**

Run: `npx prisma format`
Expected: 에러 없이 포맷 완료. `ReviewReport` 모델·enum 정렬됨.

- [ ] **Step 4: 수동 migration.sql 작성**

Create `prisma/migrations/20260608010000_phase15_review_report/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('SPAM', 'ABUSIVE', 'IRRELEVANT', 'PRIVACY', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "ReviewReport" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "note" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewReport_reviewId_reporterId_key" ON "ReviewReport"("reviewId", "reporterId");

-- CreateIndex
CREATE INDEX "ReviewReport_status_createdAt_idx" ON "ReviewReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewReport_reviewId_idx" ON "ReviewReport"("reviewId");

-- AddForeignKey
ALTER TABLE "ReviewReport" ADD CONSTRAINT "ReviewReport_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewReport" ADD CONSTRAINT "ReviewReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 5: dev DB 에 적용 (db push) + 클라이언트 생성**

Run: `npx prisma db push && npx prisma generate`
Expected: `ReviewReport` 테이블 + enum 생성. `Your database is now in sync`. Prisma Client 재생성으로 `ReviewReport`/`ReportReason`/`ReportStatus` 타입 사용 가능.

- [ ] **Step 6: 마이그레이션 히스토리 정합 (resolve)**

Run: `npx prisma migrate resolve --applied 20260608010000_phase15_review_report`
Expected: `Migration ... marked as applied`. (shadow DB 우회 — 실행 없이 히스토리만 기록)

- [ ] **Step 7: 타입체크로 클라이언트 생성 확인**

Run: `npx tsc --noEmit`
Expected: PASS (신규 모델 참조처가 아직 없으므로 기존 코드 기준 통과).

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260608010000_phase15_review_report
git commit -m "feat(review): add ReviewReport model + ReportReason/ReportStatus enums"
```

---

## Task 2: 백엔드 코어 (신고 생성·멱등, admin 조회·처리 API)

### Task 2.1: `createReviewReport` mutation (멱등 신고 생성)

**Files:**
- Modify: `src/entities/review/api/mutations.ts`
- Test: `src/entities/review/api/__tests__/mutations.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/entities/review/api/__tests__/mutations.test.ts` 의 상단 `mocks` 객체에 `create`/`updateMany`/`findFirst` 핸들을 추가하고(reviewReport 용), 파일 하단에 describe 추가. 먼저 mock 확장:

```ts
const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  reportCreate: vi.fn(),
  reportUpdateMany: vi.fn(),
  txn: vi.fn(),
}));

vi.mock("@/shared/lib/db", () => ({
  db: {
    review: {
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
    reviewReport: {
      create: mocks.reportCreate,
      updateMany: mocks.reportUpdateMany,
    },
    $transaction: mocks.txn,
  },
}));
```

테스트:

```ts
import { createReviewReport } from "../mutations";

describe("createReviewReport", () => {
  it("리뷰 부재 시 not_found", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const r = await createReviewReport({
      reviewId: "nope",
      reporterId: "u1",
      reason: "SPAM",
    });
    expect(r).toBe("not_found");
    expect(mocks.reportCreate).not.toHaveBeenCalled();
  });

  it("본인 리뷰 신고는 self (create 안 함)", async () => {
    mocks.findUnique.mockResolvedValue({ userId: "u1" });
    const r = await createReviewReport({
      reviewId: "r1",
      reporterId: "u1",
      reason: "SPAM",
    });
    expect(r).toBe("self");
    expect(mocks.reportCreate).not.toHaveBeenCalled();
  });

  it("정상 신고는 created", async () => {
    mocks.findUnique.mockResolvedValue({ userId: "author" });
    mocks.reportCreate.mockResolvedValue({});
    const r = await createReviewReport({
      reviewId: "r1",
      reporterId: "u2",
      reason: "ABUSIVE",
      note: "욕설",
    });
    expect(r).toBe("created");
    expect(mocks.reportCreate).toHaveBeenCalledWith({
      data: {
        reviewId: "r1",
        reporterId: "u2",
        reason: "ABUSIVE",
        note: "욕설",
      },
    });
  });

  it("중복 신고(P2002)는 duplicate 로 흡수", async () => {
    mocks.findUnique.mockResolvedValue({ userId: "author" });
    const err = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "5",
    });
    mocks.reportCreate.mockRejectedValue(err);
    const r = await createReviewReport({
      reviewId: "r1",
      reporterId: "u2",
      reason: "SPAM",
    });
    expect(r).toBe("duplicate");
  });
});
```

`Prisma` import 가 테스트 파일에 없으면 상단에 추가: `import { Prisma } from "@prisma/client";`

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/entities/review/api/__tests__/mutations.test.ts`
Expected: FAIL — `createReviewReport is not a function`.

- [ ] **Step 3: 구현**

`src/entities/review/api/mutations.ts` 상단 import 를 다음으로 교체/보강:

```ts
import { Prisma, type ReviewStatus, type ReportReason } from "@prisma/client";

import { db } from "@/shared/lib/db";

import { assertReviewTransition } from "../model/transitions";
```

파일 하단에 추가:

```ts
// 사용자 신고 생성. 멱등 — 같은 (review, reporter) 재신고는 P2002 를 duplicate 로
// 흡수(에러 아님). 본인 리뷰는 self 로 차단. 돈·좌석 아니므로 TOCTOU 비크리티컬.
export async function createReviewReport(input: {
  reviewId: string;
  reporterId: string;
  reason: ReportReason;
  note?: string;
}): Promise<"created" | "duplicate" | "self" | "not_found"> {
  const review = await db.review.findUnique({
    where: { id: input.reviewId },
    select: { userId: true },
  });
  if (!review) return "not_found";
  if (review.userId === input.reporterId) return "self";

  try {
    await db.reviewReport.create({
      data: {
        reviewId: input.reviewId,
        reporterId: input.reporterId,
        reason: input.reason,
        note: input.note ?? null,
      },
    });
    return "created";
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return "duplicate";
    }
    throw e;
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/entities/review/api/__tests__/mutations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/entities/review/api/mutations.ts src/entities/review/api/__tests__/mutations.test.ts
git commit -m "feat(review): createReviewReport idempotent mutation"
```

### Task 2.2: `resolveReportsByHiding` / `dismissReports` mutations

**Files:**
- Modify: `src/entities/review/api/mutations.ts`
- Test: `src/entities/review/api/__tests__/mutations.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`mutations.test.ts` 에 describe 추가:

```ts
import { resolveReportsByHiding, dismissReports } from "../mutations";

describe("resolveReportsByHiding", () => {
  it("리뷰 부재 시 null", async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect(await resolveReportsByHiding("nope")).toBeNull();
  });

  it("PUBLISHED 면 HIDDEN 전이 + OPEN 신고 RESOLVED 일괄 (단일 tx)", async () => {
    mocks.findUnique.mockResolvedValue({
      status: "PUBLISHED",
      productId: "p1",
    });
    mocks.txn.mockResolvedValue([]);
    const r = await resolveReportsByHiding("r1");
    expect(r).toEqual({ productId: "p1" });
    expect(mocks.txn).toHaveBeenCalledTimes(1);
  });

  it("이미 HIDDEN 이면 전이 가드 throw", async () => {
    mocks.findUnique.mockResolvedValue({ status: "HIDDEN", productId: "p1" });
    await expect(resolveReportsByHiding("r1")).rejects.toBeInstanceOf(
      InvalidReviewTransitionError,
    );
    expect(mocks.txn).not.toHaveBeenCalled();
  });
});

describe("dismissReports", () => {
  it("리뷰 부재 시 null", async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect(await dismissReports("nope")).toBeNull();
  });

  it("OPEN 신고를 DISMISSED 로 일괄 변경 + status 불변", async () => {
    mocks.findUnique.mockResolvedValue({ productId: "p1" });
    mocks.reportUpdateMany.mockResolvedValue({ count: 2 });
    const r = await dismissReports("r1");
    expect(r).toEqual({ productId: "p1" });
    expect(mocks.reportUpdateMany).toHaveBeenCalledWith({
      where: { reviewId: "r1", status: "OPEN" },
      data: { status: "DISMISSED", resolvedAt: expect.any(Date) },
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/entities/review/api/__tests__/mutations.test.ts`
Expected: FAIL — `resolveReportsByHiding is not a function`.

- [ ] **Step 3: 구현**

`mutations.ts` 하단에 추가:

```ts
// 신고 인정: 리뷰를 숨기고(PUBLISHED→HIDDEN 전이 가드) OPEN 신고를 일괄 RESOLVED.
// 숨김+신고종결을 단일 tx 로 묶어 부분 적용 방지. 이미 HIDDEN 이면 전이 가드 throw.
export async function resolveReportsByHiding(
  reviewId: string,
): Promise<{ productId: string } | null> {
  const review = await db.review.findUnique({
    where: { id: reviewId },
    select: { status: true, productId: true },
  });
  if (!review) return null;

  assertReviewTransition(review.status, "HIDDEN"); // 위반 시 throw

  await db.$transaction([
    db.review.update({ where: { id: reviewId }, data: { status: "HIDDEN" } }),
    db.reviewReport.updateMany({
      where: { reviewId, status: "OPEN" },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    }),
  ]);
  return { productId: review.productId };
}

// 신고 반려: OPEN 신고만 DISMISSED 로 종결. 리뷰 status 불변(노출 유지).
export async function dismissReports(
  reviewId: string,
): Promise<{ productId: string } | null> {
  const review = await db.review.findUnique({
    where: { id: reviewId },
    select: { productId: true },
  });
  if (!review) return null;

  await db.reviewReport.updateMany({
    where: { reviewId, status: "OPEN" },
    data: { status: "DISMISSED", resolvedAt: new Date() },
  });
  return { productId: review.productId };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/entities/review/api/__tests__/mutations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/entities/review/api/mutations.ts src/entities/review/api/__tests__/mutations.test.ts
git commit -m "feat(review): resolveReportsByHiding + dismissReports mutations"
```

### Task 2.3: admin 조회 쿼리 + 타입 (`listReviewsWithOpenReports`, `getReportsForReview`)

**Files:**
- Modify: `src/entities/review/model/types.ts`
- Modify: `src/entities/review/api/queries.ts`
- Test: `src/entities/review/api/__tests__/adminQueries.test.ts`

- [ ] **Step 1: 타입 추가**

`src/entities/review/model/types.ts` 상단 import 에 enum 추가:

```ts
import type { Prisma, ReviewStatus, ReportReason, ReportStatus } from "@prisma/client";
```

파일 하단에 추가:

```ts
// admin 신고 큐 row. OPEN 신고가 있는 리뷰만. 작성자는 displayName 으로 마스킹.
export type AdminReportedReviewListItem = {
  id: string;
  rating: number;
  status: ReviewStatus;
  createdAt: Date;
  productId: string;
  productTitle: string;
  authorDisplayName: string;
  openReportCount: number;
  topReason: ReportReason | null; // 가장 많이 지목된 OPEN 사유
};

export type AdminReportedReviewListPage = {
  items: AdminReportedReviewListItem[];
  nextCursor: string | null;
};

// admin 상세 신고 패널. 신고자는 displayName 으로 마스킹.
export type ReviewReportEntry = {
  id: string;
  reason: ReportReason;
  note: string | null;
  status: ReportStatus;
  createdAt: Date;
  reporterDisplayName: string;
};

export type ReviewReportSummary = {
  reviewId: string;
  openCount: number;
  reasonCounts: Record<ReportReason, number>; // OPEN 신고만 집계
  entries: ReviewReportEntry[]; // 전체(OPEN+종결) 최신순
};
```

- [ ] **Step 2: 실패 테스트 작성**

`adminQueries.test.ts` 의 `mocks` 와 `vi.mock` 을 reviewReport 핸들 포함하도록 확장:

```ts
const mocks = vi.hoisted(() => ({
  groupBy: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  reportFindMany: vi.fn(),
}));

vi.mock("@/shared/lib/db", () => ({
  db: {
    review: {
      groupBy: mocks.groupBy,
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
    },
    reviewReport: {
      findMany: mocks.reportFindMany,
    },
  },
}));
```

describe 추가:

```ts
import { listReviewsWithOpenReports, getReportsForReview } from "../queries";

describe("listReviewsWithOpenReports", () => {
  it("OPEN 신고 있는 리뷰만 + 건수/대표사유 집계 + 작성자 마스킹", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "r1",
        rating: 2,
        status: "PUBLISHED",
        createdAt: new Date("2026-06-01"),
        productId: "p1",
        product: { title: "방콕 4일" },
        user: { name: "홍길동", email: "hong@test.com" },
        reports: [{ reason: "SPAM" }, { reason: "SPAM" }, { reason: "ABUSIVE" }],
      },
    ]);

    const page = await listReviewsWithOpenReports({ limit: 20 });

    expect(mocks.findMany.mock.calls[0][0].where).toEqual({
      reports: { some: { status: "OPEN" } },
    });
    expect(page.items[0].openReportCount).toBe(3);
    expect(page.items[0].topReason).toBe("SPAM");
    expect(page.items[0].productTitle).toBe("방콕 4일");
    // raw email 미유출
    expect(JSON.stringify(page.items[0])).not.toContain("hong@test.com");
    expect(page.nextCursor).toBeNull();
  });
});

describe("getReportsForReview", () => {
  it("사유별 OPEN 집계 + entries 마스킹", async () => {
    mocks.reportFindMany.mockResolvedValue([
      {
        id: "rep1",
        reason: "SPAM",
        note: null,
        status: "OPEN",
        createdAt: new Date(),
        reporter: { name: "김철수", email: "kim@test.com" },
      },
      {
        id: "rep2",
        reason: "PRIVACY",
        note: "전화번호",
        status: "DISMISSED",
        createdAt: new Date(),
        reporter: { name: null, email: "lee@test.com" },
      },
    ]);

    const summary = await getReportsForReview("r1");

    expect(summary.openCount).toBe(1);
    expect(summary.reasonCounts.SPAM).toBe(1);
    expect(summary.reasonCounts.PRIVACY).toBe(0); // DISMISSED 는 OPEN 집계 제외
    expect(summary.entries).toHaveLength(2);
    expect(JSON.stringify(summary)).not.toContain("kim@test.com");
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run src/entities/review/api/__tests__/adminQueries.test.ts`
Expected: FAIL — `listReviewsWithOpenReports is not a function`.

- [ ] **Step 4: 구현**

`src/entities/review/api/queries.ts` 상단 import 에 타입 추가(기존 import 목록에 병합):

```ts
import type {
  AdminReportedReviewListItem,
  AdminReportedReviewListPage,
  ReviewReportEntry,
  ReviewReportSummary,
} from "../model/types";
import type { ReportReason } from "@prisma/client";
```

(기존 `maskAuthorDisplayName` import 는 이미 존재. 없으면 `import { maskAuthorDisplayName } from "../model/displayName";` 추가.)

파일 하단에 추가:

```ts
// admin 신고 큐. OPEN 신고가 1건+ 인 리뷰만. OPEN 신고를 relation 으로 동봉해
// JS 에서 건수/대표사유 집계(필터 _count 대신 명시 — 버전 호환 안전).
// 작성자 email 은 maskAuthorDisplayName 으로 즉시 마스킹(PII 미유출).
export async function listReviewsWithOpenReports(
  opts: { cursor?: string; limit?: number } = {},
): Promise<AdminReportedReviewListPage> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const rows = await db.review.findMany({
    where: { reports: { some: { status: "OPEN" } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor && { cursor: { id: opts.cursor }, skip: 1 }),
    select: {
      id: true,
      rating: true,
      status: true,
      createdAt: true,
      productId: true,
      product: { select: { title: true } },
      user: { select: { name: true, email: true } },
      reports: {
        where: { status: "OPEN" },
        select: { reason: true },
      },
    },
  });

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;

  const items: AdminReportedReviewListItem[] = sliced.map((r) => {
    const counts = new Map<ReportReason, number>();
    for (const rep of r.reports) {
      counts.set(rep.reason, (counts.get(rep.reason) ?? 0) + 1);
    }
    let topReason: ReportReason | null = null;
    let topN = 0;
    for (const [reason, n] of counts) {
      if (n > topN) {
        topN = n;
        topReason = reason;
      }
    }
    return {
      id: r.id,
      rating: r.rating,
      status: r.status,
      createdAt: r.createdAt,
      productId: r.productId,
      productTitle: r.product.title,
      authorDisplayName: maskAuthorDisplayName({
        name: r.user.name,
        email: r.user.email,
      }),
      openReportCount: r.reports.length,
      topReason,
    };
  });

  return {
    items,
    nextCursor: hasMore ? sliced[sliced.length - 1].id : null,
  };
}

// admin 상세 신고 패널. 전체 신고(OPEN+종결) 최신순 + OPEN 사유별 집계.
export async function getReportsForReview(
  reviewId: string,
): Promise<ReviewReportSummary> {
  const rows = await db.reviewReport.findMany({
    where: { reviewId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      reason: true,
      note: true,
      status: true,
      createdAt: true,
      reporter: { select: { name: true, email: true } },
    },
  });

  const reasonCounts: Record<ReportReason, number> = {
    SPAM: 0,
    ABUSIVE: 0,
    IRRELEVANT: 0,
    PRIVACY: 0,
    OTHER: 0,
  };
  let openCount = 0;
  const entries: ReviewReportEntry[] = rows.map((r) => {
    if (r.status === "OPEN") {
      reasonCounts[r.reason] += 1;
      openCount += 1;
    }
    return {
      id: r.id,
      reason: r.reason,
      note: r.note,
      status: r.status,
      createdAt: r.createdAt,
      reporterDisplayName: maskAuthorDisplayName({
        name: r.reporter.name,
        email: r.reporter.email,
      }),
    };
  });

  return { reviewId, openCount, reasonCounts, entries };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/entities/review/api/__tests__/adminQueries.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/entities/review/model/types.ts src/entities/review/api/queries.ts src/entities/review/api/__tests__/adminQueries.test.ts
git commit -m "feat(review): admin report queue queries + types"
```

### Task 2.4: `listReviewsByProduct` viewerId → `isOwn`

**Files:**
- Modify: `src/entities/review/model/types.ts`
- Modify: `src/entities/review/api/queries.ts`
- Test: `src/entities/review/api/__tests__/queries.test.ts` (없으면 생성)

- [ ] **Step 1: 타입에 isOwn 추가**

`types.ts` 의 `ReviewListItem` 에 필드 추가(`content` 아래 등):

```ts
  isOwn: boolean; // 뷰어 본인 작성 여부. viewerId 미전달 시 false.
```

- [ ] **Step 2: 실패 테스트 작성**

`src/entities/review/api/__tests__/queries.test.ts` 생성(없을 때):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/shared/lib/db", () => ({
  db: { review: { findMany: mocks.findMany } },
}));

import { listReviewsByProduct } from "../queries";

beforeEach(() => vi.clearAllMocks());

const row = {
  id: "r1",
  rating: 5,
  content: "좋아요",
  createdAt: new Date(),
  userId: "author1",
  user: { name: "홍길동", email: "h@test.com", image: null },
  photos: [],
};

describe("listReviewsByProduct isOwn", () => {
  it("viewerId 가 작성자와 같으면 isOwn true", async () => {
    mocks.findMany.mockResolvedValue([row]);
    const page = await listReviewsByProduct("p1", { viewerId: "author1" });
    expect(page.items[0].isOwn).toBe(true);
  });

  it("viewerId 미전달이면 isOwn false", async () => {
    mocks.findMany.mockResolvedValue([row]);
    const page = await listReviewsByProduct("p1", {});
    expect(page.items[0].isOwn).toBe(false);
  });
});
```

> 만약 `queries.test.ts` 가 이미 존재하면 위 describe 만 append 하고 mock 에 `userId` select 가 포함되도록 조정.

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run src/entities/review/api/__tests__/queries.test.ts`
Expected: FAIL — `isOwn` undefined 또는 옵션 타입 불일치.

- [ ] **Step 4: 구현**

`queries.ts` 의 `listReviewsByProduct` 시그니처와 본문 수정:
- opts 에 `viewerId?: string` 추가.
- `select` 에 `userId: true` 추가.
- 매핑에서 `isOwn: opts.viewerId != null && r.userId === opts.viewerId` 설정.

```ts
export async function listReviewsByProduct(
  productId: string,
  opts: { limit?: number; cursor?: string; viewerId?: string } = {},
): Promise<ReviewListPage> {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);

  const rows = await db.review.findMany({
    where: { productId, status: "PUBLISHED" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor && { cursor: { id: opts.cursor }, skip: 1 }),
    select: {
      id: true,
      rating: true,
      content: true,
      createdAt: true,
      userId: true,
      user: { select: { name: true, email: true, image: true } },
      photos: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          storagePath: true,
          order: true,
          width: true,
          height: true,
        },
      },
    },
  });

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;

  const items = sliced.map((r) => ({
    id: r.id,
    rating: r.rating,
    content: r.content,
    createdAt: r.createdAt,
    isOwn: opts.viewerId != null && r.userId === opts.viewerId,
    user: {
      displayName: maskAuthorDisplayName({
        name: r.user.name,
        email: r.user.email,
      }),
      image: r.user.image,
    },
    photos: r.photos,
  }));

  return { items, nextCursor: hasMore ? sliced[sliced.length - 1].id : null };
}
```

> 기존 매핑 코드(라인 62~83 근처)를 위 내용으로 교체. `displayName` 매핑이 기존과 동일한지 확인하고 차이가 있으면 기존 마스킹 호출 형태를 유지.

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/entities/review/api/__tests__/queries.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/entities/review/model/types.ts src/entities/review/api/queries.ts src/entities/review/api/__tests__/queries.test.ts
git commit -m "feat(review): listReviewsByProduct viewerId -> isOwn flag"
```

### Task 2.5: barrel export 갱신

**Files:**
- Modify: `src/entities/review/index.ts`

- [ ] **Step 1: export 추가**

`mutations` export 블록을 확장:

```ts
export {
  setReviewStatus,
  createReviewReport,
  resolveReportsByHiding,
  dismissReports,
} from "./api/mutations";
```

`queries` export 블록에 추가:

```ts
  listReviewsWithOpenReports,
  getReportsForReview,
```

타입 export 블록에 추가:

```ts
  AdminReportedReviewListItem,
  AdminReportedReviewListPage,
  ReviewReportEntry,
  ReviewReportSummary,
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/entities/review/index.ts
git commit -m "feat(review): export report mutations + admin queries from barrel"
```

### Task 2.6: 사용자 신고 Server Action (`reportReviewAction`)

**Files:**
- Create: `src/features/review-feed/model/reportSchema.ts`
- Create: `src/features/review-feed/server/reportReview.ts`
- Test: `src/features/review-feed/server/__tests__/reportReview.test.ts`

- [ ] **Step 1: Zod 스키마 작성 (pure 모듈)**

Create `src/features/review-feed/model/reportSchema.ts`:

```ts
import { z } from "zod";

// Prisma ReportReason 과 1:1. enum 값 순서·철자 동기 유지.
export const REPORT_REASONS = [
  "SPAM",
  "ABUSIVE",
  "IRRELEVANT",
  "PRIVACY",
  "OTHER",
] as const;

export const REPORT_REASON_LABELS: Record<
  (typeof REPORT_REASONS)[number],
  string
> = {
  SPAM: "스팸/광고",
  ABUSIVE: "욕설/비방",
  IRRELEVANT: "관련 없는 내용",
  PRIVACY: "개인정보 노출",
  OTHER: "기타",
};

export const ReportInputSchema = z.object({
  reviewId: z.string().cuid(),
  reason: z.enum(REPORT_REASONS),
  note: z.string().max(500).optional(),
});

export type ReportInput = z.infer<typeof ReportInputSchema>;
```

- [ ] **Step 2: 실패 테스트 작성**

Create `src/features/review-feed/server/__tests__/reportReview.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createReviewReport: vi.fn(),
}));

vi.mock("@/features/auth/server/auth", () => ({ auth: mocks.auth }));
vi.mock("@/entities/review", () => ({
  createReviewReport: mocks.createReviewReport,
}));
// rate-limit 래퍼는 통과(impl 직접 호출)로 stub
vi.mock("@/shared/lib/rate-limit", () => ({
  withRateLimitAction: (_opts: unknown, impl: unknown) => impl,
}));

import { reportReviewAction } from "../reportReview";

const VALID_ID = "clxreview0000000000000000";

beforeEach(() => vi.clearAllMocks());

describe("reportReviewAction", () => {
  it("비로그인은 UNAUTHENTICATED", async () => {
    mocks.auth.mockResolvedValue(null);
    const r = await reportReviewAction({ reviewId: VALID_ID, reason: "SPAM" });
    expect(r).toEqual({ ok: false, error: "UNAUTHENTICATED" });
    expect(mocks.createReviewReport).not.toHaveBeenCalled();
  });

  it("잘못된 입력은 INVALID", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    const r = await reportReviewAction({ reviewId: "bad", reason: "SPAM" });
    expect(r).toEqual({ ok: false, error: "INVALID" });
  });

  it("created → ok created", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.createReviewReport.mockResolvedValue("created");
    const r = await reportReviewAction({ reviewId: VALID_ID, reason: "ABUSIVE" });
    expect(r).toEqual({ ok: true, status: "created" });
  });

  it("duplicate → ok duplicate (멱등)", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.createReviewReport.mockResolvedValue("duplicate");
    const r = await reportReviewAction({ reviewId: VALID_ID, reason: "SPAM" });
    expect(r).toEqual({ ok: true, status: "duplicate" });
  });

  it("self → error SELF", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.createReviewReport.mockResolvedValue("self");
    const r = await reportReviewAction({ reviewId: VALID_ID, reason: "SPAM" });
    expect(r).toEqual({ ok: false, error: "SELF" });
  });

  it("not_found → error NOT_FOUND", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.createReviewReport.mockResolvedValue("not_found");
    const r = await reportReviewAction({ reviewId: VALID_ID, reason: "SPAM" });
    expect(r).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run src/features/review-feed/server/__tests__/reportReview.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: 구현**

Create `src/features/review-feed/server/reportReview.ts`:

```ts
"use server";

import { createReviewReport } from "@/entities/review";
import { auth } from "@/features/auth/server/auth";
import { withRateLimitAction } from "@/shared/lib/rate-limit";

import { ReportInputSchema, type ReportInput } from "../model/reportSchema";

export type ReportResult =
  | { ok: true; status: "created" | "duplicate" }
  | {
      ok: false;
      error: "UNAUTHENTICATED" | "SELF" | "NOT_FOUND" | "INVALID" | "RATE_LIMITED";
    };

// 사용자 리뷰 신고. auth 가드 → Zod → entities 멱등 mutation 위임.
// 캐시 무효화 없음 — 신고는 리뷰 노출을 바꾸지 않는다(spec D1).
async function reportReviewImpl(input: ReportInput): Promise<ReportResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "UNAUTHENTICATED" };

  const parsed = ReportInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID" };

  const outcome = await createReviewReport({
    reviewId: parsed.data.reviewId,
    reporterId: userId,
    reason: parsed.data.reason,
    note: parsed.data.note,
  });

  switch (outcome) {
    case "created":
      return { ok: true, status: "created" };
    case "duplicate":
      return { ok: true, status: "duplicate" };
    case "self":
      return { ok: false, error: "SELF" };
    case "not_found":
      return { ok: false, error: "NOT_FOUND" };
  }
}

// mutation tier (20/min, userFirst — 미인증은 내부 가드가 UNAUTHENTICATED 반환).
export const reportReviewAction = withRateLimitAction<[ReportInput], ReportResult>(
  {
    tier: "mutation",
    resolveUserId: async () => (await auth())?.user?.id ?? null,
    onBlock: (): ReportResult => ({ ok: false, error: "RATE_LIMITED" }),
  },
  reportReviewImpl,
);
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/features/review-feed/server/__tests__/reportReview.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/review-feed/model/reportSchema.ts src/features/review-feed/server/reportReview.ts src/features/review-feed/server/__tests__/reportReview.test.ts
git commit -m "feat(review-feed): reportReviewAction (rate-limited, idempotent)"
```

### Task 2.7: admin 처리 Server Actions (`resolveReportsAction`/`dismissReportsAction`)

**Files:**
- Modify: `src/features/admin-review-moderation/model/schemas.ts`
- Modify: `src/features/admin-review-moderation/server/actions.ts`
- Test: `src/features/admin-review-moderation/server/__tests__/actions.test.ts`

- [ ] **Step 1: 입력 스키마 추가**

`schemas.ts` 하단에 추가:

```ts
export const ReportModerationSchema = z.object({
  reviewId: z.string().cuid(),
});

export type ReportModerationInput = z.infer<typeof ReportModerationSchema>;
```

- [ ] **Step 2: 실패 테스트 작성**

`actions.test.ts` 의 `mocks`/`vi.mock("@/entities/review", ...)` 를 확장(resolve/dismiss 추가):

```ts
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  setReviewStatus: vi.fn(),
  resolveReportsByHiding: vi.fn(),
  dismissReports: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/entities/review", () => ({
  setReviewStatus: mocks.setReviewStatus,
  resolveReportsByHiding: mocks.resolveReportsByHiding,
  dismissReports: mocks.dismissReports,
  InvalidReviewTransitionError: class extends Error {},
}));
```

describe 추가:

```ts
import { resolveReportsAction, dismissReportsAction } from "../actions";

describe("resolveReportsAction", () => {
  it("비-admin 거부", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u", role: "USER" } });
    const r = await resolveReportsAction(VALID_ID);
    expect(r.type).toBe("error");
    expect(mocks.resolveReportsByHiding).not.toHaveBeenCalled();
  });

  it("성공 시 PDP + admin 무효화", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "a", role: "ADMIN" } });
    mocks.resolveReportsByHiding.mockResolvedValue({ productId: "p1" });
    const r = await resolveReportsAction(VALID_ID);
    expect(r).toEqual({ type: "success" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/products/p1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/reviews");
  });
});

describe("dismissReportsAction", () => {
  it("성공 시 admin 무효화", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "a", role: "ADMIN" } });
    mocks.dismissReports.mockResolvedValue({ productId: "p1" });
    const r = await dismissReportsAction(VALID_ID);
    expect(r).toEqual({ type: "success" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/reviews");
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run src/features/admin-review-moderation/server/__tests__/actions.test.ts`
Expected: FAIL — `resolveReportsAction is not a function`.

- [ ] **Step 4: 구현**

`actions.ts` 상단 import 확장:

```ts
import {
  setReviewStatus,
  resolveReportsByHiding,
  dismissReports,
  InvalidReviewTransitionError,
} from "@/entities/review";
import {
  SetReviewStatusSchema,
  type SetReviewStatusInput,
  ReportModerationSchema,
} from "../model/schemas";
```

파일 하단에 추가:

```ts
export type ReportModerationState =
  | { type: "success" }
  | { type: "error"; message: string };

async function assertAdmin(): Promise<ReportModerationState | null> {
  const session = await auth();
  if (!session?.user?.id) {
    return { type: "error", message: "관리자 로그인이 필요합니다" };
  }
  if (session.user.role !== "ADMIN") {
    return { type: "error", message: "관리자 권한이 필요합니다" };
  }
  return null;
}

// 신고 인정: 리뷰 숨김 + OPEN 신고 RESOLVED. PDP ISR 즉시 무효화.
export async function resolveReportsAction(
  reviewId: string,
): Promise<ReportModerationState> {
  const denied = await assertAdmin();
  if (denied) return denied;

  const parsed = ReportModerationSchema.safeParse({ reviewId });
  if (!parsed.success) return { type: "error", message: "입력값을 확인해 주세요" };

  try {
    const result = await resolveReportsByHiding(parsed.data.reviewId);
    if (!result) return { type: "error", message: "리뷰를 찾을 수 없습니다" };
    revalidatePath(`/products/${result.productId}`);
    revalidatePath("/admin/reviews");
    revalidatePath(`/admin/reviews/${reviewId}`);
    return { type: "success" };
  } catch (err) {
    if (err instanceof InvalidReviewTransitionError) {
      return { type: "error", message: "이미 숨김 처리된 리뷰입니다" };
    }
    return { type: "error", message: "처리에 실패했습니다. 잠시 후 다시 시도해 주세요" };
  }
}

// 신고 반려: OPEN 신고 DISMISSED. 리뷰 노출 불변 → PDP 무효화 불필요(생략).
export async function dismissReportsAction(
  reviewId: string,
): Promise<ReportModerationState> {
  const denied = await assertAdmin();
  if (denied) return denied;

  const parsed = ReportModerationSchema.safeParse({ reviewId });
  if (!parsed.success) return { type: "error", message: "입력값을 확인해 주세요" };

  const result = await dismissReports(parsed.data.reviewId);
  if (!result) return { type: "error", message: "리뷰를 찾을 수 없습니다" };
  revalidatePath("/admin/reviews");
  revalidatePath(`/admin/reviews/${reviewId}`);
  return { type: "success" };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/features/admin-review-moderation/server/__tests__/actions.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/admin-review-moderation/model/schemas.ts src/features/admin-review-moderation/server/actions.ts src/features/admin-review-moderation/server/__tests__/actions.test.ts
git commit -m "feat(admin-review): resolveReports + dismissReports actions"
```

### Task 2.8: 백엔드 종합 검증

- [ ] **Step 1: 전체 타입체크 + 테스트**

Run: `npm run typecheck && npm run test`
Expected: PASS (신규 + 기존 테스트 전부).

- [ ] **Step 2: Commit (이미 커밋됨이면 skip)**

---

## Task 3: 프론트엔드 사용자향 UI (PDP 신고 버튼 + 모달)

### Task 3.1: `ReportReviewButton` client 컴포넌트

**Files:**
- Create: `src/features/review-feed/ui/ReportReviewButton.tsx`

- [ ] **Step 1: 컴포넌트 작성**

Create `src/features/review-feed/ui/ReportReviewButton.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";

import {
  REPORT_REASONS,
  REPORT_REASON_LABELS,
} from "../model/reportSchema";
import { reportReviewAction, type ReportResult } from "../server/reportReview";

type Props = {
  reviewId: string;
  isAuthenticated: boolean;
};

const ERROR_MESSAGES: Record<
  Extract<ReportResult, { ok: false }>["error"],
  string
> = {
  UNAUTHENTICATED: "로그인이 필요합니다",
  SELF: "본인 리뷰는 신고할 수 없습니다",
  NOT_FOUND: "리뷰를 찾을 수 없습니다",
  INVALID: "입력값을 확인해 주세요",
  RATE_LIMITED: "잠시 후 다시 시도해 주세요",
};

export function ReportReviewButton({ reviewId, isAuthenticated }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] =
    useState<(typeof REPORT_REASONS)[number]>("SPAM");
  const [note, setNote] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 토스트 auto-dismiss 타이머 cleanup (메모리 누수 방지).
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  function submit() {
    startTransition(async () => {
      const res = await reportReviewAction({
        reviewId,
        reason,
        note: note.trim() || undefined,
      });
      if (res.ok) {
        showToast(
          res.status === "duplicate" ? "이미 신고한 리뷰입니다" : "신고가 접수되었습니다",
        );
        setOpen(false);
        setNote("");
      } else {
        showToast(ERROR_MESSAGES[res.error]);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-gray-400 hover:text-gray-600"
      >
        신고
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-gray-900">리뷰 신고</h3>

            {!isAuthenticated ? (
              <div className="mt-4 text-sm text-gray-600">
                신고하려면 로그인이 필요합니다.
                <Link
                  href="/login"
                  className="ml-1 font-medium text-red-600 hover:underline"
                >
                  로그인하기
                </Link>
              </div>
            ) : (
              <>
                <fieldset className="mt-4 space-y-2">
                  {REPORT_REASONS.map((r) => (
                    <label key={r} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="reason"
                        value={r}
                        checked={reason === r}
                        onChange={() => setReason(r)}
                      />
                      {REPORT_REASON_LABELS[r]}
                    </label>
                  ))}
                </fieldset>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  placeholder="상세 사유(선택)"
                  className="mt-3 w-full rounded-md border border-gray-300 p-2 text-sm"
                  rows={3}
                />
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={isPending}
                    className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {isPending ? "처리 중…" : "신고하기"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/review-feed/ui/ReportReviewButton.tsx
git commit -m "feat(review-feed): ReportReviewButton client modal"
```

### Task 3.2: `ReviewCard` 에 신고 버튼 배선

**Files:**
- Modify: `src/features/review-feed/ui/ReviewCard.tsx`

- [ ] **Step 1: ReviewCard 수정**

`ReportReviewButton` import 추가:

```tsx
import { ReportReviewButton } from "./ReportReviewButton";
```

`ReviewCard` 시그니처에 `isAuthenticated` 추가, 헤더 우측에 버튼 노출(본인 리뷰 제외):

```tsx
export function ReviewCard({
  review,
  isAuthenticated,
}: {
  review: ReviewListItem;
  isAuthenticated: boolean;
}) {
  const images = review.photos.map((p) => ({
    id: p.id,
    url: reviewPhotoPublicUrl(p.storagePath),
    alt: `후기 사진 ${p.order + 1}`,
  }));

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">
            {review.user.displayName}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <Stars value={review.rating} />
            <span className="text-xs text-gray-400">
              {formatDate(review.createdAt)}
            </span>
          </div>
        </div>
        {!review.isOwn && (
          <ReportReviewButton
            reviewId={review.id}
            isAuthenticated={isAuthenticated}
          />
        )}
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">
        {review.content}
      </p>
      {images.length > 0 && (
        <div className="mt-4">
          <PhotoGrid images={images} />
        </div>
      )}
    </li>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: FAIL — `ReviewFeed` 가 아직 `isAuthenticated` 를 안 넘김(다음 Task 에서 해결). 또는 ReviewCard 호출부 미스매치. 확인 후 다음 단계 진행.

- [ ] **Step 3: Commit**

```bash
git add src/features/review-feed/ui/ReviewCard.tsx
git commit -m "feat(review-feed): wire report button into ReviewCard (skip own)"
```

### Task 3.3: `ReviewFeed` + `loadMore` + `ProductReviewsSection` viewer 배선

**Files:**
- Modify: `src/features/review-feed/ui/ReviewFeed.tsx`
- Modify: `src/features/review-feed/server/loadMore.ts`
- Modify: `src/widgets/product-detail/ui/ProductReviewsSection.tsx`

- [ ] **Step 1: ReviewFeed 에 isAuthenticated prop 추가**

`Props` 와 컴포넌트 수정:

```tsx
type Props = {
  productId: string;
  initialItems: ReviewListItem[];
  initialCursor: string | null;
  isAuthenticated: boolean;
};

export function ReviewFeed({
  productId,
  initialItems,
  initialCursor,
  isAuthenticated,
}: Props) {
```

리스트 렌더에서 각 카드에 prop 전달:

```tsx
        {items.map((review) => (
          <ReviewCard
            key={review.id}
            review={review}
            isAuthenticated={isAuthenticated}
          />
        ))}
```

> 기존 `items.map` 블록을 찾아 `isAuthenticated` 를 추가. `ReviewCard` 호출 형태만 변경.

- [ ] **Step 2: loadMore 가 viewerId 로 isOwn 계산하도록 수정**

`loadMore.ts` 수정 — `auth()` 로 viewerId 획득 후 쿼리에 전달:

```ts
"use server";

import { z } from "zod";
import { listReviewsByProduct, type ReviewListPage } from "@/entities/review";
import { auth } from "@/features/auth/server/auth";

const InputSchema = z.object({
  productId: z.string().cuid(),
  cursor: z.string().min(1),
});

export async function loadMoreReviewsAction(
  productId: string,
  cursor: string,
): Promise<ReviewListPage> {
  const parsed = InputSchema.safeParse({ productId, cursor });
  if (!parsed.success) {
    return { items: [], nextCursor: null };
  }
  const viewerId = (await auth())?.user?.id;
  return listReviewsByProduct(parsed.data.productId, {
    limit: 10,
    cursor: parsed.data.cursor,
    viewerId,
  });
}
```

- [ ] **Step 3: ProductReviewsSection 에서 viewer 주입**

`ProductReviewsSection.tsx` 수정 — `auth()` 추가, 쿼리에 viewerId, ReviewFeed 에 isAuthenticated:

```tsx
import {
  getProductReviewStats,
  listReviewsByProduct,
  getReviewRatingDistribution,
} from "@/entities/review";
import { auth } from "@/features/auth/server/auth";
import { ReviewStatsBar, RatingDistribution } from "@/widgets/review-list";
import { ReviewFeed } from "@/features/review-feed";

type ProductReviewsSectionProps = {
  productId: string;
};

export async function ProductReviewsSection({
  productId,
}: ProductReviewsSectionProps) {
  const session = await auth();
  const viewerId = session?.user?.id;

  const [reviewStats, reviewPage, ratingDist] = await Promise.all([
    getProductReviewStats(productId),
    listReviewsByProduct(productId, { limit: 10, viewerId }),
    getReviewRatingDistribution(productId),
  ]);

  return (
    <div className="space-y-4">
      <ReviewStatsBar avg={reviewStats.avg} count={reviewStats.count} />
      <RatingDistribution distribution={ratingDist} total={reviewStats.count} />
      <ReviewFeed
        productId={productId}
        initialItems={reviewPage.items}
        initialCursor={reviewPage.nextCursor}
        isAuthenticated={viewerId != null}
      />
    </div>
  );
}
```

> **캐시 주의:** PDP 가 ISR(`revalidate=3600`)이면 `auth()` 호출은 dynamic API 라 해당 세그먼트가 동적으로 전환될 수 있다. `ProductReviewsSection` 은 이미 `<Suspense>` 로 스트리밍되는 분리 세그먼트이므로(파일 주석 참조) 본문 ISR 에는 영향 없음. 빌드 후 `npm run build` 출력에서 PDP 가 여전히 적절히 처리되는지 확인(Task 4 종합검증).

- [ ] **Step 4: 타입체크 + 테스트**

Run: `npm run typecheck && npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/review-feed/ui/ReviewFeed.tsx src/features/review-feed/server/loadMore.ts src/widgets/product-detail/ui/ProductReviewsSection.tsx
git commit -m "feat(review-feed): thread viewer context (isOwn/isAuthenticated) into PDP feed"
```

### Task 3.4: review-feed barrel + 사용자 UI 런타임 검증

**Files:**
- Modify: `src/features/review-feed/index.ts`

- [ ] **Step 1: barrel 확인/보강**

`src/features/review-feed/index.ts` 에 `ReviewFeed` 가 export 되어 있는지 확인. `ReportReviewButton`/`reportReviewAction` 은 내부 사용이므로 export 불필요(외부에서 직접 안 씀). 변경 없으면 skip.

- [ ] **Step 2: dev 서버 런타임 검증**

Run: `npm run dev` (백그라운드) 후, 리뷰가 있는 상품 PDP 접속.
검증:
- 비로그인: "신고" 클릭 → 모달에 "로그인하기" 노출.
- 로그인(시드 일반 계정): 타인 리뷰 "신고" → 사유 선택 → 접수 토스트. 같은 리뷰 재신고 → "이미 신고한 리뷰입니다".
- 본인 리뷰: "신고" 버튼 미노출.

DB 확인: `npx prisma studio` 또는
```bash
npx tsx -e "import {db} from './src/shared/lib/db'; db.reviewReport.findMany().then(r=>{console.log(r);process.exit(0)})"
```
Expected: ReviewReport 행 생성 확인, 중복 신고 시 행 증가 없음.

- [ ] **Step 3: Commit (변경 있을 때만)**

```bash
git add src/features/review-feed/index.ts
git commit -m "chore(review-feed): barrel touch for report UI"
```

---

## Task 4: 프론트엔드 관리자향 UI (신고 큐 + 처리 액션)

### Task 4.1: `ReportModerationActions` client 컴포넌트

**Files:**
- Create: `src/features/admin-review-moderation/ui/ReportModerationActions.tsx`
- Modify: `src/features/admin-review-moderation/index.ts`

- [ ] **Step 1: 컴포넌트 작성**

Create `src/features/admin-review-moderation/ui/ReportModerationActions.tsx`:

```tsx
"use client";

import { useTransition, useState } from "react";

import {
  resolveReportsAction,
  dismissReportsAction,
  type ReportModerationState,
} from "../server/actions";

type Props = { reviewId: string };

// 신고 처리 버튼 2종. 숨기기(인정) = 빨강, 반려 = 회색.
export function ReportModerationActions({ reviewId }: Props) {
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<ReportModerationState | null>(null);

  function run(action: (id: string) => Promise<ReportModerationState>) {
    startTransition(async () => {
      setState(await action(reviewId));
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={isPending}
        onClick={() => run(resolveReportsAction)}
        className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        숨기기 (신고 인정)
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => run(dismissReportsAction)}
        className="rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
      >
        신고 반려
      </button>
      {state?.type === "success" && (
        <span className="text-sm text-green-600">처리 완료</span>
      )}
      {state?.type === "error" && (
        <span className="text-sm text-red-600">{state.message}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: barrel export**

`src/features/admin-review-moderation/index.ts` 에 추가:

```ts
export { ReportModerationActions } from "./ui/ReportModerationActions";
```

(기존 `ReviewStatusToggle`, 액션 export 는 유지. `resolveReportsAction`/`dismissReportsAction`/`ReportModerationState` 도 export 되는지 확인하고 없으면 추가.)

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/admin-review-moderation/ui/ReportModerationActions.tsx src/features/admin-review-moderation/index.ts
git commit -m "feat(admin-review): ReportModerationActions client buttons"
```

### Task 4.2: admin 목록 "신고됨" 탭 report-driven 분기

**Files:**
- Modify: `src/app/(admin)/admin/reviews/page.tsx`

- [ ] **Step 1: 페이지 수정**

import 에 신규 쿼리/타입 추가:

```tsx
import {
  listReviewsForAdmin,
  listReviewsWithOpenReports,
} from "@/entities/review";
import { REPORT_REASON_LABELS } from "@/features/review-feed/model/reportSchema";
```

> `REPORT_REASON_LABELS` 는 `features/review-feed/model` 의 pure 모듈(서버/클라 무관, env import 없음)이라 admin 페이지(서버)에서 import 안전. cross-slice 우려: app 레이어는 어떤 feature 든 import 가능(상위 레이어)이므로 FSD 위반 아님.

`AdminReviewsPage` 본문에서 filter==="REPORTED" 분기:

```tsx
export default async function AdminReviewsPage({ searchParams }: PageProps) {
  const { status } = await searchParams;
  const filter = status && isStatus(status) ? status : undefined;
  const isReportedView = filter === "REPORTED";

  const reportedPage = isReportedView
    ? await listReviewsWithOpenReports({ limit: 30 })
    : null;
  const page = isReportedView
    ? null
    : await listReviewsForAdmin({ status: filter, limit: 30 });

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold text-gray-900">리뷰 관리</h1>

      {/* (기존 FILTERS 탭 블록 유지) */}

      {isReportedView ? (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-4 py-2">상품</th>
                <th className="px-4 py-2">작성자</th>
                <th className="px-4 py-2">별점</th>
                <th className="px-4 py-2">신고</th>
                <th className="px-4 py-2">대표 사유</th>
                <th className="px-4 py-2">작성일</th>
              </tr>
            </thead>
            <tbody>
              {reportedPage!.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    처리 대기 중인 신고가 없습니다
                  </td>
                </tr>
              ) : (
                reportedPage!.items.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="px-4 py-2">
                      <Link
                        href={`/admin/reviews/${r.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        {r.productTitle}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{r.authorDisplayName}</td>
                    <td className="px-4 py-2">{r.rating}점</td>
                    <td className="px-4 py-2">
                      <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                        {r.openReportCount}건
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {r.topReason ? REPORT_REASON_LABELS[r.topReason] : "-"}
                    </td>
                    <td className="px-4 py-2">{formatDate(r.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        // (기존 status 테이블 블록 — page!.items 사용하도록 page 변수 참조)
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          {/* 기존 테이블 내용 유지하되 listReviewsForAdmin 결과(page) 사용 */}
        </div>
      )}
    </div>
  );
}
```

> **구현 가이드:** 기존 status 테이블 렌더 블록을 위 `else` 가지로 옮기고, 데이터 소스를 `page!.items` 로 참조. 기존 `page` 변수명이 그대로면 non-null 단언만 추가. "신고됨" 탭은 이제 status 필터가 아니라 OPEN 신고 존재 기준이므로, 행 클릭 시 상세로 이동해 처리한다.

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/admin/reviews/page.tsx"
git commit -m "feat(admin-review): report-driven queue for 신고됨 tab"
```

### Task 4.3: admin 상세 신고 패널 + 처리 버튼

**Files:**
- Modify: `src/app/(admin)/admin/reviews/[id]/page.tsx`

- [ ] **Step 1: 상세 페이지에 신고 패널 추가**

import 보강:

```tsx
import { getReviewForAdmin, getReportsForReview } from "@/entities/review";
import {
  ReviewStatusToggle,
  ReportModerationActions,
} from "@/features/admin-review-moderation";
import { REPORT_REASON_LABELS } from "@/features/review-feed/model/reportSchema";
```

병렬 fetch + 패널 렌더:

```tsx
export default async function AdminReviewDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [review, reports] = await Promise.all([
    getReviewForAdmin(id),
    getReportsForReview(id),
  ]);
  if (!review) notFound();

  const images = review.photos.map((p) => ({
    id: p.id,
    url: reviewPhotoPublicUrl(p.storagePath),
    alt: `후기 사진 ${p.order + 1}`,
  }));

  return (
    <div className="max-w-3xl">
      <Link href="/admin/reviews" className="text-sm text-gray-500 hover:underline">
        ← 리뷰 목록
      </Link>

      {/* 기존 리뷰 본문 카드 블록 유지 (ReviewStatusToggle 포함) */}

      {/* 신고 패널 */}
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">
            신고 {reports.openCount}건 (처리 대기)
          </h2>
          {reports.openCount > 0 && <ReportModerationActions reviewId={review.id} />}
        </div>

        {reports.openCount > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(
              Object.entries(reports.reasonCounts) as [
                keyof typeof REPORT_REASON_LABELS,
                number,
              ][]
            )
              .filter(([, n]) => n > 0)
              .map(([reason, n]) => (
                <span
                  key={reason}
                  className="rounded bg-white px-2 py-1 text-xs text-gray-700"
                >
                  {REPORT_REASON_LABELS[reason]} {n}
                </span>
              ))}
          </div>
        )}

        <ul className="mt-4 space-y-2">
          {reports.entries.map((e) => (
            <li key={e.id} className="rounded border border-gray-200 bg-white p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {REPORT_REASON_LABELS[e.reason]}
                </span>
                <span className="text-xs text-gray-400">
                  {e.reporterDisplayName} ·{" "}
                  {new Date(e.createdAt).toLocaleString("ko-KR")} · {e.status}
                </span>
              </div>
              {e.note && <p className="mt-1 text-gray-600">{e.note}</p>}
            </li>
          ))}
          {reports.entries.length === 0 && (
            <li className="text-sm text-gray-400">신고 이력 없음</li>
          )}
        </ul>
      </div>
    </div>
  );
}
```

> 기존 리뷰 본문 카드 블록(상품명·작성자·content·photos·ReviewStatusToggle)은 그대로 두고, 그 아래에 신고 패널을 추가.

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/admin/reviews/[id]/page.tsx"
git commit -m "feat(admin-review): report panel + moderation actions on detail page"
```

### Task 4.4: 종합 검증 (QA Engineer)

- [ ] **Step 1: 전체 정적 검증**

Run: `npm run typecheck && npm run test && npm run lint`
Expected: 전부 PASS.

- [ ] **Step 2: 빌드 검증 (서버/클라 경계·env 누수)**

Run: `npm run build`
Expected: PASS. PDP·admin 라우트 정상 빌드. (`feedback_run_build_for_boundaries` 메모리 — typecheck/test 만으론 경계 회귀 미검출)

- [ ] **Step 3: admin 런타임 e2e 검증**

`npm run dev` 후 admin 매직링크 로그인(콘솔 `📧 [DEV] Magic link`).
검증:
- 사용자가 신고한 리뷰가 `/admin/reviews?status=REPORTED` 큐에 신고 건수·대표사유와 함께 노출.
- 상세 진입 → "숨기기(신고 인정)" → 리뷰 HIDDEN + 신고 RESOLVED + PDP 에서 사라짐.
- 다른 리뷰 신고 후 "신고 반려" → 신고 DISMISSED + 리뷰 PDP 노출 유지 + 큐에서 제거.

DB 확인:
```bash
npx tsx -e "import {db} from './src/shared/lib/db'; db.reviewReport.groupBy({by:['status'],_count:true}).then(r=>{console.log(r);process.exit(0)})"
```
Expected: OPEN/RESOLVED/DISMISSED 분포가 조작과 일치.

- [ ] **Step 4: 체크박스 누락 점검**

Run: `grep -n "\- \[ \]" docs/superpowers/plans/2026-06-08-review-moderation.md`
Expected: 완료된 Task 의 미체크 항목이 없어야 함(§4.1).

- [ ] **Step 5: 최종 커밋 + CLAUDE.md/ADR 갱신 제안**

- CLAUDE.md §8 "기억해야 할 컨텍스트" 에 Phase 15 완료 1줄 + "다음 작업자 혼란 방지" 노트 추가.
- ADR 발행 제안: `REPORTED status-flip 포기 / ReviewReport 큐 적재` 결정(spec §9). 사용자 승인 시 `docs/superpowers/adr/` 에 작성.

```bash
git add -A
git commit -m "docs(claude): mark Phase 15 review moderation complete"
```

---

## 최종 체크리스트

- [ ] `ReviewReport` 모델 + enum 마이그레이션 적용·resolve
- [ ] `createReviewReport` 멱등(중복 P2002 흡수, self/not_found 가드) + 테스트
- [ ] `resolveReportsByHiding`(단일 tx, 전이 가드) + `dismissReports` + 테스트
- [ ] `listReviewsWithOpenReports` + `getReportsForReview` (마스킹·집계) + 테스트
- [ ] `listReviewsByProduct` viewerId → isOwn + 테스트
- [ ] `reportReviewAction`(rate-limit·auth·Zod) + 테스트
- [ ] `resolveReportsAction`/`dismissReportsAction`(ADMIN 가드·revalidate) + 테스트
- [ ] PDP `ReportReviewButton` 모달(로그인 유도·본인 제외·멱등 토스트·타이머 cleanup)
- [ ] admin "신고됨" 탭 report-driven + 상세 신고 패널 + 처리 버튼
- [ ] typecheck + test + lint + build 전부 PASS
- [ ] admin/사용자 런타임 e2e 증거 수집
- [ ] CLAUDE.md 갱신 + ADR 발행 제안
