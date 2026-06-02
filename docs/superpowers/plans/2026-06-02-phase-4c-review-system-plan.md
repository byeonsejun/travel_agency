# Phase 4-C — Review System Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이미 구현된 리뷰 읽기/쓰기 위에 어드민 모더레이션(PUBLISHED↔HIDDEN) + PDP 더보기 페이지네이션 + 별점 분포·사진 라이트박스를 추가해 리뷰 시스템을 완성한다.

**Architecture:** entities/review에 status 전이 가드·집계 쿼리·뮤테이션을 더하고, shared/ui에 도메인 무지 Lightbox·PhotoGrid를 두며, 두 신규 feature(`review-feed` client island, `admin-review-moderation`)가 이를 조합한다. status 변경 시 PDP ISR(`revalidate=3600`)을 `revalidatePath`로 즉시 무효화한다(submit 액션과 동일 계약).

**Tech Stack:** Next.js 15 App Router(RSC + Server Actions), Prisma 5, Zod 3, Vitest 2, Tailwind, Supabase Storage.

**Spec:** `docs/superpowers/specs/2026-06-02-phase-4c-review-system.md`

---

## File Structure

```
shared/lib/supabase/photoMime.ts          ← + reviewPhotoPublicUrl (client-safe 순수)
shared/lib/supabase/__tests__/photoMime.test.ts   [신규]
shared/ui/Lightbox.tsx                     [신규] "use client"
shared/ui/PhotoGrid.tsx                    [신규] "use client"

entities/review/model/transitions.ts       [신규] assertReviewTransition (순수)
entities/review/model/__tests__/transitions.test.ts          [신규]
entities/review/model/ratingDistribution.ts [신규] normalizeRatingDistribution (순수)
entities/review/model/__tests__/ratingDistribution.test.ts   [신규]
entities/review/api/queries.ts             ← + getReviewRatingDistribution, listReviewsForAdmin, getReviewForAdmin
entities/review/api/mutations.ts           [신규] setReviewStatus
entities/review/index.ts                   ← export 추가

features/review-feed/server/loadMore.ts    [신규] "use server"
features/review-feed/ui/ReviewCard.tsx     [신규]
features/review-feed/ui/ReviewFeed.tsx     [신규] "use client"
features/review-feed/index.ts              [신규]

features/admin-review-moderation/model/schemas.ts            [신규]
features/admin-review-moderation/server/actions.ts           [신규] "use server"
features/admin-review-moderation/server/__tests__/actions.test.ts [신규]
features/admin-review-moderation/ui/ReviewStatusToggle.tsx   [신규] "use client"
features/admin-review-moderation/index.ts                    [신규]

widgets/review-list/ui/RatingDistribution.tsx [신규] RSC
widgets/review-list/ui/ReviewList.tsx       ← 삭제 (ReviewFeed로 대체)
widgets/review-list/index.ts                ← export 갱신

app/(site)/products/[id]/page.tsx           ← ReviewList→ReviewFeed, RatingDistribution 추가
app/(admin)/admin/reviews/page.tsx          [신규] 목록
app/(admin)/admin/reviews/[id]/page.tsx     [신규] 상세
app/(admin)/admin/layout.tsx                ← nav "리뷰 관리" 추가
```

---

## Task 1: client-safe `reviewPhotoPublicUrl` (shared 순수 helper)

**Files:**
- Modify: `src/shared/lib/supabase/photoMime.ts`
- Test: `src/shared/lib/supabase/__tests__/photoMime.test.ts`

- [x] **Step 1: 실패 테스트 작성**

```ts
// src/shared/lib/supabase/__tests__/photoMime.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/shared/lib/env", () => ({
  env: { NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co" },
}));

import { reviewPhotoPublicUrl } from "../photoMime";

describe("reviewPhotoPublicUrl", () => {
  it("버킷·path 를 결합한 public object URL 을 만든다", () => {
    expect(reviewPhotoPublicUrl("review-photos/abc/0.webp")).toBe(
      "https://proj.supabase.co/storage/v1/object/public/product-images/review-photos/abc/0.webp",
    );
  });

  it("env 미설정 시 빈 prefix 로 fallback (로컬/테스트)", async () => {
    vi.resetModules();
    vi.doMock("@/shared/lib/env", () => ({ env: {} }));
    const { reviewPhotoPublicUrl: fn } = await import("../photoMime");
    expect(fn("review-photos/abc/0.webp")).toBe(
      "/storage/v1/object/public/product-images/review-photos/abc/0.webp",
    );
  });
});
```

- [x] **Step 2: 실패 확인**

Run: `npm run test -- src/shared/lib/supabase/__tests__/photoMime.test.ts`
Expected: FAIL — `reviewPhotoPublicUrl is not a function`

- [x] **Step 3: 구현**

`src/shared/lib/supabase/photoMime.ts` 하단에 추가:

```ts
import { env } from "@/shared/lib/env";

// PDP·라이트박스·admin 이 공유하는 client-safe public URL 빌더.
// Supabase public object URL 은 결정적 문자열이라 SDK(server-only) 불필요.
// server-only 인 storage.ts 의 getReviewPhotoPublicUrl 과 동일 결과를 내되,
// 클라이언트 컴포넌트에서도 import 가능 (drift 0).
export function reviewPhotoPublicUrl(path: string): string {
  const base = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/${REVIEW_PHOTO_BUCKET}/${path}`;
}
```

- [x] **Step 4: 통과 확인**

Run: `npm run test -- src/shared/lib/supabase/__tests__/photoMime.test.ts`
Expected: PASS (2 tests)

- [x] **Step 5: 커밋**

```bash
git add src/shared/lib/supabase/photoMime.ts src/shared/lib/supabase/__tests__/photoMime.test.ts
git commit -m "feat(review): client-safe reviewPhotoPublicUrl builder (4C Task 1)"
```

---

## Task 2: 리뷰 status 전이 가드 (entities 순수 로직)

**Files:**
- Create: `src/entities/review/model/transitions.ts`
- Test: `src/entities/review/model/__tests__/transitions.test.ts`

- [x] **Step 1: 실패 테스트 작성**

```ts
// src/entities/review/model/__tests__/transitions.test.ts
import { describe, it, expect } from "vitest";
import {
  assertReviewTransition,
  InvalidReviewTransitionError,
} from "../transitions";

describe("assertReviewTransition", () => {
  it("PUBLISHED ↔ HIDDEN 양방향 허용", () => {
    expect(() => assertReviewTransition("PUBLISHED", "HIDDEN")).not.toThrow();
    expect(() => assertReviewTransition("HIDDEN", "PUBLISHED")).not.toThrow();
  });

  it("REPORTED → PUBLISHED/HIDDEN 허용", () => {
    expect(() => assertReviewTransition("REPORTED", "PUBLISHED")).not.toThrow();
    expect(() => assertReviewTransition("REPORTED", "HIDDEN")).not.toThrow();
  });

  it("동일 상태로의 전이는 거부", () => {
    expect(() => assertReviewTransition("PUBLISHED", "PUBLISHED")).toThrow(
      InvalidReviewTransitionError,
    );
  });

  it("PUBLISHED/HIDDEN → REPORTED 는 거부 (모더레이터가 신고 상태를 만들지 않음)", () => {
    expect(() => assertReviewTransition("PUBLISHED", "REPORTED")).toThrow(
      InvalidReviewTransitionError,
    );
  });
});
```

- [x] **Step 2: 실패 확인**

Run: `npm run test -- src/entities/review/model/__tests__/transitions.test.ts`
Expected: FAIL — cannot find module `../transitions`

- [x] **Step 3: 구현**

```ts
// src/entities/review/model/transitions.ts
import type { ReviewStatus } from "@prisma/client";

// 리뷰 모더레이션 전이 규칙 SSOT. booking 수준 풀 state machine 은 과설계 —
// 상태 3개·전이 단순이라 경량 인접 맵으로 충분.
//  - PUBLISHED ↔ HIDDEN: admin 숨김/복원
//  - REPORTED → PUBLISHED|HIDDEN: 신고 처리 (REPORTED 진입점은 다음 Phase)
// 동일 상태 전이·역방향(→REPORTED)은 금지.
export const ALLOWED_REVIEW_TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  PUBLISHED: ["HIDDEN"],
  HIDDEN: ["PUBLISHED"],
  REPORTED: ["PUBLISHED", "HIDDEN"],
};

export class InvalidReviewTransitionError extends Error {
  constructor(
    public readonly from: ReviewStatus,
    public readonly to: ReviewStatus,
  ) {
    super(`Invalid review status transition: ${from} → ${to}`);
    this.name = "InvalidReviewTransitionError";
  }
}

export function assertReviewTransition(
  from: ReviewStatus,
  to: ReviewStatus,
): void {
  if (!ALLOWED_REVIEW_TRANSITIONS[from].includes(to)) {
    throw new InvalidReviewTransitionError(from, to);
  }
}
```

- [x] **Step 4: 통과 확인**

Run: `npm run test -- src/entities/review/model/__tests__/transitions.test.ts`
Expected: PASS (4 tests)

- [x] **Step 5: 커밋**

```bash
git add src/entities/review/model/transitions.ts src/entities/review/model/__tests__/transitions.test.ts
git commit -m "feat(review): review status transition guard (4C Task 2)"
```

---

## Task 3: 별점 분포 정규화 (entities 순수 로직)

**Files:**
- Create: `src/entities/review/model/ratingDistribution.ts`
- Test: `src/entities/review/model/__tests__/ratingDistribution.test.ts`

- [x] **Step 1: 실패 테스트 작성**

```ts
// src/entities/review/model/__tests__/ratingDistribution.test.ts
import { describe, it, expect } from "vitest";
import {
  normalizeRatingDistribution,
  type RatingGroupRow,
} from "../ratingDistribution";

describe("normalizeRatingDistribution", () => {
  it("groupBy 결과를 1~5 전 키로 정규화 (누락은 0)", () => {
    const rows: RatingGroupRow[] = [
      { rating: 5, _count: { _all: 3 } },
      { rating: 3, _count: { _all: 1 } },
    ];
    expect(normalizeRatingDistribution(rows)).toEqual({
      1: 0, 2: 0, 3: 1, 4: 0, 5: 3,
    });
  });

  it("빈 입력은 전부 0", () => {
    expect(normalizeRatingDistribution([])).toEqual({
      1: 0, 2: 0, 3: 0, 4: 0, 5: 0,
    });
  });
});
```

- [x] **Step 2: 실패 확인**

Run: `npm run test -- src/entities/review/model/__tests__/ratingDistribution.test.ts`
Expected: FAIL — cannot find module

- [x] **Step 3: 구현**

```ts
// src/entities/review/model/ratingDistribution.ts

// Prisma groupBy({ by:['rating'], _count:{_all:true} }) 의 row 모양.
export type RatingGroupRow = {
  rating: number;
  _count: { _all: number };
};

export type RatingDistribution = Record<1 | 2 | 3 | 4 | 5, number>;

// DB 는 존재하는 별점만 반환 → UI 막대가 1~5 전부를 그리도록 누락 키를 0 으로 채운다.
export function normalizeRatingDistribution(
  rows: RatingGroupRow[],
): RatingDistribution {
  const base: RatingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of rows) {
    if (row.rating >= 1 && row.rating <= 5) {
      base[row.rating as 1 | 2 | 3 | 4 | 5] = row._count._all;
    }
  }
  return base;
}
```

- [x] **Step 4: 통과 확인**

Run: `npm run test -- src/entities/review/model/__tests__/ratingDistribution.test.ts`
Expected: PASS (2 tests)

- [x] **Step 5: 커밋**

```bash
git add src/entities/review/model/ratingDistribution.ts src/entities/review/model/__tests__/ratingDistribution.test.ts
git commit -m "feat(review): rating distribution normalizer (4C Task 3)"
```

---

## Task 4: entities/review 신규 쿼리 (집계 + admin 목록/상세)

**Files:**
- Modify: `src/entities/review/api/queries.ts`
- Modify: `src/entities/review/model/types.ts`
- Modify: `src/entities/review/index.ts`

- [x] **Step 1: 타입 추가**

`src/entities/review/model/types.ts` 하단에 추가:

```ts
// admin 모더레이션 목록 row. raw email/name 은 displayName 으로 사전 마스킹.
export type AdminReviewListItem = {
  id: string;
  rating: number;
  status: import("@prisma/client").ReviewStatus;
  createdAt: Date;
  productId: string;
  productTitle: string;
  authorDisplayName: string;
  photoCount: number;
};

export type AdminReviewListPage = {
  items: AdminReviewListItem[];
  nextCursor: string | null;
};

// admin 상세 — 본문·사진 전체·상품 컨텍스트.
export type AdminReviewDetail = {
  id: string;
  rating: number;
  status: import("@prisma/client").ReviewStatus;
  content: string;
  createdAt: Date;
  productId: string;
  productTitle: string;
  authorDisplayName: string;
  photos: Array<{ id: string; storagePath: string; order: number }>;
};
```

- [x] **Step 2: 쿼리 구현**

`src/entities/review/api/queries.ts` 의 import 에 추가:

```ts
import { normalizeRatingDistribution, type RatingDistribution } from "../model/ratingDistribution";
import type { AdminReviewListPage, AdminReviewDetail } from "../model/types";
import type { ReviewStatus } from "@prisma/client";
```

파일 하단에 추가:

```ts
// PDP 별점 분포 그래프용. groupBy 단일 집계 — row 페치 0건. PUBLISHED 만.
export async function getReviewRatingDistribution(
  productId: string,
): Promise<RatingDistribution> {
  const rows = await db.review.groupBy({
    by: ["rating"],
    where: { productId, status: "PUBLISHED" },
    _count: { _all: true },
  });
  return normalizeRatingDistribution(rows);
}

// admin 모더레이션 목록. status 무관(또는 단일 status 필터) — 숨김/신고도 노출.
// 커서 (createdAt desc, id desc) — PDP 쿼리와 동일 안정 정렬.
export async function listReviewsForAdmin(opts: {
  status?: ReviewStatus;
  cursor?: string;
  limit?: number;
} = {}): Promise<AdminReviewListPage> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const rows = await db.review.findMany({
    where: opts.status ? { status: opts.status } : {},
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
      _count: { select: { photos: true } },
    },
  });

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const items = sliced.map((r) => ({
    id: r.id,
    rating: r.rating,
    status: r.status,
    createdAt: r.createdAt,
    productId: r.productId,
    productTitle: r.product.title,
    authorDisplayName: maskAuthorDisplayName({
      email: r.user.email,
      name: r.user.name,
    }),
    photoCount: r._count.photos,
  }));

  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

// admin 상세 — 단건 + 사진 전체 + 상품 컨텍스트.
export async function getReviewForAdmin(
  id: string,
): Promise<AdminReviewDetail | null> {
  const r = await db.review.findUnique({
    where: { id },
    select: {
      id: true,
      rating: true,
      status: true,
      content: true,
      createdAt: true,
      productId: true,
      product: { select: { title: true } },
      user: { select: { name: true, email: true } },
      photos: {
        orderBy: { order: "asc" },
        select: { id: true, storagePath: true, order: true },
      },
    },
  });
  if (!r) return null;
  return {
    id: r.id,
    rating: r.rating,
    status: r.status,
    content: r.content,
    createdAt: r.createdAt,
    productId: r.productId,
    productTitle: r.product.title,
    authorDisplayName: maskAuthorDisplayName({
      email: r.user.email,
      name: r.user.name,
    }),
    photos: r.photos,
  };
}
```

- [x] **Step 3: barrel export 갱신**

`src/entities/review/index.ts` 수정:

```ts
export { ReviewInputSchema } from "./model/validation";
export type { ReviewInput } from "./model/validation";

export {
  assertReviewTransition,
  InvalidReviewTransitionError,
  ALLOWED_REVIEW_TRANSITIONS,
} from "./model/transitions";
export {
  normalizeRatingDistribution,
  type RatingDistribution,
} from "./model/ratingDistribution";

export type {
  ReviewListItem,
  ReviewListPage,
  ReviewStats,
  ReviewWithPhotos,
  AdminReviewListItem,
  AdminReviewListPage,
  AdminReviewDetail,
} from "./model/types";

export {
  getProductReviewStats,
  getReviewByBooking,
  getReviewedBookingIds,
  listReviewsByProduct,
  getReviewRatingDistribution,
  listReviewsForAdmin,
  getReviewForAdmin,
} from "./api/queries";
```

- [x] **Step 4: typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors)

- [x] **Step 5: 커밋**

```bash
git add src/entities/review/
git commit -m "feat(review): rating distribution + admin list/detail queries (4C Task 4)"
```

---

## Task 5: entities/review setReviewStatus 뮤테이션

**Files:**
- Create: `src/entities/review/api/mutations.ts`
- Modify: `src/entities/review/index.ts`

- [x] **Step 1: 구현 (DB 의존 — 단위 테스트는 Task 10 서버 액션에서 mock 으로 커버)**

```ts
// src/entities/review/api/mutations.ts
import type { ReviewStatus } from "@prisma/client";
import { db } from "@/shared/lib/db";
import { assertReviewTransition } from "../model/transitions";

// 모더레이션 status 변경. 돈·좌석이 아니라 admin 단독 작업이므로 TOCTOU 비크리티컬 —
// 현재 status 조회 → 전이 가드 → update 의 단순 흐름으로 충분.
// 캐시 무효화에 쓸 productId 를 반환한다 (호출 feature 가 revalidatePath).
// 리뷰 부재 시 null 반환.
export async function setReviewStatus(
  id: string,
  next: ReviewStatus,
): Promise<{ productId: string } | null> {
  const current = await db.review.findUnique({
    where: { id },
    select: { status: true, productId: true },
  });
  if (!current) return null;

  assertReviewTransition(current.status, next); // 위반 시 throw

  await db.review.update({
    where: { id },
    data: { status: next },
  });
  return { productId: current.productId };
}
```

- [x] **Step 2: barrel export 추가**

`src/entities/review/index.ts` 의 queries export 블록 아래에 추가:

```ts
export { setReviewStatus } from "./api/mutations";
```

- [x] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: PASS

- [x] **Step 4: 커밋**

```bash
git add src/entities/review/api/mutations.ts src/entities/review/index.ts
git commit -m "feat(review): setReviewStatus mutation with transition guard (4C Task 5)"
```

---

## Task 6: shared/ui Lightbox (도메인 무지 모달 뷰어)

**Files:**
- Create: `src/shared/ui/Lightbox.tsx`

- [ ] **Step 1: 구현**

```tsx
// src/shared/ui/Lightbox.tsx
"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";

export type LightboxImage = { id: string; url: string; alt: string };

type Props = {
  images: LightboxImage[];
  index: number;
  onClose: () => void;
  onIndexChange: (next: number) => void;
};

// 도메인 무지 이미지 라이트박스. PDP 리뷰 피드·admin 상세가 공유.
// 메모리 누수 차단(프론트 영구 수칙): keydown 리스너·body scroll lock 은
// effect cleanup 에서 반드시 원복.
export function Lightbox({ images, index, onClose, onIndexChange }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight")
        onIndexChange((index + 1) % images.length);
      else if (e.key === "ArrowLeft")
        onIndexChange((index - 1 + images.length) % images.length);
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [index, images.length, onClose, onIndexChange]);

  const current = images[index];
  if (!current) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="사진 확대 보기"
      tabIndex={-1}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="닫기"
        className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1 text-white hover:bg-white/20"
      >
        ✕
      </button>

      <div
        onClick={(e) => e.stopPropagation()}
        className="relative h-[80vh] w-full max-w-4xl"
      >
        <Image
          src={current.url}
          alt={current.alt}
          fill
          sizes="(min-width: 768px) 896px, 100vw"
          className="object-contain transition-transform duration-200"
        />
      </div>

      {images.length > 1 && (
        <>
          <button
            type="button"
            aria-label="이전 사진"
            onClick={(e) => {
              e.stopPropagation();
              onIndexChange((index - 1 + images.length) % images.length);
            }}
            className="absolute left-4 rounded-full bg-white/10 px-4 py-2 text-2xl text-white hover:bg-white/20"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="다음 사진"
            onClick={(e) => {
              e.stopPropagation();
              onIndexChange((index + 1) % images.length);
            }}
            className="absolute right-4 rounded-full bg-white/10 px-4 py-2 text-2xl text-white hover:bg-white/20"
          >
            ›
          </button>
          <span className="absolute bottom-4 rounded-full bg-black/50 px-3 py-1 text-sm text-white">
            {index + 1} / {images.length}
          </span>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: 커밋**

```bash
git add src/shared/ui/Lightbox.tsx
git commit -m "feat(ui): domain-agnostic Lightbox with keyboard nav + scroll lock (4C Task 6)"
```

---

## Task 7: shared/ui PhotoGrid (썸네일 그리드 → Lightbox)

**Files:**
- Create: `src/shared/ui/PhotoGrid.tsx`

- [ ] **Step 1: 구현**

```tsx
// src/shared/ui/PhotoGrid.tsx
"use client";

import { useState } from "react";
import Image from "next/image";
import { Lightbox, type LightboxImage } from "./Lightbox";

type Props = {
  images: LightboxImage[];
};

// 자기완결형 썸네일 그리드. 클릭 시 자체 state 로 Lightbox 오픈.
// PDP 리뷰 카드·admin 상세 양쪽이 콜백 없이 그대로 사용 (review-feed/admin 무관).
export function PhotoGrid({ images }: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (images.length === 0) return null;

  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {images.map((img, i) => (
          <button
            type="button"
            key={img.id}
            onClick={() => setOpenIndex(i)}
            className="relative aspect-square overflow-hidden rounded-lg border border-gray-100"
            aria-label={`${img.alt} 확대`}
          >
            <Image
              src={img.url}
              alt={img.alt}
              fill
              sizes="(min-width: 640px) 120px, 33vw"
              className="object-cover transition-transform duration-150 hover:scale-105"
            />
          </button>
        ))}
      </div>

      {openIndex !== null && (
        <Lightbox
          images={images}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
          onIndexChange={setOpenIndex}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: 커밋**

```bash
git add src/shared/ui/PhotoGrid.tsx
git commit -m "feat(ui): self-contained PhotoGrid opening Lightbox (4C Task 7)"
```

---

## Task 8: features/review-feed (PDP 더보기 island)

**Files:**
- Create: `src/features/review-feed/server/loadMore.ts`
- Create: `src/features/review-feed/ui/ReviewCard.tsx`
- Create: `src/features/review-feed/ui/ReviewFeed.tsx`
- Create: `src/features/review-feed/index.ts`

- [ ] **Step 1: 서버 액션 (더보기 페치)**

```ts
// src/features/review-feed/server/loadMore.ts
"use server";

import { z } from "zod";
import { listReviewsByProduct, type ReviewListPage } from "@/entities/review";

const InputSchema = z.object({
  productId: z.string().cuid(),
  cursor: z.string().min(1),
});

// PDP "더보기" — nextCursor 를 받아 다음 10건 반환. PUBLISHED 필터는 쿼리에 내장
// (admin 이 숨긴 리뷰는 더보기로도 안 나옴 — 노출 일관성). 캐시 비대상 실시간 쿼리.
export async function loadMoreReviewsAction(
  productId: string,
  cursor: string,
): Promise<ReviewListPage> {
  const parsed = InputSchema.safeParse({ productId, cursor });
  if (!parsed.success) {
    return { items: [], nextCursor: null };
  }
  return listReviewsByProduct(parsed.data.productId, {
    limit: 10,
    cursor: parsed.data.cursor,
  });
}
```

- [ ] **Step 2: ReviewCard (presentational)**

```tsx
// src/features/review-feed/ui/ReviewCard.tsx
"use client";

import type { ReviewListItem } from "@/entities/review";
import { reviewPhotoPublicUrl } from "@/shared/lib/supabase/photoMime";
import { PhotoGrid } from "@/shared/ui/PhotoGrid";

function Stars({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${value}점`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          viewBox="0 0 20 20"
          aria-hidden="true"
          className={`h-4 w-4 ${n <= value ? "fill-amber-400" : "fill-gray-200"}`}
        >
          <path d="M9.05.927C9.349.012 10.651.012 10.95.927l1.713 5.272a1 1 0 00.95.69h5.546c.962 0 1.362 1.232.586 1.798l-4.488 3.26a1 1 0 00-.364 1.118l1.713 5.272c.299.916-.756 1.677-1.539 1.118l-4.488-3.26a1 1 0 00-1.175 0l-4.488 3.26c-.783.56-1.838-.202-1.539-1.118l1.713-5.272a1 1 0 00-.364-1.118L2.255 8.687c-.776-.566-.377-1.798.586-1.798h5.547a1 1 0 00.949-.69L9.05.927z" />
        </svg>
      ))}
    </div>
  );
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// 작성자 displayName 은 entities query 레이어에서 사전 마스킹됨 — raw PII 미수신.
export function ReviewCard({ review }: { review: ReviewListItem }) {
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

- [ ] **Step 3: ReviewFeed (client island, 누적 + 더보기)**

```tsx
// src/features/review-feed/ui/ReviewFeed.tsx
"use client";

import { useState, useTransition } from "react";
import type { ReviewListItem } from "@/entities/review";
import { loadMoreReviewsAction } from "../server/loadMore";
import { ReviewCard } from "./ReviewCard";

type Props = {
  productId: string;
  initialItems: ReviewListItem[];
  initialCursor: string | null;
};

// 첫 페이지(10건)는 PDP(RSC)가 prerender 로 전달 → SEO/초기 페인트 보존.
// "더보기"만 client 에서 server action 으로 추가 로드·누적.
export function ReviewFeed({ productId, initialItems, initialCursor }: Props) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [isPending, startTransition] = useTransition();

  if (items.length === 0) return null;

  function loadMore() {
    if (!cursor) return;
    startTransition(async () => {
      const page = await loadMoreReviewsAction(productId, cursor);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    });
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-4">
        {items.map((r) => (
          <ReviewCard key={r.id} review={r} />
        ))}
      </ul>
      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={isPending}
          className="w-full rounded-lg border border-gray-300 bg-white py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {isPending ? "불러오는 중…" : "후기 더보기"}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: barrel**

```ts
// src/features/review-feed/index.ts
export { ReviewFeed } from "./ui/ReviewFeed";
```

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/features/review-feed/
git commit -m "feat(review): PDP load-more feed island consuming nextCursor (4C Task 8)"
```

---

## Task 9: PDP 배선 — ReviewFeed 교체 + RatingDistribution + ReviewList 폐기

**Files:**
- Create: `src/widgets/review-list/ui/RatingDistribution.tsx`
- Delete: `src/widgets/review-list/ui/ReviewList.tsx`
- Modify: `src/widgets/review-list/index.ts`
- Modify: `src/app/(site)/products/[id]/page.tsx`

- [ ] **Step 1: RatingDistribution 위젯 (RSC)**

```tsx
// src/widgets/review-list/ui/RatingDistribution.tsx
import type { RatingDistribution as Dist } from "@/entities/review";

type Props = {
  distribution: Dist;
  total: number;
};

// PDP 별점 분포 막대. 5→1 역순. total=0 이면 ReviewStatsBar 가 "후기 없음" 을
// 이미 처리하므로 렌더 생략. props 만 받는 stateless RSC.
export function RatingDistribution({ distribution, total }: Props) {
  if (total === 0) return null;

  const order = [5, 4, 3, 2, 1] as const;
  return (
    <div className="space-y-1.5 rounded-lg border border-gray-200 bg-white px-4 py-3">
      {order.map((star) => {
        const count = distribution[star];
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <div key={star} className="flex items-center gap-2 text-xs">
            <span className="w-8 shrink-0 text-gray-500">{star}점</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-amber-400"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-gray-400">
              {count}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: ReviewList 위젯 삭제 + barrel 갱신**

```bash
git rm src/widgets/review-list/ui/ReviewList.tsx
```

`src/widgets/review-list/index.ts` 를 다음으로 교체:

```ts
export { ReviewStatsBar } from "./ui/ReviewStatsBar";
export { RatingDistribution } from "./ui/RatingDistribution";
```

- [ ] **Step 3: PDP page.tsx 배선**

`src/app/(site)/products/[id]/page.tsx` 수정 — import 블록:

```tsx
import { notFound } from "next/navigation";
import { getProductById, getAllPublishedProductIds } from "@/entities/product";
import { getDeparturesByProduct } from "@/entities/departure";
import {
  getProductReviewStats,
  listReviewsByProduct,
  getReviewRatingDistribution,
} from "@/entities/review";
import { ProductDetail } from "@/widgets/product-detail/ui/ProductDetail";
import { ReviewStatsBar, RatingDistribution } from "@/widgets/review-list";
import { ReviewFeed } from "@/features/review-feed";
import {
  CompareToggleButton,
  FloatingCompareCart,
} from "@/features/product-compare";
```

`Promise.all` + JSX 부분 수정:

```tsx
  const [product, departures, reviewStats, reviewPage, ratingDist] =
    await Promise.all([
      getProductById(id),
      getDeparturesByProduct(id),
      getProductReviewStats(id),
      listReviewsByProduct(id, { limit: 10 }),
      getReviewRatingDistribution(id),
    ]);

  if (product === null) {
    notFound();
  }

  return (
    <>
      <ProductDetail
        product={product}
        departures={departures}
        compareButton={<CompareToggleButton productId={id} size="md" />}
        reviewsSection={
          <div className="space-y-4">
            <ReviewStatsBar avg={reviewStats.avg} count={reviewStats.count} />
            <RatingDistribution
              distribution={ratingDist}
              total={reviewStats.count}
            />
            <ReviewFeed
              productId={id}
              initialItems={reviewPage.items}
              initialCursor={reviewPage.nextCursor}
            />
          </div>
        }
      />
      <FloatingCompareCart />
    </>
  );
```

- [ ] **Step 4: typecheck + 잔여 ReviewList 참조 확인**

Run: `npm run typecheck && grep -rn "ReviewList" src/ || echo "no ReviewList refs"`
Expected: typecheck PASS, `ReviewList` 참조 0건 (또는 주석만)

- [ ] **Step 5: 커밋**

```bash
git add src/widgets/review-list/ src/app/\(site\)/products/\[id\]/page.tsx
git commit -m "feat(review): wire ReviewFeed + RatingDistribution into PDP, retire ReviewList (4C Task 9)"
```

---

## Task 10: features/admin-review-moderation (토글 액션 + UI)

**Files:**
- Create: `src/features/admin-review-moderation/model/schemas.ts`
- Create: `src/features/admin-review-moderation/server/actions.ts`
- Create: `src/features/admin-review-moderation/server/__tests__/actions.test.ts`
- Create: `src/features/admin-review-moderation/ui/ReviewStatusToggle.tsx`
- Create: `src/features/admin-review-moderation/index.ts`

- [ ] **Step 1: Zod 스키마**

```ts
// src/features/admin-review-moderation/model/schemas.ts
import { z } from "zod";

// admin 은 PUBLISHED|HIDDEN 으로만 전환 (REPORTED 는 시스템/신고 경로 전용).
export const SetReviewStatusSchema = z.object({
  reviewId: z.string().cuid(),
  next: z.enum(["PUBLISHED", "HIDDEN"]),
});

export type SetReviewStatusInput = z.infer<typeof SetReviewStatusSchema>;
```

- [ ] **Step 2: 실패 테스트 작성 (서버 액션)**

```ts
// src/features/admin-review-moderation/server/__tests__/actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  setReviewStatus: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/features/auth/server/auth", () => ({ auth: mocks.auth }));
vi.mock("@/entities/review", () => ({
  setReviewStatus: mocks.setReviewStatus,
  InvalidReviewTransitionError: class extends Error {},
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { setReviewStatusAction } from "../actions";

const VALID_ID = "clxreview0000000000000000";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setReviewStatusAction", () => {
  it("비-admin 은 거부", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1", role: "USER" } });
    const res = await setReviewStatusAction(null, {
      reviewId: VALID_ID,
      next: "HIDDEN",
    });
    expect(res.type).toBe("error");
    expect(mocks.setReviewStatus).not.toHaveBeenCalled();
  });

  it("성공 시 productId PDP + admin 경로 무효화", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    mocks.setReviewStatus.mockResolvedValue({ productId: "prod123" });
    const res = await setReviewStatusAction(null, {
      reviewId: VALID_ID,
      next: "HIDDEN",
    });
    expect(res).toEqual({ type: "success", status: "HIDDEN" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/products/prod123");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/reviews");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      `/admin/reviews/${VALID_ID}`,
    );
  });

  it("리뷰 부재(null) 시 error", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    mocks.setReviewStatus.mockResolvedValue(null);
    const res = await setReviewStatusAction(null, {
      reviewId: VALID_ID,
      next: "HIDDEN",
    });
    expect(res.type).toBe("error");
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm run test -- src/features/admin-review-moderation/server/__tests__/actions.test.ts`
Expected: FAIL — cannot find module `../actions`

- [ ] **Step 4: 서버 액션 구현**

```ts
// src/features/admin-review-moderation/server/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/features/auth/server/auth";
import { setReviewStatus, InvalidReviewTransitionError } from "@/entities/review";
import { SetReviewStatusSchema, type SetReviewStatusInput } from "../model/schemas";

export type SetReviewStatusState =
  | { type: "success"; status: "PUBLISHED" | "HIDDEN" }
  | { type: "error"; message: string };

// admin 리뷰 모더레이션 토글. admin-booking-cancel 과 동일한 게이트 패턴.
// 핵심: status 변경 후 PDP ISR(revalidate=3600) 를 즉시 무효화 (스펙 D2) —
// 숨김 즉시 PDP 에서 사라지고, 복원 즉시 다시 노출.
export async function setReviewStatusAction(
  _prev: SetReviewStatusState | null,
  input: SetReviewStatusInput,
): Promise<SetReviewStatusState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { type: "error", message: "관리자 로그인이 필요합니다" };
  }
  if (session.user.role !== "ADMIN") {
    return { type: "error", message: "관리자 권한이 필요합니다" };
  }

  const parsed = SetReviewStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { type: "error", message: "입력값을 확인해 주세요" };
  }
  const { reviewId, next } = parsed.data;

  try {
    const result = await setReviewStatus(reviewId, next);
    if (!result) {
      return { type: "error", message: "리뷰를 찾을 수 없습니다" };
    }

    revalidatePath(`/products/${result.productId}`);
    revalidatePath("/admin/reviews");
    revalidatePath(`/admin/reviews/${reviewId}`);

    return { type: "success", status: next };
  } catch (err) {
    if (err instanceof InvalidReviewTransitionError) {
      return { type: "error", message: "현재 상태에서는 변경할 수 없습니다" };
    }
    return {
      type: "error",
      message: "상태 변경에 실패했습니다. 잠시 후 다시 시도해 주세요",
    };
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm run test -- src/features/admin-review-moderation/server/__tests__/actions.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: 토글 UI (client)**

```tsx
// src/features/admin-review-moderation/ui/ReviewStatusToggle.tsx
"use client";

import { useActionState } from "react";
import type { ReviewStatus } from "@prisma/client";
import { setReviewStatusAction, type SetReviewStatusState } from "../server/actions";

type Props = {
  reviewId: string;
  status: ReviewStatus;
};

// 현재 status 기준으로 반대 동작 버튼 노출. PUBLISHED→숨김, HIDDEN/REPORTED→공개.
export function ReviewStatusToggle({ reviewId, status }: Props) {
  const [state, formAction, isPending] = useActionState<
    SetReviewStatusState | null,
    FormData
  >(
    async (_prev, formData) => {
      const next = formData.get("next") as "PUBLISHED" | "HIDDEN";
      return setReviewStatusAction(_prev, { reviewId, next });
    },
    null,
  );

  // 낙관적 표시는 생략 — 액션 성공 시 revalidatePath 로 서버가 최신 status 재렌더.
  const next = status === "PUBLISHED" ? "HIDDEN" : "PUBLISHED";
  const label = status === "PUBLISHED" ? "숨기기" : "공개로 전환";

  return (
    <form action={formAction} className="flex items-center gap-3">
      <input type="hidden" name="next" value={next} />
      <button
        type="submit"
        disabled={isPending}
        className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
          status === "PUBLISHED"
            ? "bg-gray-700 hover:bg-gray-800"
            : "bg-green-600 hover:bg-green-700"
        }`}
      >
        {isPending ? "처리 중…" : label}
      </button>
      {state?.type === "error" && (
        <span className="text-sm text-red-600">{state.message}</span>
      )}
    </form>
  );
}
```

- [ ] **Step 7: barrel**

```ts
// src/features/admin-review-moderation/index.ts
export { ReviewStatusToggle } from "./ui/ReviewStatusToggle";
```

- [ ] **Step 8: typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 9: 커밋**

```bash
git add src/features/admin-review-moderation/
git commit -m "feat(admin-review): moderation toggle action + UI with PDP ISR invalidation (4C Task 10)"
```

---

## Task 11: admin 페이지 (목록 + 상세) + nav

**Files:**
- Create: `src/app/(admin)/admin/reviews/page.tsx`
- Create: `src/app/(admin)/admin/reviews/[id]/page.tsx`
- Modify: `src/app/(admin)/admin/layout.tsx`

- [ ] **Step 1: 목록 페이지**

```tsx
// src/app/(admin)/admin/reviews/page.tsx
import Link from "next/link";
import type { ReviewStatus } from "@prisma/client";
import { listReviewsForAdmin } from "@/entities/review";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<ReviewStatus, string> = {
  PUBLISHED: "공개",
  HIDDEN: "숨김",
  REPORTED: "신고됨",
};
const STATUS_BADGE: Record<ReviewStatus, string> = {
  PUBLISHED: "bg-green-100 text-green-800",
  HIDDEN: "bg-gray-200 text-gray-700",
  REPORTED: "bg-amber-100 text-amber-800",
};
const FILTERS = [
  { value: "", label: "전체" },
  { value: "PUBLISHED", label: "공개" },
  { value: "HIDDEN", label: "숨김" },
  { value: "REPORTED", label: "신고됨" },
] as const;

function isStatus(s: string): s is ReviewStatus {
  return s === "PUBLISHED" || s === "HIDDEN" || s === "REPORTED";
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type PageProps = {
  searchParams: Promise<{ status?: string }>;
};

export default async function AdminReviewsPage({ searchParams }: PageProps) {
  const { status } = await searchParams;
  const filter = status && isStatus(status) ? status : undefined;
  const page = await listReviewsForAdmin({ status: filter, limit: 30 });

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold text-gray-900">리뷰 관리</h1>

      <div className="mb-4 flex gap-2">
        {FILTERS.map((f) => {
          const active = (status ?? "") === f.value;
          return (
            <Link
              key={f.value}
              href={f.value ? `/admin/reviews?status=${f.value}` : "/admin/reviews"}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                active ? "bg-red-600 text-white" : "bg-white text-gray-700 hover:bg-gray-100"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2">상품</th>
              <th className="px-4 py-2">작성자</th>
              <th className="px-4 py-2">별점</th>
              <th className="px-4 py-2">사진</th>
              <th className="px-4 py-2">상태</th>
              <th className="px-4 py-2">작성일</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {page.items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  표시할 리뷰가 없습니다.
                </td>
              </tr>
            ) : (
              page.items.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="max-w-xs truncate px-4 py-2">{r.productTitle}</td>
                  <td className="px-4 py-2">{r.authorDisplayName}</td>
                  <td className="px-4 py-2">{r.rating}점</td>
                  <td className="px-4 py-2">{r.photoCount}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[r.status]}`}>
                      {STATUS_LABELS[r.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-500">{formatDate(r.createdAt)}</td>
                  <td className="px-4 py-2">
                    <Link href={`/admin/reviews/${r.id}`} className="text-red-600 hover:underline">
                      상세
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 상세 페이지**

```tsx
// src/app/(admin)/admin/reviews/[id]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { getReviewForAdmin } from "@/entities/review";
import { reviewPhotoPublicUrl } from "@/shared/lib/supabase/photoMime";
import { PhotoGrid } from "@/shared/ui/PhotoGrid";
import { ReviewStatusToggle } from "@/features/admin-review-moderation";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function AdminReviewDetailPage({ params }: PageProps) {
  const { id } = await params;
  const review = await getReviewForAdmin(id);
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

      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-gray-500">{review.productTitle}</p>
            <p className="mt-1 font-medium text-gray-900">
              {review.authorDisplayName} · {review.rating}점
            </p>
          </div>
          <ReviewStatusToggle reviewId={review.id} status={review.status} />
        </div>

        <p className="mt-4 whitespace-pre-wrap text-sm text-gray-700">
          {review.content}
        </p>

        {images.length > 0 && (
          <div className="mt-6">
            <p className="mb-2 text-xs font-medium text-gray-500">
              첨부 사진 {images.length}장
            </p>
            <PhotoGrid images={images} />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: admin nav 링크 추가**

`src/app/(admin)/admin/layout.tsx` 의 nav 에서 "취소 배치" Link 바로 뒤(닫는 `</nav>` 직전)에 추가:

```tsx
              <Link
                href="/admin/reviews"
                className="rounded-md px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-100"
              >
                리뷰 관리
              </Link>
```

- [ ] **Step 4: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/app/\(admin\)/admin/reviews/ src/app/\(admin\)/admin/layout.tsx
git commit -m "feat(admin-review): moderation list + detail pages + nav (4C Task 11)"
```

---

## Task 12: 종합 검증 (QA 증거 수집)

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 전체 typecheck**

Run: `npm run typecheck`
Expected: PASS (0 errors)

- [ ] **Step 2: 전체 테스트**

Run: `npm run test`
Expected: PASS — 신규 테스트(photoMime / transitions / ratingDistribution / admin-review actions) 포함 전체 그린

- [ ] **Step 3: lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 4: 잔여 참조·금지 패턴 점검**

Run: `grep -rn "ReviewList" src/ ; grep -rn "as any\|@ts-ignore\|process.env" src/features/review-feed src/features/admin-review-moderation src/shared/ui/Lightbox.tsx src/shared/ui/PhotoGrid.tsx`
Expected: ReviewList 참조 0건(주석 제외), 금지 패턴 0건

- [ ] **Step 5: 수동 확인 절차 (자동화 불가 — 사용자 요청)**

dev 서버 기동(`npm run dev`) 후 admin 로그인(시드 `admin@nextour.test`, 콘솔 매직링크):
1. `/admin/reviews` → 목록·필터(공개/숨김/신고됨) 동작, 사진 개수 표시 확인.
2. 임의 리뷰 `상세` → 사진 격자 클릭 시 라이트박스 확대 + ←/→/Esc 동작.
3. "숨기기" 클릭 → 해당 상품 PDP(`/products/<id>`) 새로고침 시 그 리뷰가 사라지는지(ISR 무효화) 확인.
4. PDP 리뷰가 10건 초과인 상품에서 "후기 더보기" 클릭 → 추가 로드·누적 확인.
5. 별점 분포 막대가 ReviewStatsBar 아래 노출되는지 확인.

실패 시 스크린샷·콘솔 로그 첨부.

- [ ] **Step 6: plan 체크박스 반영 확인 후 최종 커밋**

Run: `grep -n "\- \[ \]" docs/superpowers/plans/2026-06-02-phase-4c-review-system-plan.md`
Expected: 완료 태스크에 미체크 항목 없음 (§4.1 규칙)

```bash
git add docs/superpowers/plans/2026-06-02-phase-4c-review-system-plan.md
git commit -m "docs(plan): mark Phase 4-C tasks complete + QA evidence (4C Task 12)"
```

---

## Self-Review 결과 (작성자 점검)

- **Spec coverage:** ① 어드민 모더레이션=Task 4·5·10·11, ② PDP 더보기=Task 8·9, ③ 통계 분포=Task 3·9, 라이트박스=Task 6·7. ISR 무효화 계약(D2)=Task 10. client-safe URL(D3)=Task 1. 전 요구사항 매핑 완료.
- **Type consistency:** `RatingDistribution`(entities export) ↔ widget import 일치, `ReviewListItem`/`ReviewListPage`(기존) 재사용, `SetReviewStatusState` 액션↔UI 일치, `LightboxImage` shared 내 일치.
- **Placeholder scan:** 모든 step 에 실제 코드/명령 포함. 미해결 TODO 없음.
- **범위 외 재확인:** `REPORTED` 진입점·리뷰 수정/삭제·orphan cron 미포함 (스펙 §8 일치).
