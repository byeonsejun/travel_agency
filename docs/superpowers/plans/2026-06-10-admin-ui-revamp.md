# Admin 셸 A1 클린 블루 UI 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `(admin)` 셸을 `(site)`와 동일한 A1 클린 블루 디자인 시스템으로 통일한다 (백엔드·도메인 로직 0줄 변경, 순수 프레젠테이션 레이어만 교체).

**Architecture:** (Phase 1) `shared/ui`에 도메인 무지한 `Table` 프리미티브 신설 + `Badge`에 의미색 tone 5종 확장 + admin layout 토큰화. (Phase 2) 8개 nav 섹션을 순차 이관 — 각 페이지는 enum→tone 매핑(라벨 보존)으로 상태색을 표현하고 무의미 색은 토큰으로 전환.

**Tech Stack:** Next.js 15(App Router), React 19, Tailwind CSS(HSL 토큰), shadcn/ui(cva), Vitest 2(happy-dom, `createRoot`+`act` 패턴), TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-06-10-admin-ui-revamp.md`

---

## 핵심 참조 (모든 Task 공통)

### 토큰 매핑 (무의미 색 → 토큰) — 표지판 기둥
| 레거시 리터럴 | → A1 토큰/프리미티브 |
|---|---|
| `text-red-700`(브랜드) | `text-primary` |
| `bg-indigo-600 ... text-white`(1차 액션) | `<Button>` (variant 기본 = primary) |
| `bg-indigo-50 text-indigo-700`(보조 액션) | `<Button variant="secondary">` 또는 `variant="outline"` |
| `bg-gray-50`(셸 배경) | `bg-muted` |
| `bg-white`(카드/패널) | `bg-card` 또는 `<Card>` |
| `border-gray-200` / `border-gray-100` | `border-border` |
| `text-gray-900` | `text-foreground` |
| `text-gray-500` / `text-gray-400` | `text-muted-foreground` |
| `ring-1 ring-gray-200` | `border border-border` |

### tone 매핑 (의미 색 → 리터럴 보존) — 신호등
| Prisma enum 값 | tone |
|---|---|
| `PUBLISHED` `SUCCEEDED` `PAID` `CONFIRMED` `READY` `COMPLETED` | `success` |
| `DRAFT` `PENDING` `AWAITING_GROUP` `REPORTED` | `warning` |
| `IN_PROGRESS` `DEPARTURE_CONFIRMED` `PARTIAL_CANCELED` `SCHEDULED` `PROCESSING` | `info` |
| `FAILED` `CANCELED_BY_USER` `CANCELED_BY_AGENCY` `PARTIALLY_FAILED` | `destructive` |
| `CLOSED` `CANCELED` `HIDDEN` `RECEIVED` | `neutral` |

> 라벨(한글 텍스트)은 각 페이지의 기존 `*_LABELS` 상수를 **그대로 보존**한다. 이번 작업은 *색*만 tone으로 교체.

### import 컨벤션
- 배럴 없음 → 직접 경로: `import { Table, TableHeader, ... } from "@/shared/ui/table"`, `import { Badge } from "@/shared/ui/badge"`.

### 절대 규칙 (매 Task 자가 점검)
- 🏛️ `(admin)` page.tsx/layout.tsx에 `'use client'` 금지 (기존 server 유지).
- 🎨 client island이 `@/shared/lib/env`·entities 배럴 import 금지 (번들 누출 → ZodError 사고 이력).
- 의미색을 토큰으로 잘못 전환 금지 ("이 색이 상태를 전달하는가?" → 예면 tone 유지).
- 도메인 enum→tone 결정은 페이지/island(도메인 인지 레이어)가 수행. `shared/ui`는 tone 추상만 안다.

---

# PHASE 1 — 기반 구축 (프리미티브 + 레이아웃)

> 페이지 본문은 아직 레거시. 레이아웃/nav만 A1로 전환되는 과도기가 의도적으로 잠시 존재.

## Task 1: `Table` 프리미티브 신설

**Files:**
- Create: `src/shared/ui/table.tsx`
- Test: `src/shared/ui/__tests__/table.test.tsx`

- [x] **Step 1: 실패하는 테스트 작성**

```tsx
// src/shared/ui/__tests__/table.test.tsx
import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../table";

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("<Table />", () => {
  it("토큰 기반 클래스로 table 구조를 렌더하고 className 을 병합한다", () => {
    const container = document.createElement("div");
    root = createRoot(container);
    act(() => {
      root!.render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>상품명</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="text-right">값</TableCell>
            </TableRow>
          </TableBody>
        </Table>,
      );
    });
    const table = container.querySelector("table") as HTMLElement;
    expect(table).not.toBeNull();
    expect(table.className).toContain("w-full");
    // 헤더 배경에 muted 토큰 사용
    const thead = container.querySelector("thead") as HTMLElement;
    expect(thead.className).toContain("bg-muted");
    // border 토큰
    const row = container.querySelector("tbody tr") as HTMLElement;
    expect(row.className).toContain("border-border");
    // cell className 병합
    const cell = container.querySelector("tbody td") as HTMLElement;
    expect(cell.className).toContain("text-right");
  });
});
```

- [x] **Step 2: 테스트 실패 확인**

Run: `npm run test -- src/shared/ui/__tests__/table.test.tsx`
Expected: FAIL — `Cannot find module '../table'`

- [x] **Step 3: 최소 구현 작성** (shadcn 표준 + A1 토큰)

```tsx
// src/shared/ui/table.tsx
import * as React from "react"

import { cn } from "@/shared/lib/utils"

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-x-auto rounded-xl border border-border bg-card">
    <table
      ref={ref}
      className={cn("w-full caption-bottom text-sm", className)}
      {...props}
    />
  </div>
))
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn("border-b border-border bg-muted/50 [&_tr]:border-b", className)}
    {...props}
  />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b border-border transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
      className,
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-11 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
      className,
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn("p-4 align-middle [&:has([role=checkbox])]:pr-0", className)}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
}
```

- [x] **Step 4: 테스트 통과 확인**

Run: `npm run test -- src/shared/ui/__tests__/table.test.tsx`
Expected: PASS (1 passed)

- [x] **Step 5: 커밋**

```bash
git add src/shared/ui/table.tsx src/shared/ui/__tests__/table.test.tsx
git commit -m "feat(ui): add Table primitive (A1 tokens, domain-agnostic)"
```

---

## Task 2: `Badge` 의미색 tone 확장

**Files:**
- Modify: `src/shared/ui/badge.tsx`
- Test: `src/shared/ui/__tests__/badge.test.tsx`

- [x] **Step 1: 실패하는 테스트 작성**

```tsx
// src/shared/ui/__tests__/badge.test.tsx
import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { Badge } from "../badge";

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

function classOf(node: React.ReactElement): string {
  const container = document.createElement("div");
  root = createRoot(container);
  act(() => root!.render(node));
  return (container.firstElementChild as HTMLElement).className;
}

describe("<Badge /> semantic tones", () => {
  it("success tone 은 green 의미색을 적용한다", () => {
    expect(classOf(<Badge variant="success">완료</Badge>)).toContain("bg-green-100");
  });
  it("warning tone 은 yellow 의미색을 적용한다", () => {
    expect(classOf(<Badge variant="warning">대기</Badge>)).toContain("bg-yellow-100");
  });
  it("info tone 은 blue 의미색을 적용한다", () => {
    expect(classOf(<Badge variant="info">처리 중</Badge>)).toContain("bg-blue-100");
  });
  it("neutral tone 은 gray 의미색을 적용한다", () => {
    expect(classOf(<Badge variant="neutral">보관</Badge>)).toContain("bg-gray-100");
  });
  it("기존 default variant(primary 토큰)은 보존된다", () => {
    expect(classOf(<Badge>기본</Badge>)).toContain("bg-primary");
  });
});
```

- [x] **Step 2: 테스트 실패 확인**

Run: `npm run test -- src/shared/ui/__tests__/badge.test.tsx`
Expected: FAIL — success/warning/info/neutral variant 클래스 미적용 (현재 4 variant만 존재)

- [x] **Step 3: 최소 구현 — variant 축에 tone 4종 추가**

`src/shared/ui/badge.tsx`의 `badgeVariants` → `variants.variant` 객체에 아래 4개를 추가한다 (기존 `default/secondary/destructive/outline`은 그대로 유지):

```ts
        success:
          "border-transparent bg-green-100 text-green-700",
        warning:
          "border-transparent bg-yellow-100 text-yellow-800",
        info:
          "border-transparent bg-blue-100 text-blue-800",
        neutral:
          "border-transparent bg-gray-100 text-gray-700",
```

> 의미색 리터럴은 badge.tsx 소스에 정적으로 존재 → Tailwind JIT가 클래스를 인식한다(safelist 불필요). 토큰화 대상 아님(원칙 2).

- [x] **Step 4: 테스트 통과 확인**

Run: `npm run test -- src/shared/ui/__tests__/badge.test.tsx`
Expected: PASS (5 passed)

- [x] **Step 5: 커밋**

```bash
git add src/shared/ui/badge.tsx src/shared/ui/__tests__/badge.test.tsx
git commit -m "feat(ui): add semantic tones (success/warning/info/neutral) to Badge"
```

---

## Task 3: admin `layout.tsx` A1 토큰화

**Files:**
- Modify: `src/app/(admin)/admin/layout.tsx`

- [x] **Step 1: 레이아웃 토큰 전환**

`src/app/(admin)/admin/layout.tsx`를 아래 className 매핑으로 전환한다 (구조·로직·redirect 가드 불변):

- 루트 `div`: `bg-gray-50` → `bg-muted`
- `header`: `border-gray-200 bg-white` → `border-border bg-card`
- 브랜드 Link `text-red-700 hover:text-red-800` → `text-primary hover:text-primary/90`
- nav Link ×8 `text-gray-700 hover:bg-gray-100` → `text-muted-foreground hover:bg-muted hover:text-foreground`
- 사용자명 `text-gray-500` → `text-muted-foreground`
- **ADMIN 역할 배지** `bg-red-100 ... text-red-700` → **유지**(의미색 — "관리자 권한 주의", 원칙 3). 단 `<Badge variant="destructive">ADMIN</Badge>`로 프리미티브화 가능(선택). 최소 변경으로 리터럴 유지해도 무방.

`LogoutButton`(feature island)은 이 Task 범위 밖 — Task 8에서 점검.

- [x] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: 에러 0

- [x] **Step 3: 커밋**

```bash
git add "src/app/(admin)/admin/layout.tsx"
git commit -m "style(admin): migrate admin shell layout to A1 tokens"
```

---

## Task 4: Phase 1 검증 게이트

**Files:** (없음 — 검증만)

- [x] **Step 1: 타입·테스트·빌드**

> ⚠️ dev 서버 가동 중이면 먼저 중단(`.next` 충돌 방지). build는 dev 중단 후 실행.

Run: `npm run typecheck && npm run test`
Expected: 전부 PASS

Run: `npm run build`
Expected: 빌드 성공, 에러 0

- [x] **Step 2: 클라 경계 누출 가드**

Run: `grep -rn "shared/lib/env" src/shared/ui/table.tsx src/shared/ui/badge.tsx`
Expected: 출력 없음 (프리미티브는 env 미참조)

- [x] **Step 3: Phase 1 완료 커밋** (게이트 통과 기록, 변경 없으면 skip)

Phase 1 완료. 페이지 본문은 다음 Phase에서 이관.

---

# PHASE 2 — 페이지 이관 (섹션별)

> 각 섹션 = 독립 PR 단위. 매 섹션 끝에 typecheck + build + grep 가드 + Playwright 시각 확인.
> **공통 레시피**: (a) 수제 `<table>` → `Table` 프리미티브, (b) 수제 status/job 배지 → `<Badge variant={tone}>` (라벨 보존, tone 매핑표 적용), (c) 무의미 색 → 토큰 매핑표 적용, (d) 1차 액션 링크/버튼 → `<Button asChild><Link/></Button>` 또는 `<Button>`.

## Task 5: 섹션 1 — 상품 관리 (페이지 + 폼)

**Files:**
- Modify: `src/app/(admin)/admin/products/page.tsx`
- Modify: `src/app/(admin)/admin/products/new/page.tsx`
- Modify: `src/app/(admin)/admin/products/[id]/edit/page.tsx`
- Modify: `src/app/(admin)/admin/products/[id]/departures/page.tsx`
- Modify: `src/app/(admin)/admin/products/[id]/departures/new/page.tsx`
- Modify: `src/app/(admin)/admin/products/[id]/departures/[depId]/edit/page.tsx`
- Modify: `src/features/admin-product/ui/ProductForm.tsx`
- Modify: `src/features/admin-product/ui/ItineraryEditor.tsx`
- Modify: `src/features/admin-departure/ui/DepartureForm.tsx`

- [x] **Step 1: 상품 목록 테이블 + 배지 이관 (대표 예시)**

`products/page.tsx`에서:

1. `STATUS_BADGE`(raw class Record) **삭제**, `STATUS_LABELS`는 **보존**. tone 매핑 추가:

```ts
import type { ProductStatus, EmbeddingJobStatus } from "@prisma/client";

const STATUS_TONE: Record<ProductStatus, "success" | "warning" | "neutral"> = {
  DRAFT: "warning",
  PUBLISHED: "success",
  CLOSED: "neutral",
};
const JOB_TONE: Record<EmbeddingJobStatus, "warning" | "info" | "success" | "destructive"> = {
  PENDING: "warning",
  IN_PROGRESS: "info",
  SUCCEEDED: "success",
  FAILED: "destructive",
};
```

2. `StatusBadge`/`EmbeddingJobBadge` 서브컴포넌트 내부를 프리미티브로:

```tsx
import { Badge } from "@/shared/ui/badge";
// ...
function StatusBadge({ status }: { status: ProductStatus }) {
  return <Badge variant={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Badge>;
}
function EmbeddingJobBadge({ job }: { job: AdminProductRow["latestJob"] }) {
  if (!job) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Badge variant={JOB_TONE[job.status]} title={job.lastError ?? undefined}>
      {JOB_LABELS[job.status]}{job.attempts > 0 && ` (${job.attempts}회)`}
    </Badge>
  );
}
```

3. 수제 `<table>` 블록(`ProductTable`)을 `Table` 프리미티브로 치환:

```tsx
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/shared/ui/table";
// ...
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>상품명</TableHead>
      <TableHead>목적지</TableHead>
      <TableHead className="text-center">상태</TableHead>
      <TableHead className="text-right">기본가</TableHead>
      <TableHead className="text-center">임베딩</TableHead>
      <TableHead>수정일</TableHead>
      <TableHead className="text-center">관리</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {items.map((row) => (
      <TableRow key={row.id}>
        <TableCell className="max-w-[240px]">
          <span className="block truncate font-medium text-foreground">{row.title}</span>
          <span className="font-mono text-xs text-muted-foreground">{row.id.slice(-8)}</span>
        </TableCell>
        <TableCell className="text-muted-foreground">{row.destination}</TableCell>
        <TableCell className="text-center"><StatusBadge status={row.status} /></TableCell>
        <TableCell className="text-right text-foreground">{row.basePriceAdult.toLocaleString("ko-KR")}원</TableCell>
        <TableCell className="text-center"><EmbeddingJobBadge job={row.latestJob} /></TableCell>
        <TableCell className="text-xs text-muted-foreground">{formatDateTime(row.updatedAt)}</TableCell>
        <TableCell className="text-center">
          <Button asChild variant="secondary" size="sm">
            <Link href={`/admin/products/${row.id}/edit`}>편집</Link>
          </Button>
        </TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

4. 헤더 영역: `text-gray-900`→`text-foreground`, `text-gray-500`→`text-muted-foreground`. "+ 상품 등록" 링크 → `<Button asChild><Link href="/admin/products/new">+ 상품 등록</Link></Button>`.

5. 빈 상태 `text-gray-400` → `text-muted-foreground`. 필터 탭 active `bg-gray-900 text-white` → `bg-primary text-primary-foreground`, inactive `ring-1 ring-gray-200` → `border border-border bg-card`. 페이지네이션 동일 매핑.

- [x] **Step 2: 나머지 상품 페이지 + 폼 이관**

`new/edit/departures*` 페이지: 토큰 매핑표 적용(`bg-white`→`Card`/`bg-card`, gray scale → foreground/muted-foreground/border, indigo → Button).

`ProductForm.tsx`/`DepartureForm.tsx`/`ItineraryEditor.tsx` (client islands):
- raw `<input>`/`<select>` → `@/shared/ui/input`의 `Input`, `@/shared/ui/select`의 Select(필요시). label/도움말 텍스트 색 토큰화.
- submit/secondary 버튼 → `Button` (variant: 저장=default, 취소=outline, 삭제·강제취소=destructive).
- ⚠️ island에서 `@/shared/lib/env`·entities 배럴 import 추가 금지.

- [x] **Step 3: 검증 (섹션 게이트)**

Run: `npm run typecheck`
Expected: 에러 0

Run: `grep -rnE "indigo-|red-[0-9]|bg-gray-50|text-gray-900|ring-gray" src/app/\(admin\)/admin/products src/features/admin-product src/features/admin-departure`
Expected: 출력 없음 (의미색 green/yellow 등은 tone으로 이동했으므로 잔존 리터럴 0). 단 의미색 의도 잔존이 있으면 사유 주석.

Run: `npm run build`
Expected: 성공

- [ ] **Step 4: Playwright 시각 확인**

dev 서버 기동(`npm run dev`) 후 admin 매직링크 로그인 → `/admin/products` 목록·필터·편집 폼 렌더 확인(스크린샷). A1 블루 1차 버튼·토큰 배경·tone 배지 확인.

- [x] **Step 5: 커밋**

```bash
git add "src/app/(admin)/admin/products" src/features/admin-product src/features/admin-departure
git commit -m "style(admin): migrate product management to A1 (Table/Badge tones/tokens)"
```

---

## Task 6: 섹션 2 — 예약 관리 + 환불 모니터링

**Files:**
- Modify: `src/app/(admin)/admin/bookings/page.tsx`
- Modify: `src/app/(admin)/admin/bookings/[id]/page.tsx`
- Modify: `src/app/(admin)/admin/bookings/[id]/not-found.tsx`
- Modify: `src/app/(admin)/admin/refund-jobs/page.tsx`
- Modify: `src/features/admin-booking-cancel/ui/AdminCancelBookingButton.tsx`
- Modify: `src/widgets/booking-detail/ui/DiscretionaryRefundPanel.tsx`

- [x] **Step 1: 예약 목록/상세 + 환불 jobs 이관**

공통 레시피 적용. status 매핑(라벨은 기존 상수 보존):

```ts
import type { BookingStatus, PaymentStatus, RefundJobStatus } from "@prisma/client";
type Tone = "success" | "warning" | "info" | "destructive" | "neutral";

const BOOKING_TONE: Record<BookingStatus, Tone> = {
  RECEIVED: "neutral",
  AWAITING_GROUP: "warning",
  DEPARTURE_CONFIRMED: "info",
  PAID: "success",
  READY: "success",
  COMPLETED: "success",
  CANCELED_BY_USER: "destructive",
  CANCELED_BY_AGENCY: "destructive",
};
const PAYMENT_TONE: Record<PaymentStatus, Tone> = {
  PENDING: "warning",
  PAID: "success",
  CANCELED: "neutral",
  PARTIAL_CANCELED: "info",
  FAILED: "destructive",
};
const REFUND_TONE: Record<RefundJobStatus, Tone> = {
  PENDING: "warning",
  IN_PROGRESS: "info",
  SUCCEEDED: "success",
  FAILED: "destructive",
};
```

> ⚠️ `BookingStatus`에 위 8개 외 값이 더 있으면(`schema.prisma` 재확인) 누락 시 typecheck가 `Record` 미완성으로 잡아준다 — 그때 tone 매핑표 기준으로 보강.

- 목록 수제 테이블 → `Table` 프리미티브.
- 상세 페이지 정보 패널 `bg-white border-gray-200` → `<Card>`.
- `AdminCancelBookingButton`(island, 파괴적 액션) → `<Button variant="destructive">`. `DiscretionaryRefundPanel` 입력 → `Input`, 실행 버튼 → `Button variant="destructive">`.
- `not-found.tsx` 색 토큰화.

- [x] **Step 2: 검증**

Run: `npm run typecheck`
Expected: 에러 0 (Record 누락 enum 있으면 여기서 발견)

Run: `grep -rnE "indigo-|red-[0-9]|bg-gray-50|text-gray-900|ring-gray" src/app/\(admin\)/admin/bookings src/app/\(admin\)/admin/refund-jobs src/features/admin-booking-cancel src/widgets/booking-detail`
Expected: 출력 없음 (destructive 액션 red는 토큰 `destructive`로 이동)

Run: `npm run build`
Expected: 성공

- [ ] **Step 3: Playwright 시각 확인**

`/admin/bookings` 목록 → 상세 → 환불 패널, `/admin/refund-jobs` 렌더 확인.

- [x] **Step 4: 커밋**

```bash
git add "src/app/(admin)/admin/bookings" "src/app/(admin)/admin/refund-jobs" src/features/admin-booking-cancel src/widgets/booking-detail
git commit -m "style(admin): migrate bookings + refund monitoring to A1"
```

---

## Task 7: 섹션 3 — 위약금 정책 / 임베딩 Jobs / 취소 배치

**Files:**
- Modify: `src/app/(admin)/admin/penalty-policies/page.tsx`
- Modify: `src/app/(admin)/admin/embedding-jobs/page.tsx`
- Modify: `src/app/(admin)/admin/departure-cancellations/page.tsx`
- Modify: `src/app/(admin)/admin/departure-cancellations/[id]/page.tsx`
- Modify: `src/features/admin-penalty-policy/ui/PenaltyPolicyForm.tsx`
- Modify: `src/features/admin-departure-cancel/ui/ForceCancelButton.tsx`

- [x] **Step 1: 3개 섹션 이관**

공통 레시피 적용. 추가 status 매핑:

```ts
import type { EmbeddingJobStatus, DepartureCancellationStatus } from "@prisma/client";
type Tone = "success" | "warning" | "info" | "destructive" | "neutral";

const JOB_TONE: Record<EmbeddingJobStatus, Tone> = {
  PENDING: "warning", IN_PROGRESS: "info", SUCCEEDED: "success", FAILED: "destructive",
};
const BATCH_TONE: Record<DepartureCancellationStatus, Tone> = {
  PROCESSING: "info",
  COMPLETED: "success",
  PARTIALLY_FAILED: "destructive",
};
```

- 수제 테이블 → `Table`. 수제 배지 → `Badge variant={tone}`.
- `PenaltyPolicyForm`(island) 입력 → `Input`, 버튼 → `Button`.
- `ForceCancelButton`(island, 파괴적) → `<Button variant="destructive">`. confirm 모달 색 토큰화. ⚠️ env/배럴 누출 금지.

- [x] **Step 2: 검증**

Run: `npm run typecheck`
Expected: 에러 0

Run: `grep -rnE "indigo-|red-[0-9]|bg-gray-50|text-gray-900|ring-gray" src/app/\(admin\)/admin/penalty-policies src/app/\(admin\)/admin/embedding-jobs src/app/\(admin\)/admin/departure-cancellations src/features/admin-penalty-policy src/features/admin-departure-cancel`
Expected: 출력 없음

Run: `npm run build`
Expected: 성공

- [ ] **Step 3: Playwright 시각 확인**

`/admin/penalty-policies`, `/admin/embedding-jobs`, `/admin/departure-cancellations` 목록·상세 렌더 확인.

- [x] **Step 4: 커밋**

```bash
git add "src/app/(admin)/admin/penalty-policies" "src/app/(admin)/admin/embedding-jobs" "src/app/(admin)/admin/departure-cancellations" src/features/admin-penalty-policy src/features/admin-departure-cancel
git commit -m "style(admin): migrate penalty/embedding/cancellation sections to A1"
```

---

## Task 8: 섹션 4 — 리뷰 관리 (모더레이션 islands 포함)

**Files:**
- Modify: `src/app/(admin)/admin/reviews/page.tsx`
- Modify: `src/app/(admin)/admin/reviews/[id]/page.tsx`
- Modify: `src/features/admin-review-moderation/ui/ReviewStatusToggle.tsx`
- Modify: `src/features/admin-review-moderation/ui/ReportModerationActions.tsx`
- Modify: `src/features/auth/ui/LogoutButton.tsx` (Task 3에서 미룬 layout island)

- [ ] **Step 1: 리뷰 관리 이관**

공통 레시피. status 매핑:

```ts
import type { ReviewStatus } from "@prisma/client";
type Tone = "success" | "warning" | "info" | "destructive" | "neutral";

const REVIEW_TONE: Record<ReviewStatus, Tone> = {
  PUBLISHED: "success",
  HIDDEN: "neutral",
  REPORTED: "warning",
};
```

- 목록(전체/공개/숨김/신고됨 탭) 테이블 → `Table`. 탭 active/inactive 토큰화. 신고됨 탭 분기 로직 불변(report-driven — `listReviewsWithOpenReports`).
- `ReviewStatusToggle`(island): PUBLISHED↔HIDDEN 버튼 → `Button`(숨기기=destructive 또는 secondary, 복원=secondary).
- `ReportModerationActions`(island): "숨기기(인정)" → `Button variant="destructive">`, "기각" → `Button variant="outline">`. PII 마스킹·rate-limit 로직 불변.
- `LogoutButton`: 색 토큰화(`Button variant="ghost"` 또는 outline).

- [ ] **Step 2: 검증**

Run: `npm run typecheck`
Expected: 에러 0

Run: `grep -rnE "indigo-|red-[0-9]|bg-gray-50|text-gray-900|ring-gray" src/app/\(admin\)/admin/reviews src/features/admin-review-moderation src/features/auth/ui/LogoutButton.tsx`
Expected: 출력 없음

Run: `npm run build`
Expected: 성공

- [ ] **Step 3: Playwright 시각 확인**

`/admin/reviews` 4개 탭 → 상세 모더레이션, 헤더 로그아웃 버튼 렌더 확인.

- [ ] **Step 4: 커밋**

```bash
git add "src/app/(admin)/admin/reviews" src/features/admin-review-moderation src/features/auth/ui/LogoutButton.tsx
git commit -m "style(admin): migrate review moderation to A1 + tokenize logout button"
```

---

## Task 9: 섹션 5 — 대시보드 (토큰 정렬만)

**Files:**
- Modify: `src/app/(admin)/admin/dashboard/page.tsx`
- Modify: `src/widgets/admin-dashboard/ui/*` (KPI 카드·필터·조립 server 컴포넌트 한정)
- Modify: `src/features/admin-dashboard-drilldown/ui/DrilldownSheet.tsx`
- Modify: `src/features/admin-dashboard-drilldown/ui/KpiDrilldownGrid.tsx`

- [ ] **Step 1: 잔존 무의미 색만 토큰 정렬**

Phase 6에서 이미 상당 부분 정돈됨. **차트 리프(`RevenueTrendChart`/`BookingStatusDonut`)의 색은 데이터 의미색이므로 보존**(건드리지 않음). 잔존 `indigo-`/raw gray/`bg-white`만 토큰으로:
- KPI 카드 `bg-white` → `<Card>`. 텍스트 gray scale → foreground/muted-foreground.
- 기간 필터 `<Link href="?range=">` active/inactive → `bg-primary text-primary-foreground` / `border border-border bg-card` (searchParams SSOT 유지, `useState` 도입 금지).
- `DrilldownSheet`(Sheet island)·`KpiDrilldownGrid` 잔존 리터럴 토큰화.

> 🎨 경계 회귀 가드: `grep "use client" src/widgets/admin-dashboard/ui/` 가 차트 리프 2개만 반환하는지 확인(KPI·필터·조립은 server 유지).

- [ ] **Step 2: 검증**

Run: `npm run typecheck`
Expected: 에러 0

Run: `grep "use client" src/widgets/admin-dashboard/ui/*`
Expected: `RevenueTrendChart`·`BookingStatusDonut` 2개만 (server 리프 회귀 없음)

Run: `grep -rnE "indigo-|bg-gray-50|text-gray-900|ring-gray" src/app/\(admin\)/admin/dashboard src/widgets/admin-dashboard src/features/admin-dashboard-drilldown`
Expected: 출력 없음 (차트 데이터 의미색 제외)

Run: `npm run build`
Expected: 성공

- [ ] **Step 3: Playwright 시각 확인**

`/admin/dashboard` KPI·차트·기간필터·드릴다운 Sheet 렌더 확인.

- [ ] **Step 4: 커밋**

```bash
git add "src/app/(admin)/admin/dashboard" src/widgets/admin-dashboard src/features/admin-dashboard-drilldown
git commit -m "style(admin): align dashboard shell to A1 tokens (charts preserved)"
```

---

## Task 10: 최종 종합 검증 + 마무리

**Files:**
- Modify: `CLAUDE.md` (마일스톤 1단계 완료 표시 + 혼란 방지 노트)

- [ ] **Step 1: 전역 리터럴 잔존 스캔**

Run: `grep -rnE "text-red-700|bg-indigo-|text-indigo-|bg-gray-50|text-gray-900" src/app/\(admin\) | grep -v "node_modules"`
Expected: 출력 없음 (의미색 destructive/tone로 모두 이동). 잔존 시 의미색 의도 주석 필수.

- [ ] **Step 2: 전체 게이트**

Run: `npm run typecheck && npm run test && npm run lint`
Expected: 전부 PASS

Run: `npm run build`
Expected: 성공

- [ ] **Step 3: CLAUDE.md 마일스톤 갱신**

§8 로드맵의 "1. [진행 중] Admin 셸 A1 적용" → "1. [완료] Admin 셸 A1 적용"으로 변경. 혼란 방지 노트 1줄 추가:
> "admin도 이제 A1 클린 블루(site와 동일 토큰). 상태 배지는 `Badge` 의미 tone(success/warning/info/neutral/destructive) 사용 — enum→tone 매핑은 각 페이지가 보유(shared는 tone 추상만). 테이블은 `shared/ui/table.tsx` 프리미티브. red는 파괴적 액션(destructive)+ADMIN 배지에만 잔존."

다음 마일스톤 포인터를 "2. ADR 발행(REPORTED status-flip 포기)"으로 표시.

- [ ] **Step 4: 커밋 + PR 준비**

```bash
git add CLAUDE.md
git commit -m "docs: mark admin A1 revamp complete + add tone/Table guidance notes"
```

PR 본문(보고 양식 §7.1 준수: Core Architecture / Boilerplate / Concept Insight 3섹션).

---

## Self-Review 결과 (작성자 점검)

- **Spec coverage**: §2 3원칙 → 토큰 매핑표·tone 매핑표·destructive 한정으로 전 Task 반영. §3.1 Table → Task 1. §3.2 Badge tone → Task 2. §3.3 도메인 status 매핑 → Task 5~9 각 페이지 Record. §4 Phase 분리 → Phase 1(Task 1-4)/Phase 2(Task 5-9). §5 검증(typecheck/test/build/grep/Playwright) → 각 섹션 게이트 + Task 10. §6 YAGNI(다크모드·정보구조·도메인 로직 제외) → 명시. ✅ 갭 없음.
- **Placeholder scan**: TBD/TODO 없음. 각 코드 스텝에 실제 코드 포함. 반복적 className 스왑은 상단 토큰 매핑표(SSOT) 참조 — 플랜 실패 아님(레시피 명시).
- **Type consistency**: tone 값(`success/warning/info/neutral/destructive`)이 Task 2 Badge variant 정의와 Task 5~9 Record 사용처에서 일치. `Table` 서브컴포넌트명이 Task 1 정의와 Task 5 사용처에서 일치. ✅
- **알려진 위험**: `BookingStatus` enum이 8개 초과일 수 있음 → Task 6에서 `Record` 미완성을 typecheck가 강제 발견하도록 설계(가드 명시).
