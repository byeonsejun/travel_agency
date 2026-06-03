# Phase 5-A — Email Notification Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 결제 완료(PAID)·환불 완료(CANCELED) 거래 종료 시점에 예약확정서/영수증·환불안내 메일을 트랜잭셔널 아웃박스로 적재하고, 비동기 크론 워커가 Resend로 발송(비-production은 콘솔 폴백)한다.

**Architecture:** `transitionStatusTx`의 booking 상태전이 Tx 안에서 순수 정책 함수가 판단해 `EmailJob` 행을 원자적으로 enqueue(유실 0). 크론 워커가 `EmbeddingJob`/`RefundJob`과 동형의 CAS-claim·백오프 패턴으로 픽업 → 소유 entity 로더로 데이터 hydrate → React Email 렌더 → Resend 발송(멱등키=dedupeKey). 발송 실패는 백오프 재시도, NODE_ENV≠production은 콘솔 폴백으로 바운스 차단.

**Tech Stack:** Prisma 5(EmailJob), React Email(`@react-email/components`/`render`), Resend v4(이미 설치), Vitest(`vi.hoisted`+`vi.mock` 단위), Vercel Cron.

**스펙:** `docs/superpowers/specs/2026-06-03-phase-5a-email-pipeline.md`

---

## 페르소나 발동

| 페르소나 | 발동 사유 |
|---|---|
| 🏛️ Architect | `shared/email`·`shared/lib/email-job` 신설, `entities/booking` outbox 훅, barrel 공개 API, 워커의 shared→entities 예외(EmbeddingJob 선례) |
| ⚙️ Backend Expert | EmailJob 스키마/마이그레이션, Zod 없는 내부 큐(외부입력 아님), hydration 단일쿼리 N+1 차단, env superRefine prod 필수화, CAS claim·백오프 |
| 🎨 Frontend Expert | React Email 컴포넌트(`'use client'` 없음, 서버 렌더 HTML), 평문 props 격리 |
| 💳 Domain Booking | 환불 메일 가드(`from∈{PAID,READY}`만), 전이 정책이 booking 상태머신과 정합, 외부 IO(Resend)는 Tx 밖 |
| 🔬 QA Engineer | 보고 직전 typecheck/test/grep 증거, 실 발송 e2e는 Resend 콘솔 사용자 위임 명시 |

## File Structure

| 파일 | 책임 |
|---|---|
| `prisma/schema.prisma` (수정) | `EmailJob` 모델 + `EmailType`/`EmailJobStatus` enum + Booking 역참조 |
| `src/entities/booking/model/emailPolicy.ts` (생성) | 순수: `(from,to,bookingId) → EmailJobDescriptor \| null` |
| `src/shared/lib/email-job/enqueue.ts` (생성) | 멱등 enqueue(find-then-create, unique 백스톱) |
| `src/entities/booking/api/mutations.ts` (수정) | `transitionStatusTx`에 outbox 훅 1줄 |
| `src/shared/email/templates/types.ts` (생성) | 템플릿 props 인터페이스 |
| `src/shared/email/templates/BookingConfirmationEmail.tsx` (생성) | 예약확정+영수증 React Email |
| `src/shared/email/templates/RefundCompletedEmail.tsx` (생성) | 환불안내 React Email |
| `src/shared/email/render.ts` (생성) | `EmailType`+props → `{subject,html,text}` |
| `src/shared/email/provider.ts` (생성) | `sendEmail`: Resend + dev 콘솔 폴백 |
| `src/shared/email/index.ts` (생성) | barrel |
| `src/shared/lib/env.ts` (수정) | prod에서 `RESEND_API_KEY`/`RESEND_FROM_EMAIL` 필수화 |
| `src/entities/booking/api/getBookingConfirmationEmailData.ts` (생성) | 확정메일 데이터 단일쿼리 |
| `src/entities/payment/api/getRefundCompletedEmailData.ts` (생성) | 환불메일 데이터 단일쿼리 |
| `src/shared/lib/email-job/worker.ts` (생성) | claim→hydrate→render→send→상태기록 |
| `src/shared/lib/email-job/index.ts` (생성) | barrel |
| `src/app/api/cron/email-job/route.ts` (생성) | CRON_SECRET 가드 + 배치 위임 |
| `vercel.json` (수정) | `*/2` cron 등록 |
| `src/entities/booking/index.ts`·`src/entities/payment/index.ts` (수정) | 신규 export |

---

## Task 1: EmailJob 스키마 + 마이그레이션

**Files:**
- Modify: `prisma/schema.prisma`

- [x] **Step 1: EmailJob enum/model 추가**

`prisma/schema.prisma`의 EmbeddingJob 블록(`@@index([productId, status])` 닫는 `}`) 바로 다음에 추가:

```prisma
enum EmailType {
  BOOKING_CONFIRMATION // 예약 확정서 + 결제 영수증 (PAID 전이)
  REFUND_COMPLETED // 환불 처리 완료 안내 (PAID/READY → CANCELED)
}

enum EmailJobStatus {
  PENDING
  IN_PROGRESS
  SUCCEEDED
  FAILED
}

// 거래 종료 알림 메일 비동기 큐. EmbeddingJob/RefundJob과 동형
// (status/attempts/lastError/nextRunAt/@@index). 트랜잭셔널 아웃박스:
// booking 상태전이 Tx 안에서 적재되어 유실 0. payload 컬럼 없음 —
// bookingId만으로 워커가 발송 시점에 전체 데이터를 hydrate한다.
model EmailJob {
  id         String         @id @default(cuid())
  type       EmailType
  // 멱등 enqueue 키. ex) "booking-confirmation:<bookingId>" / "refund-completed:<bookingId>"
  dedupeKey  String         @unique
  bookingId  String
  status     EmailJobStatus @default(PENDING)
  attempts   Int            @default(0)
  lastError  String?        @db.Text
  nextRunAt  DateTime       @default(now()) // 지수 백오프
  sentTo     String? // 발송 시점 수신 주소 스냅샷 (감사)
  providerId String? // Resend 메시지 id (감사 + 멱등 추적)
  createdAt  DateTime       @default(now())
  updatedAt  DateTime       @updatedAt

  booking Booking @relation(fields: [bookingId], references: [id], onDelete: Cascade)

  @@index([status, nextRunAt]) // cron picker
}
```

- [x] **Step 2: Booking 모델에 역참조 추가**

`model Booking`의 relation 목록(`payments Payment[]` 인근)에 추가:

```prisma
  emailJobs     EmailJob[]
```

- [x] **Step 3: 마이그레이션 생성 + 클라이언트 재생성**

Run: `npm run db:migrate -- --name add_email_job`
Expected: 마이그레이션 파일 생성 + `EmailJob` 테이블 CREATE + `prisma generate` 성공.

- [x] **Step 4: 타입 확인**

Run: `npm run typecheck`
Expected: PASS (Prisma Client에 `emailJob` delegate + `EmailType`/`EmailJobStatus` enum 생성됨).

- [x] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(email): add EmailJob queue schema + migration"
```

---

## Task 2: 전이 → 메일 정책 (순수 함수, TDD)

**Files:**
- Create: `src/entities/booking/model/emailPolicy.ts`
- Test: `src/entities/booking/model/__tests__/emailPolicy.test.ts`

- [x] **Step 1: 실패 테스트 작성**

```ts
import { describe, it, expect } from "vitest";
import { emailJobForTransition } from "../emailPolicy";

const BID = "clbk000000000000000001";

describe("emailJobForTransition", () => {
  it("any → PAID 는 예약확정 메일 descriptor", () => {
    expect(emailJobForTransition("DEPARTURE_CONFIRMED", "PAID", BID)).toEqual({
      type: "BOOKING_CONFIRMATION",
      dedupeKey: `booking-confirmation:${BID}`,
    });
  });

  it("PAID → CANCELED_BY_USER 는 환불 메일 descriptor", () => {
    expect(emailJobForTransition("PAID", "CANCELED_BY_USER", BID)).toEqual({
      type: "REFUND_COMPLETED",
      dedupeKey: `refund-completed:${BID}`,
    });
  });

  it("READY → CANCELED_BY_AGENCY 도 환불 메일 (돈이 오간 상태)", () => {
    expect(emailJobForTransition("READY", "CANCELED_BY_AGENCY", BID)).toEqual({
      type: "REFUND_COMPLETED",
      dedupeKey: `refund-completed:${BID}`,
    });
  });

  it("DEPARTURE_CONFIRMED → CANCELED 는 환불 메일 없음 (결제 전 단계)", () => {
    expect(
      emailJobForTransition("DEPARTURE_CONFIRMED", "CANCELED_BY_USER", BID),
    ).toBeNull();
  });

  it("RECEIVED → CANCELED 는 메일 없음", () => {
    expect(emailJobForTransition("RECEIVED", "CANCELED_BY_AGENCY", BID)).toBeNull();
  });

  it("PAID → READY (eticket) 는 메일 없음", () => {
    expect(emailJobForTransition("PAID", "READY", BID)).toBeNull();
  });
});
```

- [x] **Step 2: 실패 확인**

Run: `npm test -- src/entities/booking/model/__tests__/emailPolicy.test.ts`
Expected: FAIL ("Cannot find module '../emailPolicy'").

- [x] **Step 3: 최소 구현**

`src/entities/booking/model/emailPolicy.ts`:

```ts
/**
 * emailPolicy.ts — booking 상태전이 → 거래 종료 메일 매핑 (순수 정책).
 *
 * transitionStatusTx(아웃박스)가 이 함수로 판단해 EmailJob을 적재한다.
 * 환불 메일은 from ∈ {PAID, READY}(돈이 오간 상태)에서 취소될 때만 —
 * 결제 전 단계(RECEIVED/AWAITING_GROUP/DEPARTURE_CONFIRMED) 취소엔 보내지 않는다.
 * (refund.ts의 REFUNDABLE_STATUSES와 동일 기준.)
 */

import type { BookingStatus, EmailType } from "@prisma/client";

export interface EmailJobDescriptor {
  type: EmailType;
  dedupeKey: string;
}

export function emailJobForTransition(
  from: BookingStatus,
  to: BookingStatus,
  bookingId: string,
): EmailJobDescriptor | null {
  if (to === "PAID") {
    return {
      type: "BOOKING_CONFIRMATION",
      dedupeKey: `booking-confirmation:${bookingId}`,
    };
  }

  const wasPaid = from === "PAID" || from === "READY";
  const isCancel = to === "CANCELED_BY_USER" || to === "CANCELED_BY_AGENCY";
  if (wasPaid && isCancel) {
    return {
      type: "REFUND_COMPLETED",
      dedupeKey: `refund-completed:${bookingId}`,
    };
  }

  return null;
}
```

- [x] **Step 4: 통과 확인**

Run: `npm test -- src/entities/booking/model/__tests__/emailPolicy.test.ts`
Expected: PASS (6 tests).

- [x] **Step 5: Commit**

```bash
git add src/entities/booking/model/emailPolicy.ts src/entities/booking/model/__tests__/emailPolicy.test.ts
git commit -m "feat(email): transition→email policy pure function"
```

---

## Task 3: 멱등 enqueue SSOT (TDD)

**Files:**
- Create: `src/shared/lib/email-job/enqueue.ts`
- Test: `src/shared/lib/email-job/__tests__/enqueue.test.ts`

- [x] **Step 1: 실패 테스트 작성**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  tx: {
    emailJob: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { enqueueEmailJob } from "../enqueue";

const tx = mocks.tx as unknown as Prisma.TransactionClient;
const ARGS = {
  type: "BOOKING_CONFIRMATION" as const,
  dedupeKey: "booking-confirmation:clbk1",
  bookingId: "clbk1",
};

describe("enqueueEmailJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.emailJob.create.mockResolvedValue({ id: "clej_new" });
  });

  it("기존 dedupeKey 없으면 PENDING 행 생성", async () => {
    mocks.tx.emailJob.findUnique.mockResolvedValue(null);
    await enqueueEmailJob(tx, ARGS);
    expect(mocks.tx.emailJob.create).toHaveBeenCalledWith({
      data: {
        type: "BOOKING_CONFIRMATION",
        dedupeKey: "booking-confirmation:clbk1",
        bookingId: "clbk1",
        status: "PENDING",
      },
    });
  });

  it("동일 dedupeKey 존재하면 no-op (create 미호출)", async () => {
    mocks.tx.emailJob.findUnique.mockResolvedValue({ id: "clej_exist" });
    await enqueueEmailJob(tx, ARGS);
    expect(mocks.tx.emailJob.create).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: 실패 확인**

Run: `npm test -- src/shared/lib/email-job/__tests__/enqueue.test.ts`
Expected: FAIL ("Cannot find module '../enqueue'").

- [x] **Step 3: 최소 구현**

`src/shared/lib/email-job/enqueue.ts`:

```ts
/**
 * enqueue.ts — EmailJob 멱등 enqueue SSOT (트랜잭셔널 아웃박스 적재부).
 *
 * find-then-create: Postgres 인터랙티브 Tx에서 unique 위반(P2002)은 Tx 전체를
 * abort시켜 후속 COMMIT을 깨뜨린다. 따라서 EmbeddingJob enqueue처럼 사전 조회로
 * 분기한다. dedupeKey @unique 는 동시성 백스톱(드문 동시 전이 시 두 번째 Tx 롤백).
 *
 * 허용 import: @prisma/client (타입만)
 * 금지: @/shared/lib/db, features/widgets/app
 */

import type { Prisma, EmailType } from "@prisma/client";

export interface EnqueueEmailJobArgs {
  type: EmailType;
  dedupeKey: string;
  bookingId: string;
}

export async function enqueueEmailJob(
  tx: Prisma.TransactionClient,
  { type, dedupeKey, bookingId }: EnqueueEmailJobArgs,
): Promise<void> {
  const existing = await tx.emailJob.findUnique({
    where: { dedupeKey },
    select: { id: true },
  });
  if (existing) return; // 멱등 no-op

  await tx.emailJob.create({
    data: { type, dedupeKey, bookingId, status: "PENDING" },
  });
}
```

- [x] **Step 4: 통과 확인**

Run: `npm test -- src/shared/lib/email-job/__tests__/enqueue.test.ts`
Expected: PASS (2 tests).

- [x] **Step 5: Commit**

```bash
git add src/shared/lib/email-job/enqueue.ts src/shared/lib/email-job/__tests__/enqueue.test.ts
git commit -m "feat(email): idempotent EmailJob enqueue (outbox)"
```

---

## Task 4: `transitionStatusTx` 아웃박스 훅 (TDD)

**Files:**
- Modify: `src/entities/booking/api/mutations.ts:131-141` (BookingEvent.create 직후)
- Test: `src/entities/booking/api/__tests__/transitionEmailOutbox.test.ts`

- [x] **Step 1: 실패 테스트 작성**

`transitionStatusTx`가 PAID 전이 시 `enqueueEmailJob`을 호출하고, 비대상 전이엔 호출하지 않음을 검증.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  enqueueEmailJob: vi.fn(),
  tx: {
    booking: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    bookingEvent: { create: vi.fn() },
    departure: { update: vi.fn() },
  },
}));

vi.mock("@/shared/lib/email-job/enqueue", () => ({
  enqueueEmailJob: mocks.enqueueEmailJob,
}));
// seatLock(releaseSeats)은 취소 전이에서만 호출 — 부수효과 차단용 noop mock.
vi.mock("../seatLock", () => ({
  reserveSeats: vi.fn(),
  releaseSeats: vi.fn(),
  InsufficientCapacityError: class extends Error {},
}));

import { transitionStatusTx } from "../mutations";

const tx = mocks.tx as unknown as Prisma.TransactionClient;
const BID = "clbk000000000000000001";

function mockBooking(status: string) {
  mocks.tx.booking.findUniqueOrThrow.mockResolvedValue({
    id: BID,
    status,
    departureId: "cldep1",
    adultCount: 2,
    childCount: 0,
  });
  mocks.tx.booking.update.mockResolvedValue({ id: BID, status });
}

describe("transitionStatusTx 아웃박스 훅", () => {
  beforeEach(() => vi.clearAllMocks());

  it("DEPARTURE_CONFIRMED → PAID 시 예약확정 EmailJob enqueue", async () => {
    mockBooking("DEPARTURE_CONFIRMED");
    await transitionStatusTx(tx, {
      bookingId: BID,
      to: "PAID",
      actor: "system:test",
    });
    expect(mocks.enqueueEmailJob).toHaveBeenCalledWith(tx, {
      type: "BOOKING_CONFIRMATION",
      dedupeKey: `booking-confirmation:${BID}`,
      bookingId: BID,
    });
  });

  it("PAID → CANCELED_BY_USER 시 환불 EmailJob enqueue", async () => {
    mockBooking("PAID");
    await transitionStatusTx(tx, {
      bookingId: BID,
      to: "CANCELED_BY_USER",
      actor: "user:x",
    });
    expect(mocks.enqueueEmailJob).toHaveBeenCalledWith(tx, {
      type: "REFUND_COMPLETED",
      dedupeKey: `refund-completed:${BID}`,
      bookingId: BID,
    });
  });

  it("DEPARTURE_CONFIRMED → PAID 외 비대상 전이(PAID→READY)는 enqueue 안 함", async () => {
    mockBooking("PAID");
    await transitionStatusTx(tx, {
      bookingId: BID,
      to: "READY",
      actor: "system:test",
    });
    expect(mocks.enqueueEmailJob).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: 실패 확인**

Run: `npm test -- src/entities/booking/api/__tests__/transitionEmailOutbox.test.ts`
Expected: FAIL (enqueueEmailJob 미호출 — 아직 훅 없음).

- [x] **Step 3: `mutations.ts` 수정**

상단 import 추가:

```ts
import { emailJobForTransition } from "../model/emailPolicy";
import { enqueueEmailJob } from "@/shared/lib/email-job/enqueue";
```

`transitionStatusTx` 안 `BookingEvent` append(`await tx.bookingEvent.create({...})`) **직후, `return updated;` 직전**에 추가:

```ts
  // 트랜잭셔널 아웃박스: 거래 종료 메일을 같은 Tx에 원자적으로 적재 (유실 0).
  const emailDescriptor = emailJobForTransition(current.status, to, bookingId);
  if (emailDescriptor) {
    await enqueueEmailJob(tx, { ...emailDescriptor, bookingId });
  }
```

- [x] **Step 4: 통과 확인**

Run: `npm test -- src/entities/booking/api/__tests__/transitionEmailOutbox.test.ts`
Expected: PASS (3 tests).

- [x] **Step 5: 회귀 확인 (기존 booking 전이 테스트)**

Run: `npm test -- src/entities/booking`
Expected: PASS (기존 transitions/mutations 테스트 무손상).

- [x] **Step 6: Commit**

```bash
git add src/entities/booking/api/mutations.ts src/entities/booking/api/__tests__/transitionEmailOutbox.test.ts
git commit -m "feat(email): wire transactional outbox into transitionStatusTx"
```

---

## Task 5: React Email 템플릿 + render (TDD)

**Files:**
- Create: `src/shared/email/templates/types.ts`
- Create: `src/shared/email/templates/BookingConfirmationEmail.tsx`
- Create: `src/shared/email/templates/RefundCompletedEmail.tsx`
- Create: `src/shared/email/render.ts`
- Test: `src/shared/email/__tests__/render.test.ts`

- [x] **Step 1: React Email 의존성 설치**

Run: `npm install @react-email/components @react-email/render`
Expected: 두 패키지가 `dependencies`에 추가.

- [x] **Step 2: props 타입 정의**

`src/shared/email/templates/types.ts`:

```ts
/** 템플릿은 도메인 객체가 아닌 평문 props만 받는다 (도메인 무지·독립 테스트). */

export interface BookingConfirmationEmailProps {
  customerName: string;
  bookingId: string;
  productTitle: string;
  departureDate: string; // "2026-08-15"
  travelerCount: number;
  totalPrice: number; // 원
  receiptUrl: string | null;
}

export interface RefundCompletedEmailProps {
  customerName: string;
  bookingId: string;
  productTitle: string;
  refundAmount: number; // 원
  paymentMethod: string; // "카드"
}
```

- [x] **Step 3: 실패 테스트 작성**

```ts
import { describe, it, expect } from "vitest";
import { renderEmail } from "../render";

describe("renderEmail", () => {
  it("BOOKING_CONFIRMATION: subject + 핵심 데이터 포함", async () => {
    const out = await renderEmail("BOOKING_CONFIRMATION", {
      customerName: "홍길동",
      bookingId: "clbk1",
      productTitle: "오사카 3박4일",
      departureDate: "2026-08-15",
      travelerCount: 2,
      totalPrice: 1290000,
      receiptUrl: "https://receipt.example/abc",
    });
    expect(out.subject).toContain("예약");
    expect(out.html).toContain("오사카 3박4일");
    expect(out.html).toContain("1,290,000");
    expect(out.html).toContain("https://receipt.example/abc");
    expect(out.text).toContain("오사카 3박4일");
  });

  it("REFUND_COMPLETED: subject + 환불 금액 포함", async () => {
    const out = await renderEmail("REFUND_COMPLETED", {
      customerName: "김여행",
      bookingId: "clbk2",
      productTitle: "다낭 4박5일",
      refundAmount: 880000,
      paymentMethod: "카드",
    });
    expect(out.subject).toContain("환불");
    expect(out.html).toContain("880,000");
    expect(out.html).toContain("다낭 4박5일");
  });
});
```

- [x] **Step 4: 실패 확인**

Run: `npm test -- src/shared/email/__tests__/render.test.ts`
Expected: FAIL ("Cannot find module '../render'").

- [x] **Step 5: 템플릿 구현 — BookingConfirmationEmail**

`src/shared/email/templates/BookingConfirmationEmail.tsx`:

```tsx
import {
  Html,
  Head,
  Body,
  Container,
  Heading,
  Text,
  Section,
  Hr,
  Link,
} from "@react-email/components";
import type { BookingConfirmationEmailProps } from "./types";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export function BookingConfirmationEmail({
  customerName,
  bookingId,
  productTitle,
  departureDate,
  travelerCount,
  totalPrice,
  receiptUrl,
}: BookingConfirmationEmailProps) {
  return (
    <Html lang="ko">
      <Head />
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f6f6f6" }}>
        <Container style={{ backgroundColor: "#ffffff", padding: "32px", borderRadius: "8px" }}>
          <Heading>예약이 확정되었습니다 🎉</Heading>
          <Text>{customerName}님, 결제가 완료되어 예약이 확정되었습니다.</Text>
          <Hr />
          <Section>
            <Text><b>상품</b>: {productTitle}</Text>
            <Text><b>출발일</b>: {departureDate}</Text>
            <Text><b>여행 인원</b>: {travelerCount}명</Text>
            <Text><b>예약번호</b>: {bookingId}</Text>
            <Text><b>결제 금액</b>: {won(totalPrice)}</Text>
          </Section>
          {receiptUrl ? (
            <>
              <Hr />
              <Text>
                결제 영수증: <Link href={receiptUrl}>{receiptUrl}</Link>
              </Text>
            </>
          ) : null}
        </Container>
      </Body>
    </Html>
  );
}
```

- [x] **Step 6: 템플릿 구현 — RefundCompletedEmail**

`src/shared/email/templates/RefundCompletedEmail.tsx`:

```tsx
import {
  Html,
  Head,
  Body,
  Container,
  Heading,
  Text,
  Section,
  Hr,
} from "@react-email/components";
import type { RefundCompletedEmailProps } from "./types";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export function RefundCompletedEmail({
  customerName,
  bookingId,
  productTitle,
  refundAmount,
  paymentMethod,
}: RefundCompletedEmailProps) {
  return (
    <Html lang="ko">
      <Head />
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f6f6f6" }}>
        <Container style={{ backgroundColor: "#ffffff", padding: "32px", borderRadius: "8px" }}>
          <Heading>환불이 완료되었습니다</Heading>
          <Text>{customerName}님, 요청하신 환불 처리가 완료되었습니다.</Text>
          <Hr />
          <Section>
            <Text><b>상품</b>: {productTitle}</Text>
            <Text><b>예약번호</b>: {bookingId}</Text>
            <Text><b>환불 수단</b>: {paymentMethod}</Text>
            <Text><b>환불 금액</b>: {won(refundAmount)}</Text>
          </Section>
          <Hr />
          <Text style={{ color: "#888", fontSize: "12px" }}>
            카드사·결제 수단에 따라 실제 환급까지 영업일 기준 3~5일이 소요될 수 있습니다.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
```

- [x] **Step 7: render 구현**

`src/shared/email/render.ts`:

```ts
/**
 * render.ts — EmailType + props → { subject, html, text }.
 * 워커가 발송 직전 호출. 템플릿은 평문 props만 받는 순수 컴포넌트.
 */

import { render } from "@react-email/render";
import type { EmailType } from "@prisma/client";
import { BookingConfirmationEmail } from "./templates/BookingConfirmationEmail";
import { RefundCompletedEmail } from "./templates/RefundCompletedEmail";
import type {
  BookingConfirmationEmailProps,
  RefundCompletedEmailProps,
} from "./templates/types";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// type별 props를 묶어 워커 호출부에서 타입 안전하게 분기.
export type EmailPropsByType = {
  BOOKING_CONFIRMATION: BookingConfirmationEmailProps;
  REFUND_COMPLETED: RefundCompletedEmailProps;
};

export async function renderEmail<T extends EmailType>(
  type: T,
  props: EmailPropsByType[T],
): Promise<RenderedEmail> {
  if (type === "BOOKING_CONFIRMATION") {
    const p = props as BookingConfirmationEmailProps;
    const node = BookingConfirmationEmail(p);
    return {
      subject: `[Nextour] 예약이 확정되었습니다 — ${p.productTitle}`,
      html: await render(node),
      text: await render(node, { plainText: true }),
    };
  }

  const p = props as RefundCompletedEmailProps;
  const node = RefundCompletedEmail(p);
  return {
    subject: `[Nextour] 환불이 완료되었습니다 — ${p.productTitle}`,
    html: await render(node),
    text: await render(node, { plainText: true }),
  };
}
```

- [x] **Step 8: 통과 확인**

Run: `npm test -- src/shared/email/__tests__/render.test.ts`
Expected: PASS (2 tests).

- [x] **Step 9: Commit**

```bash
git add package.json package-lock.json src/shared/email/templates src/shared/email/render.ts src/shared/email/__tests__/render.test.ts
git commit -m "feat(email): React Email templates + renderEmail"
```

---

## Task 6: 발송 provider + Dev 폴백 + env 보강 (TDD)

**Files:**
- Create: `src/shared/email/provider.ts`
- Modify: `src/shared/lib/env.ts` (prod 필수화)
- Test: `src/shared/email/__tests__/provider.test.ts`

- [x] **Step 1: 실패 테스트 작성**

dev 폴백이 Resend를 호출하지 않고 콘솔 경로로 가는지 검증.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  env: { NODE_ENV: "test", RESEND_API_KEY: "test_dummy", RESEND_FROM_EMAIL: "Nextour <no@reply.test>" },
}));

vi.mock("resend", () => ({
  Resend: vi.fn(() => ({ emails: { send: mocks.send } })),
}));
vi.mock("@/shared/lib/env", () => ({ env: mocks.env }));
vi.mock("@/shared/lib/observability", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

import { sendEmail } from "../provider";

describe("sendEmail dev 폴백", () => {
  beforeEach(() => vi.clearAllMocks());

  it("NODE_ENV!=production 이면 Resend 미호출, dev id 반환", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await sendEmail({
      to: "qa@nextour.test",
      subject: "s",
      html: "<p>h</p>",
      text: "h",
      idempotencyKey: "booking-confirmation:clbk1",
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(res.id).toBe("dev-booking-confirmation:clbk1");
    logSpy.mockRestore();
  });
});
```

- [x] **Step 2: 실패 확인**

Run: `npm test -- src/shared/email/__tests__/provider.test.ts`
Expected: FAIL ("Cannot find module '../provider'").

- [x] **Step 3: provider 구현**

`src/shared/email/provider.ts`:

```ts
/**
 * provider.ts — 메일 발송 어댑터.
 *
 * Dev 폴백: NODE_ENV !== "production" 이면 실제 Resend를 호출하지 않고 콘솔로 출력한다.
 * auth.ts(매직링크)의 useDevConsoleFallback과 동일 기준 — @nextour.test 시드 계정에
 * 실메일이 나가 바운스되는 것을 차단한다.
 *
 * 멱등: production 발송 시 Resend idempotencyKey=dedupeKey 전달 →
 * at-least-once 재시도가 고객 메일함에서 effectively-once가 된다.
 */

import { Resend } from "resend";
import { env } from "@/shared/lib/env";
import { logger } from "@/shared/lib/observability";

const useDevConsoleFallback = env.NODE_ENV !== "production";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}

export interface SendEmailResult {
  id: string | null;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (useDevConsoleFallback) {
    logger.info("email.dev_fallback", { to: input.to, subject: input.subject });
    console.log(
      `\n📧 [DEV] Email to ${input.to}\n  subject: ${input.subject}\n  ${input.text.slice(0, 200)}\n`,
    );
    return { id: `dev-${input.idempotencyKey}` };
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send(
    {
      from: env.RESEND_FROM_EMAIL ?? "Nextour <noreply@nextour.example>",
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    },
    { idempotencyKey: input.idempotencyKey },
  );

  if (error) {
    // 워커가 backoff/재시도하도록 throw — 여기서 삼키지 않는다.
    throw new Error(`resend send failed: ${error.message}`);
  }
  return { id: data?.id ?? null };
}
```

- [x] **Step 4: 통과 확인**

Run: `npm test -- src/shared/email/__tests__/provider.test.ts`
Expected: PASS (1 test).

- [x] **Step 5: env prod 필수화**

`src/shared/lib/env.ts`의 production superRefine 루프 배열에 `RESEND_API_KEY`, `RESEND_FROM_EMAIL` 추가:

```ts
      for (const key of [
        "TOSS_CLIENT_KEY",
        "TOSS_SECRET_KEY",
        "CRON_SECRET",
        "RESEND_API_KEY",
        "RESEND_FROM_EMAIL",
      ] as const) {
```

- [x] **Step 6: typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/shared/email/provider.ts src/shared/email/__tests__/provider.test.ts src/shared/lib/env.ts
git commit -m "feat(email): Resend provider + dev console fallback + prod env guard"
```

---

## Task 7: Hydration 로더 (소유 entity, TDD)

**Files:**
- Create: `src/entities/booking/api/getBookingConfirmationEmailData.ts`
- Create: `src/entities/payment/api/getRefundCompletedEmailData.ts`
- Test: `src/entities/booking/api/__tests__/getBookingConfirmationEmailData.test.ts`
- Test: `src/entities/payment/api/__tests__/getRefundCompletedEmailData.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (booking 확정 데이터)**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  db: { booking: { findUnique: vi.fn() } },
}));
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));

import { getBookingConfirmationEmailData } from "../getBookingConfirmationEmailData";

describe("getBookingConfirmationEmailData", () => {
  beforeEach(() => vi.clearAllMocks());

  it("booking→user/departure/product/payment 조립 후 props 반환", async () => {
    mocks.db.booking.findUnique.mockResolvedValue({
      id: "clbk1",
      adultCount: 2,
      childCount: 1,
      infantCount: 0,
      totalPrice: 1290000,
      user: { email: "go@nextour.test", name: "홍길동" },
      departure: {
        departureDate: new Date("2026-08-15T00:00:00Z"),
        product: { title: "오사카 3박4일" },
      },
      payments: [{ receiptUrl: "https://r.example/x", status: "PAID" }],
    });

    const out = await getBookingConfirmationEmailData("clbk1");
    expect(out).toEqual({
      recipientEmail: "go@nextour.test",
      props: {
        customerName: "홍길동",
        bookingId: "clbk1",
        productTitle: "오사카 3박4일",
        departureDate: "2026-08-15",
        travelerCount: 3,
        totalPrice: 1290000,
        receiptUrl: "https://r.example/x",
      },
    });
  });

  it("booking 없으면 null", async () => {
    mocks.db.booking.findUnique.mockResolvedValue(null);
    expect(await getBookingConfirmationEmailData("missing")).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/entities/booking/api/__tests__/getBookingConfirmationEmailData.test.ts`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: booking 로더 구현**

`src/entities/booking/api/getBookingConfirmationEmailData.ts`:

```ts
/**
 * getBookingConfirmationEmailData.ts — 예약확정 메일 데이터 단일쿼리 조립.
 * 워커가 발송 직전 호출. include로 N+1 차단. booking/payment 부재 시 null.
 */

import { db } from "@/shared/lib/db";
import type { BookingConfirmationEmailProps } from "@/shared/email";

export interface BookingConfirmationEmailData {
  recipientEmail: string;
  props: BookingConfirmationEmailProps;
}

export async function getBookingConfirmationEmailData(
  bookingId: string,
): Promise<BookingConfirmationEmailData | null> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      adultCount: true,
      childCount: true,
      infantCount: true,
      totalPrice: true,
      user: { select: { email: true, name: true } },
      departure: {
        select: {
          departureDate: true,
          product: { select: { title: true } },
        },
      },
      payments: {
        where: { status: "PAID" },
        select: { receiptUrl: true },
        take: 1,
      },
    },
  });

  if (!booking) return null;

  return {
    recipientEmail: booking.user.email,
    props: {
      customerName: booking.user.name ?? "고객",
      bookingId: booking.id,
      productTitle: booking.departure.product.title,
      departureDate: booking.departure.departureDate.toISOString().slice(0, 10),
      travelerCount:
        booking.adultCount + booking.childCount + booking.infantCount,
      totalPrice: booking.totalPrice,
      receiptUrl: booking.payments[0]?.receiptUrl ?? null,
    },
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- src/entities/booking/api/__tests__/getBookingConfirmationEmailData.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: 실패 테스트 작성 (refund 데이터)**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  db: { booking: { findUnique: vi.fn() } },
}));
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));

import { getRefundCompletedEmailData } from "../getRefundCompletedEmailData";

describe("getRefundCompletedEmailData", () => {
  beforeEach(() => vi.clearAllMocks());

  it("환불 금액·수단 조립 후 props 반환", async () => {
    mocks.db.booking.findUnique.mockResolvedValue({
      id: "clbk2",
      user: { email: "kim@nextour.test", name: "김여행" },
      departure: { product: { title: "다낭 4박5일" } },
      payments: [{ amount: 880000, method: "CARD", status: "CANCELED" }],
    });

    const out = await getRefundCompletedEmailData("clbk2");
    expect(out).toEqual({
      recipientEmail: "kim@nextour.test",
      props: {
        customerName: "김여행",
        bookingId: "clbk2",
        productTitle: "다낭 4박5일",
        refundAmount: 880000,
        paymentMethod: "카드",
      },
    });
  });

  it("환불 대상 payment 없으면 null", async () => {
    mocks.db.booking.findUnique.mockResolvedValue({
      id: "clbk2",
      user: { email: "x@y.test", name: null },
      departure: { product: { title: "t" } },
      payments: [],
    });
    expect(await getRefundCompletedEmailData("clbk2")).toBeNull();
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `npm test -- src/entities/payment/api/__tests__/getRefundCompletedEmailData.test.ts`
Expected: FAIL (모듈 없음).

- [ ] **Step 7: refund 로더 구현**

`src/entities/payment/api/getRefundCompletedEmailData.ts`:

```ts
/**
 * getRefundCompletedEmailData.ts — 환불완료 메일 데이터 단일쿼리 조립.
 * CANCELED payment 1건에서 환불 금액·수단을 읽는다. 없으면 null.
 */

import { db } from "@/shared/lib/db";
import type { RefundCompletedEmailProps } from "@/shared/email";

export interface RefundCompletedEmailData {
  recipientEmail: string;
  props: RefundCompletedEmailProps;
}

const METHOD_LABEL: Record<string, string> = {
  CARD: "카드",
  TRANSFER: "계좌이체",
  VIRTUAL_ACCOUNT: "가상계좌",
};

export async function getRefundCompletedEmailData(
  bookingId: string,
): Promise<RefundCompletedEmailData | null> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      user: { select: { email: true, name: true } },
      departure: { select: { product: { select: { title: true } } } },
      payments: {
        where: { status: "CANCELED" },
        select: { amount: true, method: true },
        orderBy: { canceledAt: "desc" },
        take: 1,
      },
    },
  });

  const refunded = booking?.payments[0];
  if (!booking || !refunded) return null;

  return {
    recipientEmail: booking.user.email,
    props: {
      customerName: booking.user.name ?? "고객",
      bookingId: booking.id,
      productTitle: booking.departure.product.title,
      refundAmount: refunded.amount,
      paymentMethod: METHOD_LABEL[refunded.method] ?? refunded.method,
    },
  };
}
```

- [ ] **Step 8: 통과 확인**

Run: `npm test -- src/entities/payment/api/__tests__/getRefundCompletedEmailData.test.ts`
Expected: PASS (2 tests).

> 참고: `shared/email` barrel(`BookingConfirmationEmailProps`/`RefundCompletedEmailProps` re-export)은 Task 9 Step에서 생성한다. 이 Task 구현이 먼저 import하므로, barrel 미생성으로 typecheck가 깨지면 Task 9의 `src/shared/email/index.ts` 생성을 먼저 수행해도 된다 (둘은 같은 커밋 묶음으로 봐도 무방).

- [ ] **Step 9: Commit**

```bash
git add src/entities/booking/api/getBookingConfirmationEmailData.ts src/entities/payment/api/getRefundCompletedEmailData.ts src/entities/booking/api/__tests__/getBookingConfirmationEmailData.test.ts src/entities/payment/api/__tests__/getRefundCompletedEmailData.test.ts
git commit -m "feat(email): hydration loaders for confirmation/refund emails"
```

---

## Task 8: 워커 (claim→hydrate→render→send, TDD)

**Files:**
- Create: `src/shared/email/index.ts` (barrel — Task 7/8이 import)
- Create: `src/shared/lib/email-job/worker.ts`
- Test: `src/shared/lib/email-job/__tests__/worker.test.ts`

- [ ] **Step 1: shared/email barrel 생성**

`src/shared/email/index.ts`:

```ts
export { renderEmail } from "./render";
export type { RenderedEmail, EmailPropsByType } from "./render";
export { sendEmail } from "./provider";
export type { SendEmailInput, SendEmailResult } from "./provider";
export type {
  BookingConfirmationEmailProps,
  RefundCompletedEmailProps,
} from "./templates/types";
```

- [ ] **Step 2: 실패 테스트 작성**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  db: {
    emailJob: {
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  getBookingConfirmationEmailData: vi.fn(),
  getRefundCompletedEmailData: vi.fn(),
  renderEmail: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
vi.mock("@/entities/booking", () => ({
  getBookingConfirmationEmailData: mocks.getBookingConfirmationEmailData,
}));
vi.mock("@/entities/payment", () => ({
  getRefundCompletedEmailData: mocks.getRefundCompletedEmailData,
}));
vi.mock("@/shared/email", () => ({
  renderEmail: mocks.renderEmail,
  sendEmail: mocks.sendEmail,
}));
vi.mock("@/shared/lib/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  metrics: { incr: vi.fn() },
  captureException: vi.fn(),
}));

import { processEmailJobBatch } from "../worker";

// $transaction(cb) 형태(claim)는 cb를 tx로 즉시 실행. updateMany claim 성공=count 1.
function wireClaimSuccess() {
  mocks.db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({ emailJob: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }),
  );
}

describe("processEmailJobBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wireClaimSuccess();
  });

  it("BOOKING_CONFIRMATION job: hydrate→render→send→SUCCEEDED", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([{ id: "clej1" }]);
    mocks.db.emailJob.findUniqueOrThrow.mockResolvedValue({
      id: "clej1",
      type: "BOOKING_CONFIRMATION",
      dedupeKey: "booking-confirmation:clbk1",
      bookingId: "clbk1",
      attempts: 0,
    });
    mocks.getBookingConfirmationEmailData.mockResolvedValue({
      recipientEmail: "go@nextour.test",
      props: { productTitle: "오사카" },
    });
    mocks.renderEmail.mockResolvedValue({ subject: "s", html: "<p>h</p>", text: "h" });
    mocks.sendEmail.mockResolvedValue({ id: "resend_123" });

    const res = await processEmailJobBatch({ limit: 5 });

    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "go@nextour.test",
        idempotencyKey: "booking-confirmation:clbk1",
      }),
    );
    expect(mocks.db.emailJob.update).toHaveBeenCalledWith({
      where: { id: "clej1" },
      data: { status: "SUCCEEDED", sentTo: "go@nextour.test", providerId: "resend_123" },
    });
    expect(res).toMatchObject({ processed: 1, succeeded: 1 });
  });

  it("hydration null → 영구 FAILED (재시도 무의미)", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([{ id: "clej2" }]);
    mocks.db.emailJob.findUniqueOrThrow.mockResolvedValue({
      id: "clej2",
      type: "REFUND_COMPLETED",
      dedupeKey: "refund-completed:clbk2",
      bookingId: "clbk2",
      attempts: 0,
    });
    mocks.getRefundCompletedEmailData.mockResolvedValue(null);

    const res = await processEmailJobBatch({ limit: 5 });

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.db.emailJob.update).toHaveBeenCalledWith({
      where: { id: "clej2" },
      data: { status: "FAILED", lastError: "hydration data not found" },
    });
    expect(res).toMatchObject({ processed: 1, failed: 1 });
  });

  it("send 실패 + attempts<MAX → PENDING backoff", async () => {
    mocks.db.emailJob.findMany.mockResolvedValue([{ id: "clej3" }]);
    mocks.db.emailJob.findUniqueOrThrow.mockResolvedValue({
      id: "clej3",
      type: "BOOKING_CONFIRMATION",
      dedupeKey: "booking-confirmation:clbk3",
      bookingId: "clbk3",
      attempts: 1,
    });
    mocks.getBookingConfirmationEmailData.mockResolvedValue({
      recipientEmail: "a@b.test",
      props: {},
    });
    mocks.renderEmail.mockResolvedValue({ subject: "s", html: "h", text: "h" });
    mocks.sendEmail.mockRejectedValue(new Error("resend 503"));

    const res = await processEmailJobBatch({ limit: 5 });

    const call = mocks.db.emailJob.update.mock.calls[0][0];
    expect(call.data.status).toBe("PENDING");
    expect(call.data.attempts).toEqual({ increment: 1 });
    expect(call.data.nextRunAt).toBeInstanceOf(Date);
    expect(res).toMatchObject({ processed: 1, failed: 1 });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm test -- src/shared/lib/email-job/__tests__/worker.test.ts`
Expected: FAIL ("Cannot find module '../worker'").

- [ ] **Step 4: 워커 구현**

`src/shared/lib/email-job/worker.ts`:

```ts
/**
 * worker.ts — EmailJob 배치 처리 워커.
 *
 * EmbeddingJob/RefundJob 동형:
 *  - CAS claim(updateMany status guard) — 다중 cron 인스턴스 동시 안전(TOCTOU 차단)
 *  - 외부 IO(sendEmail=Resend)는 DB Tx 바깥 (ADR-0003)
 *  - per-job try/catch 격리, stale IN_PROGRESS reaper(10분), MAX_ATTEMPTS=5
 *  - 발송 멱등: idempotencyKey=dedupeKey → at-least-once가 effectively-once
 *
 * 허용 import: @prisma/client, @/shared/lib/db, @/shared/email,
 *   @/entities/booking·@/entities/payment(hydration 로더 — EmbeddingJob 워커가
 *   @/entities/product를 쓰는 것과 동일한 백그라운드 워커 예외).
 * 금지: features/, widgets/, app/
 */

import { Prisma, EmailJobStatus } from "@prisma/client";
import { db } from "@/shared/lib/db";
import { getBookingConfirmationEmailData } from "@/entities/booking";
import { getRefundCompletedEmailData } from "@/entities/payment";
import { renderEmail, sendEmail } from "@/shared/email";
import { logger, metrics, captureException } from "@/shared/lib/observability";

export interface BatchResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

const STALE_IN_PROGRESS_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

function computeBackoff(newAttempts: number): Date {
  const n = Math.max(1, newAttempts);
  const delayMs = Math.min(2 ** n * 60_000, 3_600_000);
  return new Date(Date.now() + delayMs);
}

async function listDueEmailJobs(limit: number): Promise<{ id: string }[]> {
  const now = new Date();
  const staleBoundary = new Date(now.getTime() - STALE_IN_PROGRESS_MS);
  return db.emailJob.findMany({
    where: {
      OR: [
        { status: EmailJobStatus.PENDING, nextRunAt: { lte: now } },
        { status: EmailJobStatus.IN_PROGRESS, updatedAt: { lt: staleBoundary } },
      ],
    },
    orderBy: { nextRunAt: "asc" },
    take: limit,
    select: { id: true },
  });
}

async function claimEmailJob(
  tx: Prisma.TransactionClient,
  jobId: string,
): Promise<boolean> {
  const now = new Date();
  const staleBoundary = new Date(now.getTime() - STALE_IN_PROGRESS_MS);
  const result = await tx.emailJob.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: EmailJobStatus.PENDING, nextRunAt: { lte: now } },
        { status: EmailJobStatus.IN_PROGRESS, updatedAt: { lt: staleBoundary } },
      ],
    },
    data: { status: EmailJobStatus.IN_PROGRESS },
  });
  return result.count > 0;
}

// type별 hydration — null이면 데이터 부재(삭제 등) → 영구 실패 신호.
async function hydrate(
  type: "BOOKING_CONFIRMATION" | "REFUND_COMPLETED",
  bookingId: string,
): Promise<{ recipientEmail: string; props: unknown } | null> {
  if (type === "BOOKING_CONFIRMATION") {
    return getBookingConfirmationEmailData(bookingId);
  }
  return getRefundCompletedEmailData(bookingId);
}

async function processOneJob(
  jobId: string,
): Promise<"succeeded" | "failed" | "skipped"> {
  const claimed = await db.$transaction((tx) => claimEmailJob(tx, jobId));
  if (!claimed) return "skipped";

  const job = await db.emailJob.findUniqueOrThrow({
    where: { id: jobId },
    select: { id: true, type: true, dedupeKey: true, bookingId: true, attempts: true },
  });

  const data = await hydrate(job.type, job.bookingId);
  if (!data) {
    await db.emailJob.update({
      where: { id: jobId },
      data: { status: EmailJobStatus.FAILED, lastError: "hydration data not found" },
    });
    metrics.incr("cron.email-job.hydration_missing");
    return "failed";
  }

  // render + send는 Tx 바깥 (ADR-0003). 실패해도 claim 손상 없음.
  try {
    const rendered = await renderEmail(
      job.type,
      data.props as never,
    );
    const sent = await sendEmail({
      to: data.recipientEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: job.dedupeKey,
    });

    await db.emailJob.update({
      where: { id: jobId },
      data: {
        status: EmailJobStatus.SUCCEEDED,
        sentTo: data.recipientEmail,
        providerId: sent.id,
      },
    });
    return "succeeded";
  } catch (err) {
    const newAttempts = job.attempts + 1;
    const lastError = String(err);
    captureException(err, { extras: { jobId, retry: true } });

    if (newAttempts >= MAX_ATTEMPTS) {
      await db.emailJob.update({
        where: { id: jobId },
        data: {
          status: EmailJobStatus.FAILED,
          attempts: { increment: 1 },
          lastError,
        },
      });
      return "failed";
    }

    await db.emailJob.update({
      where: { id: jobId },
      data: {
        status: EmailJobStatus.PENDING,
        attempts: { increment: 1 },
        nextRunAt: computeBackoff(newAttempts),
        lastError,
      },
    });
    return "failed";
  }
}

export async function processEmailJobBatch(opts: {
  limit: number;
}): Promise<BatchResult> {
  const jobs = await listDueEmailJobs(opts.limit);
  if (jobs.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0 };
  }

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const { id } of jobs) {
    try {
      const outcome = await processOneJob(id);
      if (outcome === "succeeded") succeeded++;
      else if (outcome === "failed") failed++;
      else skipped++;
    } catch (err) {
      // claim 후 미처리 예외 → IN_PROGRESS로 남아 stale reaper가 회수.
      logger.error(
        "cron.email-job.unexpected",
        err instanceof Error ? err : new Error(String(err)),
        { jobId: id },
      );
      failed++;
    }
  }

  return { processed: jobs.length, succeeded, failed, skipped };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm test -- src/shared/lib/email-job/__tests__/worker.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: email-job barrel 생성**

`src/shared/lib/email-job/index.ts`:

```ts
export { enqueueEmailJob } from "./enqueue";
export type { EnqueueEmailJobArgs } from "./enqueue";
export { processEmailJobBatch } from "./worker";
export type { BatchResult } from "./worker";
```

- [ ] **Step 7: Commit**

```bash
git add src/shared/email/index.ts src/shared/lib/email-job/worker.ts src/shared/lib/email-job/index.ts src/shared/lib/email-job/__tests__/worker.test.ts
git commit -m "feat(email): batch worker (claim→hydrate→render→send)"
```

---

## Task 9: Cron 라우트 + barrels + vercel.json (TDD)

**Files:**
- Create: `src/app/api/cron/email-job/route.ts`
- Test: `src/app/api/cron/email-job/__tests__/route.test.ts`
- Modify: `src/entities/booking/index.ts`, `src/entities/payment/index.ts` (로더 export)
- Modify: `vercel.json`

- [ ] **Step 1: entity barrel export 추가**

`src/entities/booking/index.ts`에 추가:

```ts
export { getBookingConfirmationEmailData } from "./api/getBookingConfirmationEmailData";
export type { BookingConfirmationEmailData } from "./api/getBookingConfirmationEmailData";
```

`src/entities/payment/index.ts`에 추가:

```ts
export { getRefundCompletedEmailData } from "./api/getRefundCompletedEmailData";
export type { RefundCompletedEmailData } from "./api/getRefundCompletedEmailData";
```

- [ ] **Step 2: 실패 테스트 작성**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  processEmailJobBatch: vi.fn(),
  env: { CRON_SECRET: "x".repeat(32) },
}));

vi.mock("@/shared/lib/email-job/worker", () => ({
  processEmailJobBatch: mocks.processEmailJobBatch,
}));
vi.mock("@/shared/lib/env", () => ({ env: mocks.env }));
vi.mock("@/shared/lib/observability", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
  metrics: { incr: vi.fn() },
}));

import { GET } from "../route";

function req(auth?: string) {
  return new NextRequest("http://localhost/api/cron/email-job", {
    headers: auth ? { authorization: auth } : {},
  });
}

describe("GET /api/cron/email-job", () => {
  beforeEach(() => vi.clearAllMocks());

  it("CRON_SECRET 불일치 → 401", async () => {
    const res = await GET(req("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(mocks.processEmailJobBatch).not.toHaveBeenCalled();
  });

  it("인증 통과 → 배치 위임 + 결과 JSON", async () => {
    mocks.processEmailJobBatch.mockResolvedValue({
      processed: 2, succeeded: 2, failed: 0, skipped: 0,
    });
    const res = await GET(req(`Bearer ${"x".repeat(32)}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ processed: 2, succeeded: 2 });
    expect(mocks.processEmailJobBatch).toHaveBeenCalledWith({ limit: 10 });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm test -- src/app/api/cron/email-job/__tests__/route.test.ts`
Expected: FAIL ("Cannot find module '../route'").

- [ ] **Step 4: 라우트 구현**

`src/app/api/cron/email-job/route.ts`:

```ts
/**
 * EmailJob 배치 처리 cron worker 엔드포인트.
 *   GET /api/cron/email-job
 *   Authorization: Bearer ${CRON_SECRET}
 *
 * force-dynamic: ADR-0020 안전 도메인(cron). runtime=nodejs: 워커가 Prisma/Resend 사용.
 */

import { NextRequest, NextResponse } from "next/server";
import { env } from "@/shared/lib/env";
import { processEmailJobBatch } from "@/shared/lib/email-job/worker";
import { logger, metrics } from "@/shared/lib/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(req: NextRequest): boolean {
  if (!env.CRON_SECRET) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${env.CRON_SECRET}`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processEmailJobBatch({ limit: 10 });
    logger.info("cron.email-job.run", { ...result });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      "cron.email-job.unexpected_error",
      err instanceof Error ? err : new Error(msg),
    );
    metrics.incr("cron.email-job.unexpected_error");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm test -- src/app/api/cron/email-job/__tests__/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: vercel.json cron 등록**

`vercel.json`의 `crons` 배열에 추가:

```json
    { "path": "/api/cron/email-job", "schedule": "*/2 * * * *" }
```

- [ ] **Step 7: Commit**

```bash
git add src/app/api/cron/email-job src/entities/booking/index.ts src/entities/payment/index.ts vercel.json
git commit -m "feat(email): cron route + barrel exports + vercel schedule"
```

---

## Task 10: 종합 검증 + 문서 갱신 (QA)

**Files:**
- 검증만 (코드 변경 없음) + `CLAUDE.md` §8 컨텍스트 노트

- [ ] **Step 1: 전체 타입체크**

Run: `npm run typecheck`
Expected: PASS (0 errors).

- [ ] **Step 2: 전체 테스트**

Run: `npm test`
Expected: 신규 7개 파일 포함 전체 PASS. 신규 테스트 수: emailPolicy(6) + enqueue(2) + outbox(3) + render(2) + provider(1) + 로더(4) + worker(3) + route(2) = 23.

- [ ] **Step 3: lint**

Run: `npm run lint`
Expected: PASS (no warnings on new files).

- [ ] **Step 4: FSD 경계 자가 점검 (Architect)**

Run: `grep -rn "from \"@/features\|from \"@/widgets\|from \"@/app" src/shared/email src/shared/lib/email-job`
Expected: 출력 없음 (shared가 상위 레이어 import 0).

Run: `grep -rn "'use client'" src/shared/email`
Expected: 출력 없음 (React Email은 서버 렌더).

- [ ] **Step 5: 플랜 체크박스 검증**

Run: `grep -n "\- \[ \]" docs/superpowers/plans/2026-06-03-phase-5a-email-pipeline-plan.md`
Expected: 모든 완료 Task의 미체크 항목 0 (이 시점까지 처리된 Task 한정).

- [ ] **Step 6: Dev 폴백 런타임 증거 (수동 위임 — QA)**

자동화 불가(실 SMTP 부재). 사용자 수동 확인 절차:
1. `npm run dev` 로 서버 기동.
2. 결제 Mock(localhost:4242)로 한 건 결제 완료 → booking PAID 전이.
3. `*/2` cron 또는 수동 호출 `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/email-job`.
4. 기대: dev 콘솔에 `📧 [DEV] Email to ...@... subject: [Nextour] 예약이 확정되었습니다 ...` 출력, 실제 발송 0.
실패 시: 콘솔 로그 전문 + EmailJob 행 status(`npx prisma studio`) 첨부.

- [ ] **Step 7: CLAUDE.md §8 컨텍스트 노트 추가**

§8의 "다음 작업자의 혼란 방지 노트"에 한 줄 추가:

```markdown
  - "거래 종료 메일은 어디서 트리거되나?" → (Phase 5-A) `transitionStatusTx`의 트랜잭셔널 아웃박스. `emailJobForTransition(from,to)`가 PAID 전이=예약확정, PAID/READY→CANCELED=환불완료를 판단해 같은 Tx에 `EmailJob` 적재(유실 0). cron(`/api/cron/email-job`, `*/2`)이 EmbeddingJob 동형 워커로 픽업→hydrate→React Email 렌더→Resend 발송(멱등키=dedupeKey). NODE_ENV≠production은 콘솔 폴백(바운스 차단). 환불 코드(refund.ts/refundRetry.ts)는 미수정 — 둘 다 transitionStatus 경유라 자동 커버.
```

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md docs/superpowers/plans/2026-06-03-phase-5a-email-pipeline-plan.md
git commit -m "docs(email): Phase 5-A verification + CLAUDE.md context note"
```

- [ ] **Step 9: ADR 작성 제안 (보고 시점)**

이 에픽은 ADR-0030 후보("트랜잭셔널 아웃박스 단일 훅 + Resend 멱등키 effectively-once"). 사용자 승인 시 `docs/superpowers/adr/0030-*.md` 작성. 거부 대안: 호출부 직접 발송(유실 창)/경로별 개별 enqueue(SSOT 분산)/payload JSON 박제(stale).

---

## Self-Review (작성자 점검 완료)

- **Spec coverage:** D1 아웃박스→Task4, D2 정책→Task2, D3 스키마→Task1, D4 멱등(enqueue/claim/Resend키)→Task3·8, D5 provider+env→Task6, D6 템플릿→Task5, D7 로더→Task7, D8 워커+cron→Task8·9. 전 항목 매핑됨.
- **Placeholder scan:** TBD/TODO 없음. 모든 코드 스텝에 완전한 코드 블록.
- **Type consistency:** `EmailJobDescriptor{type,dedupeKey}`, `enqueueEmailJob(tx,{type,dedupeKey,bookingId})`, `renderEmail(type,props)→{subject,html,text}`, `sendEmail(input)→{id}`, 로더 `{recipientEmail,props}` — Task 간 시그니처 일치 확인.
- **알려진 순서 의존:** Task 7이 `@/shared/email`(props 타입)을 import하나 barrel은 Task 8 Step 1에서 생성 → Task 7 Step 8 주석에 명시(barrel 먼저 생성 허용). 단일 PR 내 typecheck는 Task 9 완료 시점에 그린.
