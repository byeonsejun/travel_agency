# Phase 4-A Departure CMS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> ⚠️ CLAUDE.md §4.2 — 본 plan의 모든 체크박스는 미완료(`- [ ]`)로 초기화되어 있다. Task 완료 즉시 `[ ]`→`[x]`로 갱신(§4.1).
> 선행 spec: [`docs/superpowers/specs/2026-06-02-phase-4a-departure-cms.md`](../specs/2026-06-02-phase-4a-departure-cms.md)

**Goal:** 관리자가 출발일(Departure)을 생성·수정·확정·마감·재개봉·취소하는 CMS를, 초과예약(TOCTOU)과 가격 무결성을 서버 단일 경로에서 방어하며 구축한다.

**Architecture:** RSC-우선 풀페이지 폼(Approach 1). 읽기=RSC, 쓰기=Server Action. 좌석/가격/상태 가드는 전부 entities/features 서버 레이어. capacity 축소·취소 가드는 Prisma `updateMany` 리터럴 CAS(raw 회피), 상태 전이는 booking `assertTransition`과 동일한 화이트리스트 SSOT. 캐시 무효화는 checkout과 동일 contract(`tagDeparturesByProduct`) 재사용.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Prisma 5(PostgreSQL), Zod 3, React 19(`useActionState`), Vitest 2(TDD).

---

## 결정사항 (spec D1~D5)

- **D1**: `CANCELED` 전이는 `bookedSeats === 0`일 때만 — cascade 환불 범위 외
- **D2**: 가격 수정 항상 허용 + 예약 존재 시 경고 배너 (`totalPrice`는 스냅샷이라 기존 예약 면역)
- **D3**: capacity 축소는 `bookedSeats <= newCapacity` race-free CAS
- **D4**: CONFIRMED 수동 전이 (minPax 자동확정 없음)
- **D5**: `CLOSED → SCHEDULED` reopen 허용

## 사전 확인 — 스키마 변경 불필요

`prisma/schema.prisma`의 `Departure` 모델과 `enum DepartureStatus { SCHEDULED CONFIRMED CLOSED CANCELED }`는 **이미 존재**하며 `version`(낙관적 락 보조)·`bookedSeats`·`@@unique([productId, departureDate])`도 갖춰져 있다. **본 plan에 Prisma 마이그레이션은 없다.**

## File Structure

| 종류 | 경로 | 책임 |
|---|---|---|
| 신규 | `src/entities/departure/model/transitions.ts` | DepartureStatus 상태머신 SSOT (순수) |
| 신규 | `src/entities/departure/api/mutations.ts` | create/update(CAS)/transition(가드) + 도메인 에러 |
| 수정 | `src/entities/departure/api/queries.ts` | admin 읽기 쿼리 2종 추가 |
| 수정 | `src/entities/departure/model/types.ts` | `AdminDepartureRow` 타입 추가 |
| 수정 | `src/entities/departure/index.ts` | barrel 공개 API 확장 |
| 신규 | `src/features/admin-departure/model/schemas.ts` | action 입력 Zod (form schema 재사용) |
| 신규 | `src/features/admin-departure/server/actions.ts` | create/update/transition Server Actions |
| 신규 | `src/features/admin-departure/ui/DepartureForm.tsx` | `useActionState` 폼 + 경고 배너 (`'use client'`) |
| 신규 | `src/features/admin-departure/index.ts` | barrel |
| 신규 | `src/app/(admin)/admin/products/[id]/departures/page.tsx` | 목록 (RSC) |
| 신규 | `src/app/(admin)/admin/products/[id]/departures/new/page.tsx` | 생성 |
| 신규 | `src/app/(admin)/admin/products/[id]/departures/[depId]/edit/page.tsx` | 편집 + 상태 전이 버튼 |
| 수정 | `src/app/(admin)/admin/products/[id]/edit/page.tsx` | "출발일 관리" 링크 |
| 후보 | `docs/superpowers/adr/0027-departure-cancel-scope-and-literal-cas.md` | ADR (사용자 승인 시) |
| 수정 | `CLAUDE.md` §8 | B/Phase 4-A 완료 노트 |

---

## Task 1 — DepartureStatus 상태머신 SSOT (TDD)

> 순수 함수. booking `entities/booking/model/transitions.ts` 패턴 미러. 부수효과 0.

**Files:**
- Create: `src/entities/departure/model/transitions.ts`
- Test: `src/entities/departure/model/__tests__/transitions.test.ts`

- [x] **Step 1: 실패 테스트 작성**

```ts
// src/entities/departure/model/__tests__/transitions.test.ts
import { describe, it, expect } from "vitest";
import {
  assertDepartureTransition,
  requiresEmptySeats,
  InvalidDepartureTransitionError,
} from "../transitions";

describe("assertDepartureTransition — 허용 전이", () => {
  it("SCHEDULED → CONFIRMED 허용", () => {
    expect(() => assertDepartureTransition("SCHEDULED", "CONFIRMED")).not.toThrow();
  });
  it("SCHEDULED → CLOSED 허용", () => {
    expect(() => assertDepartureTransition("SCHEDULED", "CLOSED")).not.toThrow();
  });
  it("SCHEDULED → CANCELED 허용", () => {
    expect(() => assertDepartureTransition("SCHEDULED", "CANCELED")).not.toThrow();
  });
  it("CONFIRMED → CLOSED 허용", () => {
    expect(() => assertDepartureTransition("CONFIRMED", "CLOSED")).not.toThrow();
  });
  it("CONFIRMED → CANCELED 허용", () => {
    expect(() => assertDepartureTransition("CONFIRMED", "CANCELED")).not.toThrow();
  });
  it("CLOSED → SCHEDULED 허용 (reopen, D5)", () => {
    expect(() => assertDepartureTransition("CLOSED", "SCHEDULED")).not.toThrow();
  });
  it("CLOSED → CANCELED 허용", () => {
    expect(() => assertDepartureTransition("CLOSED", "CANCELED")).not.toThrow();
  });
});

describe("assertDepartureTransition — 금지 전이", () => {
  it("CANCELED → * 전부 금지 (terminal)", () => {
    expect(() => assertDepartureTransition("CANCELED", "SCHEDULED")).toThrow(
      InvalidDepartureTransitionError,
    );
    expect(() => assertDepartureTransition("CANCELED", "CLOSED")).toThrow(
      InvalidDepartureTransitionError,
    );
  });
  it("CONFIRMED → SCHEDULED 금지 (역행 불가)", () => {
    expect(() => assertDepartureTransition("CONFIRMED", "SCHEDULED")).toThrow(
      InvalidDepartureTransitionError,
    );
  });
  it("SCHEDULED → SCHEDULED 자기전이 금지", () => {
    expect(() => assertDepartureTransition("SCHEDULED", "SCHEDULED")).toThrow(
      InvalidDepartureTransitionError,
    );
  });
});

describe("requiresEmptySeats — 취소만 좌석 비움 요구 (D1)", () => {
  it("CANCELED는 true", () => {
    expect(requiresEmptySeats("CANCELED")).toBe(true);
  });
  it("CLOSED/CONFIRMED/SCHEDULED는 false", () => {
    expect(requiresEmptySeats("CLOSED")).toBe(false);
    expect(requiresEmptySeats("CONFIRMED")).toBe(false);
    expect(requiresEmptySeats("SCHEDULED")).toBe(false);
  });
});
```

- [x] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/entities/departure/model/__tests__/transitions.test.ts`
Expected: FAIL — `Cannot find module '../transitions'`

- [x] **Step 3: 구현**

```ts
// src/entities/departure/model/transitions.ts
import type { DepartureStatus } from "@prisma/client";

// booking ALLOWED_TRANSITIONS와 동일한 화이트리스트 SSOT 패턴.
// CANCELED는 terminal. CLOSED→SCHEDULED는 reopen(D5).
export const ALLOWED_DEPARTURE_TRANSITIONS: Record<
  DepartureStatus,
  DepartureStatus[]
> = {
  SCHEDULED: ["CONFIRMED", "CLOSED", "CANCELED"],
  CONFIRMED: ["CLOSED", "CANCELED"],
  CLOSED: ["SCHEDULED", "CANCELED"],
  CANCELED: [],
};

export class InvalidDepartureTransitionError extends Error {
  constructor(
    public readonly from: DepartureStatus,
    public readonly to: DepartureStatus,
  ) {
    super(`Invalid departure transition: ${from} → ${to}`);
    this.name = "InvalidDepartureTransitionError";
  }
}

export function assertDepartureTransition(
  from: DepartureStatus,
  to: DepartureStatus,
): void {
  if (!ALLOWED_DEPARTURE_TRANSITIONS[from].includes(to)) {
    throw new InvalidDepartureTransitionError(from, to);
  }
}

// CANCELED 전이만 추가로 bookedSeats === 0 가드 필요(D1) — DB 상태 의존이라
// 순수함수가 아닌 mutation 레이어에서 원자적으로 처리. 여기서는 "요구 여부"만 판단.
export function requiresEmptySeats(to: DepartureStatus): boolean {
  return to === "CANCELED";
}

// UI 전이 버튼 노출 게이트용 — 현재 status에서 갈 수 있는 다음 status 목록.
export function allowedNextStatuses(from: DepartureStatus): DepartureStatus[] {
  return ALLOWED_DEPARTURE_TRANSITIONS[from];
}
```

- [x] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/entities/departure/model/__tests__/transitions.test.ts`
Expected: PASS (전 케이스)

- [x] **Step 5: 커밋**

```bash
git add src/entities/departure/model/transitions.ts src/entities/departure/model/__tests__/transitions.test.ts
git commit -m "feat(departure): status transition state machine SSOT (4A Task 1)"
```

---

## Task 2 — mutations + admin 읽기 쿼리 (TDD)

> 💳 Domain Booking + ⚙️ Backend 필수. capacity 축소 CAS·취소 가드·낙관적 status 가드가 핵심.

**Files:**
- Create: `src/entities/departure/api/mutations.ts`
- Modify: `src/entities/departure/api/queries.ts` (admin 읽기 2종 추가)
- Modify: `src/entities/departure/model/types.ts` (`AdminDepartureRow` 추가)
- Modify: `src/entities/departure/index.ts` (barrel)
- Test: `src/entities/departure/api/__tests__/mutations.test.ts`

- [x] **Step 1: 실패 테스트 작성**

```ts
// src/entities/departure/api/__tests__/mutations.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    departure: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));

import {
  createDeparture,
  updateDeparture,
  transitionDepartureStatus,
  CapacityBelowBookedError,
  DepartureDateConflictError,
  DepartureHasBookingsError,
  StaleDepartureStatusError,
} from "../mutations";
import { InvalidDepartureTransitionError } from "../../model/transitions";
import { Prisma } from "@prisma/client";

const baseForm = {
  departureDate: new Date("2026-09-01"),
  returnDate: new Date("2026-09-05"),
  priceAdult: 1_000_000,
  priceChild: 700_000,
  priceInfant: 0,
  capacity: 20,
  minPax: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createDeparture", () => {
  it("정상 생성 시 id 반환", async () => {
    mocks.db.departure.create.mockResolvedValue({ id: "dep_1" });
    const id = await createDeparture("prod_1", baseForm);
    expect(id).toBe("dep_1");
    expect(mocks.db.departure.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ productId: "prod_1", capacity: 20 }),
        select: { id: true },
      }),
    );
  });

  it("날짜 충돌(P2002) → DepartureDateConflictError", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "5",
    });
    mocks.db.departure.create.mockRejectedValue(p2002);
    await expect(createDeparture("prod_1", baseForm)).rejects.toBeInstanceOf(
      DepartureDateConflictError,
    );
  });
});

describe("updateDeparture — capacity 축소 CAS (D3)", () => {
  it("bookedSeats <= newCapacity 면 갱신 성공", async () => {
    mocks.db.departure.updateMany.mockResolvedValue({ count: 1 });
    await expect(
      updateDeparture("dep_1", { ...baseForm, capacity: 10 }),
    ).resolves.toBeUndefined();
    expect(mocks.db.departure.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "dep_1", bookedSeats: { lte: 10 } },
      }),
    );
  });

  it("count===0 → CapacityBelowBookedError (예약이 새 정원 초과)", async () => {
    mocks.db.departure.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      updateDeparture("dep_1", { ...baseForm, capacity: 2 }),
    ).rejects.toBeInstanceOf(CapacityBelowBookedError);
  });

  it("날짜 충돌(P2002) → DepartureDateConflictError", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "5",
    });
    mocks.db.departure.updateMany.mockRejectedValue(p2002);
    await expect(
      updateDeparture("dep_1", baseForm),
    ).rejects.toBeInstanceOf(DepartureDateConflictError);
  });
});

describe("transitionDepartureStatus — 가드", () => {
  it("불가능한 전이 → InvalidDepartureTransitionError (DB 미접근)", async () => {
    mocks.db.departure.findUnique.mockResolvedValue({
      status: "CANCELED",
      bookedSeats: 0,
    });
    await expect(
      transitionDepartureStatus("dep_1", "SCHEDULED"),
    ).rejects.toBeInstanceOf(InvalidDepartureTransitionError);
    expect(mocks.db.departure.updateMany).not.toHaveBeenCalled();
  });

  it("CLOSED 정상 전이 → updateMany(status 가드) count 1 성공", async () => {
    mocks.db.departure.findUnique.mockResolvedValue({
      status: "SCHEDULED",
      bookedSeats: 5,
    });
    mocks.db.departure.updateMany.mockResolvedValue({ count: 1 });
    await expect(
      transitionDepartureStatus("dep_1", "CLOSED"),
    ).resolves.toBeUndefined();
    expect(mocks.db.departure.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "dep_1", status: "SCHEDULED" }, // 취소 아니면 bookedSeats 가드 없음
      }),
    );
  });

  it("CANCELED인데 bookedSeats>0 → DepartureHasBookingsError (D1)", async () => {
    mocks.db.departure.findUnique
      .mockResolvedValueOnce({ status: "SCHEDULED", bookedSeats: 3 }) // 1차 read
      .mockResolvedValueOnce({ bookedSeats: 3 }); // count===0 후 재조회
    mocks.db.departure.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      transitionDepartureStatus("dep_1", "CANCELED"),
    ).rejects.toBeInstanceOf(DepartureHasBookingsError);
    // 취소 전이는 bookedSeats:0 가드를 where에 포함
    expect(mocks.db.departure.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "dep_1", status: "SCHEDULED", bookedSeats: 0 },
      }),
    );
  });

  it("count===0 + 취소 아님 → StaleDepartureStatusError (동시 전이)", async () => {
    mocks.db.departure.findUnique
      .mockResolvedValueOnce({ status: "SCHEDULED", bookedSeats: 0 })
      .mockResolvedValueOnce({ bookedSeats: 0 });
    mocks.db.departure.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      transitionDepartureStatus("dep_1", "CLOSED"),
    ).rejects.toBeInstanceOf(StaleDepartureStatusError);
  });
});
```

- [x] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/entities/departure/api/__tests__/mutations.test.ts`
Expected: FAIL — `Cannot find module '../mutations'`

- [x] **Step 3: mutations.ts 구현**

```ts
// src/entities/departure/api/mutations.ts
import { Prisma, type DepartureStatus } from "@prisma/client";
import { db } from "@/shared/lib/db";
import type { DepartureFormData } from "../model/schema";
import { assertDepartureTransition, requiresEmptySeats } from "../model/transitions";

// ── 도메인 에러 ────────────────────────────────────────────────────
export class CapacityBelowBookedError extends Error {
  constructor(public readonly departureId: string) {
    super(`Cannot set capacity below bookedSeats for departure ${departureId}`);
    this.name = "CapacityBelowBookedError";
  }
}
export class DepartureDateConflictError extends Error {
  constructor(public readonly productId: string) {
    super(`Duplicate departureDate for product ${productId}`);
    this.name = "DepartureDateConflictError";
  }
}
export class DepartureHasBookingsError extends Error {
  constructor(public readonly departureId: string, public readonly bookedSeats: number) {
    super(`Departure ${departureId} has ${bookedSeats} active seats; cannot cancel`);
    this.name = "DepartureHasBookingsError";
  }
}
export class StaleDepartureStatusError extends Error {
  constructor(public readonly departureId: string) {
    super(`Departure ${departureId} status changed concurrently`);
    this.name = "StaleDepartureStatusError";
  }
}
export class DepartureNotFoundError extends Error {
  constructor(public readonly departureId: string) {
    super(`Departure ${departureId} not found`);
    this.name = "DepartureNotFoundError";
  }
}

function isP2002(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

// ── create ────────────────────────────────────────────────────────
// status=SCHEDULED(default) / bookedSeats=0(default). 날짜 unique 충돌은 P2002.
export async function createDeparture(
  productId: string,
  data: DepartureFormData,
): Promise<string> {
  try {
    const created = await db.departure.create({
      data: {
        productId,
        departureDate: data.departureDate,
        returnDate: data.returnDate,
        priceAdult: data.priceAdult,
        priceChild: data.priceChild,
        priceInfant: data.priceInfant,
        capacity: data.capacity,
        minPax: data.minPax,
      },
      select: { id: true },
    });
    return created.id;
  } catch (e) {
    if (isP2002(e)) throw new DepartureDateConflictError(productId);
    throw e;
  }
}

// ── update (capacity 축소 race-free CAS, D3) ───────────────────────
// bookedSeats <= newCapacity 리터럴 가드 → updateMany count===0 이면 거부.
// status는 여기서 바꾸지 않는다(전이는 transitionDepartureStatus).
export async function updateDeparture(
  departureId: string,
  data: DepartureFormData,
): Promise<void> {
  try {
    const result = await db.departure.updateMany({
      where: { id: departureId, bookedSeats: { lte: data.capacity } },
      data: {
        departureDate: data.departureDate,
        returnDate: data.returnDate,
        priceAdult: data.priceAdult,
        priceChild: data.priceChild,
        priceInfant: data.priceInfant,
        capacity: data.capacity,
        minPax: data.minPax,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) {
      // edit 페이지가 존재를 보장하므로 count===0 == 정원<예약.
      throw new CapacityBelowBookedError(departureId);
    }
  } catch (e) {
    if (e instanceof CapacityBelowBookedError) throw e;
    if (isP2002(e)) throw new DepartureDateConflictError(departureId);
    throw e;
  }
}

// ── status 전이 (TOCTOU + 낙관적 동시전이 방어) ────────────────────
export async function transitionDepartureStatus(
  departureId: string,
  to: DepartureStatus,
): Promise<void> {
  const current = await db.departure.findUnique({
    where: { id: departureId },
    select: { status: true, bookedSeats: true },
  });
  if (!current) throw new DepartureNotFoundError(departureId);

  // 화이트리스트 검사 — 친절한 에러 우선(DB UPDATE 전).
  assertDepartureTransition(current.status, to);

  const result = await db.departure.updateMany({
    where: {
      id: departureId,
      status: current.status, // 낙관적: 그새 전이됐으면 count 0
      ...(requiresEmptySeats(to) ? { bookedSeats: 0 } : {}), // D1 취소 가드
    },
    data: { status: to, version: { increment: 1 } },
  });

  if (result.count === 0) {
    // 사유 분기: 취소인데 예약 발생 vs 동시 전이.
    const fresh = await db.departure.findUnique({
      where: { id: departureId },
      select: { bookedSeats: true },
    });
    if (requiresEmptySeats(to) && fresh && fresh.bookedSeats > 0) {
      throw new DepartureHasBookingsError(departureId, fresh.bookedSeats);
    }
    throw new StaleDepartureStatusError(departureId);
  }
}
```

- [x] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/entities/departure/api/__tests__/mutations.test.ts`
Expected: PASS (전 케이스)

- [x] **Step 5: admin 읽기 쿼리 + 타입 추가**

`src/entities/departure/model/types.ts` 끝에 추가:

```ts
// admin CMS 목록·편집용 — 전 status(과거·CANCELED 포함) 노출.
export type AdminDepartureRow = Departure & {
  remainingSeats: number;
};
```

`src/entities/departure/api/queries.ts` 끝에 추가:

```ts
import type { AdminDepartureRow } from "../model/types"; // 파일 상단 import 블록에 합치기

// admin 목록 — 미래/과거/CANCELED 전부, 최신 출발일 순. 캐시하지 않음(운영 즉시성).
export async function listAdminDepartures(
  productId: string,
): Promise<AdminDepartureRow[]> {
  const rows = await db.departure.findMany({
    where: { productId },
    orderBy: { departureDate: "desc" },
  });
  return rows.map((d) => ({
    ...d,
    remainingSeats: computeRemainingSeats(d.capacity, d.bookedSeats),
  }));
}

// admin 편집 단건 — 전이 가드 표시(bookedSeats)·폼 초기값.
export async function getAdminDepartureById(
  departureId: string,
): Promise<AdminDepartureRow | null> {
  const d = await db.departure.findUnique({ where: { id: departureId } });
  if (!d) return null;
  return { ...d, remainingSeats: computeRemainingSeats(d.capacity, d.bookedSeats) };
}
```

> `queries.ts` 상단 import에 `AdminDepartureRow`를 `DepartureSummary` 등과 함께 추가한다. `Departure` 타입은 `model/types.ts`가 이미 `@prisma/client`에서 가져와 `AdminDepartureRow`에 합성하므로 queries.ts는 추가 prisma import 불필요.

- [x] **Step 6: barrel 확장**

`src/entities/departure/index.ts`에 추가:

```ts
export {
  assertDepartureTransition,
  allowedNextStatuses,
  requiresEmptySeats,
  ALLOWED_DEPARTURE_TRANSITIONS,
  InvalidDepartureTransitionError,
} from "./model/transitions";

export {
  createDeparture,
  updateDeparture,
  transitionDepartureStatus,
  CapacityBelowBookedError,
  DepartureDateConflictError,
  DepartureHasBookingsError,
  StaleDepartureStatusError,
  DepartureNotFoundError,
} from "./api/mutations";

export { listAdminDepartures, getAdminDepartureById } from "./api/queries";
export type { AdminDepartureRow } from "./model/types";
```

- [x] **Step 7: typecheck + 전체 departure 테스트**

Run: `npx tsc --noEmit && npx vitest run src/entities/departure`
Expected: 타입 에러 0, 테스트 PASS

- [x] **Step 8: 커밋**

```bash
git add src/entities/departure
git commit -m "feat(departure): mutations with capacity CAS + cancel guard + admin queries (4A Task 2)"
```

---

## Task 3 — admin-departure Server Actions (TDD)

> ⚙️ Backend + 💳 Domain Booking. ADMIN 3중 가드·Zod·도메인 에러 매핑·캐시 무효화.

**Files:**
- Create: `src/features/admin-departure/model/schemas.ts`
- Create: `src/features/admin-departure/server/actions.ts`
- Create: `src/features/admin-departure/index.ts`
- Test: `src/features/admin-departure/server/__tests__/actions.test.ts`

- [x] **Step 1: schema 작성**

```ts
// src/features/admin-departure/model/schemas.ts
import { z } from "zod";
import { departureSchema } from "@/entities/departure";

// 폼 본문은 entities departureSchema(7필드 + 날짜/minPax refine) 그대로 재사용.
// productId/departureId는 신뢰된 route param에서 bind되므로 입력 본문에 두지 않는다.
export const departureFormSchema = departureSchema;
export type DepartureFormInput = z.infer<typeof departureFormSchema>;

// 상태 전이 입력 — form action(hidden input) 용.
export const departureTransitionSchema = z.object({
  departureId: z.string().cuid("올바른 출발일 ID가 필요합니다"),
  productId: z.string().cuid("올바른 상품 ID가 필요합니다"),
  to: z.enum(["SCHEDULED", "CONFIRMED", "CLOSED", "CANCELED"]),
});
export type DepartureTransitionInput = z.infer<typeof departureTransitionSchema>;
```

- [x] **Step 2: 실패 테스트 작성**

```ts
// src/features/admin-departure/server/__tests__/actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  createDeparture: vi.fn(),
  updateDeparture: vi.fn(),
  transitionDepartureStatus: vi.fn(),
}));

vi.mock("@/features/auth/server/auth", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({
  revalidateTag: mocks.revalidateTag,
  revalidatePath: mocks.revalidatePath,
}));
vi.mock("@/entities/departure", async (orig) => {
  const actual = await orig<typeof import("@/entities/departure")>();
  return {
    ...actual,
    createDeparture: mocks.createDeparture,
    updateDeparture: mocks.updateDeparture,
    transitionDepartureStatus: mocks.transitionDepartureStatus,
    tagDeparturesByProduct: (pid: string) => `product:${pid}:departures`,
  };
});

import { createDepartureAction, updateDepartureAction } from "../actions";
import { CapacityBelowBookedError } from "@/entities/departure";

const validInput = {
  departureDate: new Date("2026-09-01"),
  returnDate: new Date("2026-09-05"),
  priceAdult: 1_000_000,
  priceChild: 700_000,
  priceInfant: 0,
  capacity: 20,
  minPax: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
});

describe("createDepartureAction", () => {
  it("ADMIN 아니면 forbidden", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1", role: "CUSTOMER" } });
    const res = await createDepartureAction("prod_1", null, validInput);
    expect(res.type).toBe("error");
    expect(mocks.createDeparture).not.toHaveBeenCalled();
  });

  it("Zod 실패 → fieldErrors", async () => {
    const bad = { ...validInput, capacity: 0 };
    const res = await createDepartureAction("prod_1", null, bad);
    expect(res.type).toBe("error");
    if (res.type === "error") expect(res.fieldErrors).toBeDefined();
    expect(mocks.createDeparture).not.toHaveBeenCalled();
  });

  it("성공 → createDeparture 호출 + revalidate 2종", async () => {
    mocks.createDeparture.mockResolvedValue("dep_new");
    const res = await createDepartureAction("prod_1", null, validInput);
    expect(res.type).toBe("success");
    expect(mocks.createDeparture).toHaveBeenCalledWith("prod_1", expect.any(Object));
    expect(mocks.revalidateTag).toHaveBeenCalledWith("product:prod_1:departures");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/products/prod_1");
  });
});

describe("updateDepartureAction — 도메인 에러 매핑", () => {
  it("CapacityBelowBookedError → 사용자 메시지", async () => {
    mocks.updateDeparture.mockRejectedValue(new CapacityBelowBookedError("dep_1"));
    const res = await updateDepartureAction("dep_1", "prod_1", null, validInput);
    expect(res.type).toBe("error");
    if (res.type === "error") expect(res.message).toContain("예약");
  });
});
```

- [x] **Step 3: 실패 확인**

Run: `npx vitest run src/features/admin-departure/server/__tests__/actions.test.ts`
Expected: FAIL — `Cannot find module '../actions'`

- [x] **Step 4: actions.ts 구현**

```ts
// src/features/admin-departure/server/actions.ts
"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { auth } from "@/features/auth/server/auth";
import {
  createDeparture,
  updateDeparture,
  transitionDepartureStatus,
  tagDeparturesByProduct,
  CapacityBelowBookedError,
  DepartureDateConflictError,
  DepartureHasBookingsError,
  StaleDepartureStatusError,
  InvalidDepartureTransitionError,
} from "@/entities/departure";
import { departureFormSchema, departureTransitionSchema } from "../model/schemas";
import type { DepartureFormInput } from "../model/schemas";

export type DepartureActionState =
  | { type: "success"; departureId?: string }
  | { type: "error"; message: string; fieldErrors?: Record<string, string[]> };

async function requireAdmin(): Promise<
  { ok: true; adminId: string } | { ok: false; error: DepartureActionState }
> {
  const session = await auth();
  if (!session?.user?.id)
    return { ok: false, error: { type: "error", message: "관리자 로그인이 필요합니다" } };
  if (session.user.role !== "ADMIN")
    return { ok: false, error: { type: "error", message: "관리자 권한이 필요합니다" } };
  return { ok: true, adminId: session.user.id };
}

function zodErrors(parsed: ReturnType<typeof departureFormSchema.safeParse>) {
  if (parsed.success) return null;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "form");
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return {
    type: "error" as const,
    message: parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요",
    fieldErrors,
  };
}

function invalidate(productId: string) {
  revalidateTag(tagDeparturesByProduct(productId));
  revalidatePath(`/products/${productId}`);
}

// 도메인 에러 → 사용자 메시지 (차단 에러만; 가격 경고는 UI에서 별도 표시).
function mapDomainError(e: unknown): string {
  if (e instanceof CapacityBelowBookedError)
    return "현재 예약된 좌석 수보다 적게 정원을 줄일 수 없습니다";
  if (e instanceof DepartureDateConflictError)
    return "해당 날짜에 이미 출발일이 있습니다";
  if (e instanceof DepartureHasBookingsError)
    return `예약 ${e.bookedSeats}건이 존재합니다 — 개별 취소 후 출발 취소가 가능합니다`;
  if (e instanceof StaleDepartureStatusError)
    return "상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요";
  if (e instanceof InvalidDepartureTransitionError)
    return "현재 상태에서는 불가능한 전이입니다";
  return "처리에 실패했습니다. 잠시 후 다시 시도해 주세요";
}

// productId는 route param에서 bind — useActionState(action.bind(null, productId), null)
export async function createDepartureAction(
  productId: string,
  _prev: DepartureActionState | null,
  input: DepartureFormInput,
): Promise<DepartureActionState> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.error;

  const parsed = departureFormSchema.safeParse(input);
  const errs = zodErrors(parsed);
  if (errs || !parsed.success) return errs!;

  try {
    const departureId = await createDeparture(productId, parsed.data);
    invalidate(productId);
    return { type: "success", departureId };
  } catch (e) {
    return { type: "error", message: mapDomainError(e) };
  }
}

// departureId + productId 둘 다 bind.
export async function updateDepartureAction(
  departureId: string,
  productId: string,
  _prev: DepartureActionState | null,
  input: DepartureFormInput,
): Promise<DepartureActionState> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.error;

  const parsed = departureFormSchema.safeParse(input);
  const errs = zodErrors(parsed);
  if (errs || !parsed.success) return errs!;

  try {
    await updateDeparture(departureId, parsed.data);
    invalidate(productId);
    return { type: "success", departureId };
  } catch (e) {
    return { type: "error", message: mapDomainError(e) };
  }
}

// 상태 전이 — <form action> progressive enhancement. 성공/실패 모두 redirect.
// 에러는 edit 페이지의 ?error=CODE 쿼리로 전달 → RSC 배너 렌더.
export async function transitionDepartureAction(formData: FormData): Promise<void> {
  const { redirect } = await import("next/navigation");
  const guard = await requireAdmin();
  if (!guard.ok) redirect(`/admin/products`); // 비정상 접근 — 목록으로

  const parsed = departureTransitionSchema.safeParse({
    departureId: formData.get("departureId"),
    productId: formData.get("productId"),
    to: formData.get("to"),
  });
  if (!parsed.success) redirect(`/admin/products`);
  const { departureId, productId, to } = parsed.data;
  const editPath = `/admin/products/${productId}/departures/${departureId}/edit`;

  try {
    await transitionDepartureStatus(departureId, to);
    invalidate(productId);
  } catch (e) {
    const code =
      e instanceof DepartureHasBookingsError
        ? "has_bookings"
        : e instanceof StaleDepartureStatusError
          ? "stale"
          : e instanceof InvalidDepartureTransitionError
            ? "invalid"
            : "unknown";
    redirect(`${editPath}?error=${code}`);
  }
  redirect(`/admin/products/${productId}/departures`);
}
```

> ⚠️ `redirect()`는 내부적으로 throw하므로 try 블록 **밖**(성공 경로 끝)에서 호출한다. 위 구조처럼 catch에서 error redirect, try 종료 후 success redirect로 분리.

- [x] **Step 5: barrel 작성**

```ts
// src/features/admin-departure/index.ts
export {
  createDepartureAction,
  updateDepartureAction,
  transitionDepartureAction,
} from "./server/actions";
export type { DepartureActionState } from "./server/actions";
export { departureFormSchema } from "./model/schemas";
export type { DepartureFormInput } from "./model/schemas";
export { DepartureForm } from "./ui/DepartureForm"; // Task 4에서 생성
```

> Task 4 이전에는 마지막 `DepartureForm` export 줄을 잠시 주석 처리하거나, Task 4 완료 후 함께 커밋한다. 본 Task에서는 그 줄을 제외하고 작성 → Task 4에서 추가.

- [x] **Step 6: 테스트 통과 확인**

Run: `npx vitest run src/features/admin-departure/server/__tests__/actions.test.ts`
Expected: PASS

- [x] **Step 7: 커밋**

```bash
git add src/features/admin-departure/model src/features/admin-departure/server src/features/admin-departure/index.ts
git commit -m "feat(admin-departure): server actions with guard + domain error mapping (4A Task 3)"
```

---

## Task 4 — DepartureForm UI 아일랜드

> 🎨 Frontend: `'use client'`, `useActionState`. 페이지 직접 `'use client'` 금지. 타이머/리스너 없음(cleanup 불필요).

**Files:**
- Create: `src/features/admin-departure/ui/DepartureForm.tsx`
- Modify: `src/features/admin-departure/index.ts` (`DepartureForm` export 활성화)

- [x] **Step 1: DepartureForm 구현**

```tsx
// src/features/admin-departure/ui/DepartureForm.tsx
"use client";

import { startTransition, useActionState, useState } from "react";
import type { AdminDepartureRow } from "@/entities/departure";
import type { DepartureActionState } from "../server/actions";
import type { DepartureFormInput } from "../model/schemas";

type Props = {
  action: (
    prev: DepartureActionState | null,
    input: DepartureFormInput,
  ) => Promise<DepartureActionState>;
  // edit 모드에서 가격 경고 배너 노출용. create 모드는 0.
  bookedSeats?: number;
  initial?: AdminDepartureRow | null;
};

function toDateInput(d: Date | string | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10); // yyyy-mm-dd
}

export function DepartureForm({ action, bookedSeats = 0, initial = null }: Props) {
  const [state, formAction, isPending] = useActionState(action, null);
  const [capacity, setCapacity] = useState(initial?.capacity ?? 1);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input: DepartureFormInput = {
      departureDate: new Date(String(fd.get("departureDate"))),
      returnDate: new Date(String(fd.get("returnDate"))),
      priceAdult: Number(fd.get("priceAdult")),
      priceChild: Number(fd.get("priceChild")),
      priceInfant: Number(fd.get("priceInfant")),
      capacity: Number(fd.get("capacity")),
      minPax: Number(fd.get("minPax")),
    };
    startTransition(() => formAction(input));
  }

  const fieldErr = (k: string) =>
    state?.type === "error" ? state.fieldErrors?.[k]?.[0] : undefined;

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* 가격 경고 배너 (D2) — 차단 아님, 정보성 */}
      {bookedSeats > 0 && (
        <div className="rounded-lg bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          이미 {bookedSeats}건의 예약이 있습니다. 가격을 수정해도 기존 예약은 결제
          시점에 잠긴 금액을 유지하며, 신규 예약부터 새 가격이 적용됩니다.
        </div>
      )}

      {/* 차단 에러 */}
      {state?.type === "error" && !state.fieldErrors && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {state.message}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="출발일" name="departureDate" type="date"
          defaultValue={toDateInput(initial?.departureDate)} error={fieldErr("departureDate")} />
        <Field label="귀국일" name="returnDate" type="date"
          defaultValue={toDateInput(initial?.returnDate)} error={fieldErr("returnDate")} />
        <Field label="성인 요금(원)" name="priceAdult" type="number"
          defaultValue={initial?.priceAdult ?? 0} error={fieldErr("priceAdult")} />
        <Field label="아동 요금(원)" name="priceChild" type="number"
          defaultValue={initial?.priceChild ?? 0} error={fieldErr("priceChild")} />
        <Field label="유아 요금(원)" name="priceInfant" type="number"
          defaultValue={initial?.priceInfant ?? 0} error={fieldErr("priceInfant")} />
        <Field label="정원" name="capacity" type="number" min={1}
          defaultValue={initial?.capacity ?? 1} error={fieldErr("capacity")}
          onChange={(v) => setCapacity(Number(v))} />
        <Field label="최소 출발 인원" name="minPax" type="number" min={1}
          defaultValue={initial?.minPax ?? 1} error={fieldErr("minPax")} />
      </div>

      {initial && capacity < initial.bookedSeats && (
        <p className="text-sm text-red-600">
          현재 예약 {initial.bookedSeats}석 — 정원을 그 이하로 저장하면 거부됩니다.
        </p>
      )}

      <button type="submit" disabled={isPending}
        className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
        {isPending ? "저장 중…" : initial ? "수정 저장" : "출발일 생성"}
      </button>
    </form>
  );
}

function Field({
  label, name, type, defaultValue, error, min, onChange,
}: {
  label: string; name: string; type: string;
  defaultValue: string | number; error?: string; min?: number;
  onChange?: (v: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-gray-700">{label}</span>
      <input
        name={name} type={type} defaultValue={defaultValue} min={min} required
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className="block w-full rounded-lg border border-gray-300 px-3 py-2"
      />
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}
```

- [x] **Step 2: barrel의 `DepartureForm` export 활성화** (Task 3 Step 5에서 보류했던 줄 확인/추가)

`src/features/admin-departure/index.ts`에 다음이 있는지 확인:
```ts
export { DepartureForm } from "./ui/DepartureForm";
```

- [x] **Step 3: typecheck**

Run: `npx tsc --noEmit`
Expected: 타입 에러 0

- [x] **Step 4: 커밋**

```bash
git add src/features/admin-departure/ui src/features/admin-departure/index.ts
git commit -m "feat(admin-departure): departure form island with price warning (4A Task 4)"
```

---

## Task 5 — admin 라우트 3종 + 상태 전이 버튼 + 상품 링크

> 🏛️ Architect: app 레이어 비즈니스 로직 금지(읽기 위임). 🎨 Frontend: page.tsx에 `'use client'` 금지.

**Files:**
- Create: `src/app/(admin)/admin/products/[id]/departures/page.tsx`
- Create: `src/app/(admin)/admin/products/[id]/departures/new/page.tsx`
- Create: `src/app/(admin)/admin/products/[id]/departures/[depId]/edit/page.tsx`
- Modify: `src/app/(admin)/admin/products/[id]/edit/page.tsx` (링크 추가)

- [x] **Step 1: 목록 페이지**

```tsx
// src/app/(admin)/admin/products/[id]/departures/page.tsx
import Link from "next/link";
import { listAdminDepartures } from "@/entities/departure";
import { DEPARTURE_STATUS_LABEL } from "@/entities/departure";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

const STATUS_BADGE: Record<string, string> = {
  SCHEDULED: "bg-blue-100 text-blue-800",
  CONFIRMED: "bg-green-100 text-green-800",
  CLOSED: "bg-gray-100 text-gray-700",
  CANCELED: "bg-red-100 text-red-800",
};

function fmt(d: Date) {
  return new Date(d).toLocaleDateString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit" });
}

export default async function AdminDeparturesPage({ params }: PageProps) {
  const { id: productId } = await params;
  const rows = await listAdminDepartures(productId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={`/admin/products/${productId}/edit`} className="text-sm text-gray-500 hover:text-gray-700">← 상품</Link>
          <h1 className="text-2xl font-bold text-gray-900">출발일 관리</h1>
        </div>
        <Link href={`/admin/products/${productId}/departures/new`}
          className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">
          + 출발일 생성
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-400">출발일이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-gray-600">
                <th className="px-4 py-3">출발 / 귀국</th>
                <th className="px-4 py-3 text-right">성인 / 아동</th>
                <th className="px-4 py-3 text-center">좌석</th>
                <th className="px-4 py-3 text-center">minPax</th>
                <th className="px-4 py-3 text-center">상태</th>
                <th className="px-4 py-3 text-center">관리</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3">{fmt(d.departureDate)} ~ {fmt(d.returnDate)}</td>
                  <td className="px-4 py-3 text-right">
                    {d.priceAdult.toLocaleString("ko-KR")} / {d.priceChild.toLocaleString("ko-KR")}원
                  </td>
                  <td className="px-4 py-3 text-center">
                    {d.bookedSeats}/{d.capacity}
                    {d.bookedSeats >= d.minPax && (
                      <span className="ml-1 rounded bg-green-50 px-1.5 text-xs text-green-700">확정가능</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-600">{d.minPax}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[d.status]}`}>
                      {DEPARTURE_STATUS_LABEL[d.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Link href={`/admin/products/${productId}/departures/${d.id}/edit`}
                      className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100">
                      편집
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

> `DEPARTURE_STATUS_LABEL`이 barrel에 export되어 있는지 확인(`entities/departure/index.ts`의 constants export). 없으면 `model/constants.ts`에서 추가 export.

- [x] **Step 2: 생성 페이지**

```tsx
// src/app/(admin)/admin/products/[id]/departures/new/page.tsx
import Link from "next/link";
import { DepartureForm, createDepartureAction } from "@/features/admin-departure";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function NewDeparturePage({ params }: PageProps) {
  const { id: productId } = await params;
  // productId를 신뢰된 route param에서 bind — 사용자 입력 본문에 두지 않음.
  const action = createDepartureAction.bind(null, productId);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/admin/products/${productId}/departures`} className="text-sm text-gray-500 hover:text-gray-700">← 목록</Link>
        <h1 className="text-2xl font-bold text-gray-900">출발일 생성</h1>
      </div>
      <div className="max-w-2xl rounded-xl border border-gray-200 bg-white p-6">
        <DepartureForm action={action} />
      </div>
    </div>
  );
}
```

- [x] **Step 3: 편집 페이지 + 상태 전이 버튼 + 에러 배너**

```tsx
// src/app/(admin)/admin/products/[id]/departures/[depId]/edit/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAdminDepartureById,
  allowedNextStatuses,
  DEPARTURE_STATUS_LABEL,
} from "@/entities/departure";
import {
  DepartureForm,
  updateDepartureAction,
  transitionDepartureAction,
} from "@/features/admin-departure";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string; depId: string }>;
  searchParams: Promise<{ error?: string }>;
};

const TRANSITION_ERRORS: Record<string, string> = {
  has_bookings: "예약이 존재해 출발을 취소할 수 없습니다. /admin/bookings에서 개별 취소 후 다시 시도하세요.",
  stale: "상태가 변경되었습니다. 새로고침 후 다시 시도하세요.",
  invalid: "현재 상태에서는 불가능한 전이입니다.",
  unknown: "상태 전이에 실패했습니다.",
};

const ACTION_LABEL: Record<string, string> = {
  CONFIRMED: "출발 확정", CLOSED: "마감", SCHEDULED: "재개봉", CANCELED: "출발 취소",
};

export default async function EditDeparturePage({ params, searchParams }: PageProps) {
  const { id: productId, depId } = await params;
  const { error } = await searchParams;
  const dep = await getAdminDepartureById(depId);
  if (!dep) notFound();

  const action = updateDepartureAction.bind(null, depId, productId);
  const nextStatuses = allowedNextStatuses(dep.status);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/admin/products/${productId}/departures`} className="text-sm text-gray-500 hover:text-gray-700">← 목록</Link>
        <h1 className="text-2xl font-bold text-gray-900">출발일 편집</h1>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
          {DEPARTURE_STATUS_LABEL[dep.status]}
        </span>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {TRANSITION_ERRORS[error] ?? TRANSITION_ERRORS.unknown}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <DepartureForm action={action} initial={dep} bookedSeats={dep.bookedSeats} />
        </div>

        {/* 상태 전이 패널 — <form action> progressive enhancement */}
        <aside className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-900">상태 전이</h2>
          <p className="text-xs text-gray-500">현재: {DEPARTURE_STATUS_LABEL[dep.status]} · 예약 {dep.bookedSeats}석</p>
          {nextStatuses.length === 0 ? (
            <p className="text-xs text-gray-400">더 이상 전이할 수 없습니다 (종료 상태).</p>
          ) : (
            nextStatuses.map((to) => {
              const cancelBlocked = to === "CANCELED" && dep.bookedSeats > 0;
              return (
                <form key={to} action={transitionDepartureAction}>
                  <input type="hidden" name="departureId" value={dep.id} />
                  <input type="hidden" name="productId" value={productId} />
                  <input type="hidden" name="to" value={to} />
                  <button type="submit" disabled={cancelBlocked}
                    title={cancelBlocked ? "예약이 있어 취소 불가 — 개별 취소 후 가능" : undefined}
                    className={`w-full rounded-lg px-3 py-2 text-sm font-medium ${
                      to === "CANCELED"
                        ? "bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-40"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}>
                    {ACTION_LABEL[to] ?? to}
                  </button>
                </form>
              );
            })
          )}
        </aside>
      </div>
    </div>
  );
}
```

- [x] **Step 4: 상품 편집 페이지에 "출발일 관리" 링크 추가**

`src/app/(admin)/admin/products/[id]/edit/page.tsx`의 헤더 영역(목록 링크 옆, line ~158-169 블록)에 추가:

```tsx
        <Link
          href={`/admin/products/${product.id}/departures`}
          className="ml-auto rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
        >
          출발일 관리 →
        </Link>
```

> 헤더 `<div className="flex items-center gap-3">` 안, `product.id`를 쓰는 위치에 삽입. `ml-auto`로 우측 정렬.

- [x] **Step 5: typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: 타입 에러 0, lint 에러 0

- [x] **Step 6: 커밋**

```bash
git add "src/app/(admin)/admin/products/[id]/departures" "src/app/(admin)/admin/products/[id]/edit/page.tsx"
git commit -m "feat(admin): departure CMS routes + status transition buttons (4A Task 5)"
```

---

## Task 6 — 종합 QA (🔬 QA Engineer 강제 발동)

> 모든 검증을 evidence 인용. 자동화 불가 항목만 사용자 수동 요청.

**Files:**
- Create(임시 가능): `scripts/qa/4a-departure-qa.ts` (런타임 evidence 수집 스크립트)

- [x] **Step 1: 전체 typecheck / test / lint**

Run:
```bash
npm run typecheck && npx vitest run && npm run lint
```
Expected: typecheck 0, 전체 테스트 PASS(신규 departure/admin-departure 포함), lint 에러 0
→ 출력 인용해 plan에 기록.

- [x] **Step 2: 런타임 evidence 스크립트 작성**

`scripts/qa/b3-embedding-qa.ts`의 구조(assert 헬퍼 + section)를 차용해 `scripts/qa/4a-departure-qa.ts` 작성. 검증 시나리오:

```ts
// 핵심 assert (의사 구조 — 실제 db client + reserveSeats import로 구현)
// 1) createDeparture → status SCHEDULED, bookedSeats 0
// 2) reserveSeats(tx, depId, 18) → bookedSeats 18
// 3) updateDeparture(depId, {...capacity: 10}) → CapacityBelowBookedError throw (18 > 10)
// 4) updateDeparture(depId, {...capacity: 25}) → 성공 (증가는 통과)
// 5) transitionDepartureStatus(depId, "CANCELED") → DepartureHasBookingsError (bookedSeats>0)
// 6) releaseSeats(tx, depId, 18) → bookedSeats 0
// 7) transitionDepartureStatus(depId, "CANCELED") → 성공
// 8) (reopen) 새 dep: SCHEDULED→CLOSED→SCHEDULED 성공
// 9) CLOSED 출발에 reserveSeats → InsufficientCapacity/0 affected (신규 예약 차단 확인)
```

- [x] **Step 3: 스크립트 실행 + evidence 인용**

Run: `npx tsx scripts/qa/4a-departure-qa.ts`
Expected: 전 시나리오 PASS. DB raw 값(bookedSeats/status) 인용해 plan에 기록:
  - capacity 축소 거부 evidence
  - 취소 가드(예약 존재) 거부 → 좌석 비운 후 취소 성공 evidence
  - CLOSED 후 신규 예약 차단 evidence
  - reopen 후 재판매 가능 evidence

- [x] **Step 4: 캐시 무효화 계약 확인**

Run: `grep -n "tagDeparturesByProduct\|revalidatePath" src/features/admin-departure/server/actions.ts`
Expected: create/update 양쪽에서 `tagDeparturesByProduct` + `revalidatePath('/products/${productId}')` 발신 확인(actions.test.ts spy로도 검증됨).

- [x] **Step 5: force-dynamic audit (ADR-0020)**

Run: `grep -rn "force-dynamic" "src/app/(admin)/admin/products/[id]/departures"`
Expected: 3개 라우트 모두 `force-dynamic`(admin 안전 도메인). 미승인 0건.

- [x] **Step 6: 커밋**

```bash
git add scripts/qa/4a-departure-qa.ts
git commit -m "qa(4a): runtime evidence for departure CMS guards (4A Task 6)"
```

---

## Task 7 — ADR(사용자 승인 후) + CLAUDE.md §8 갱신

> CLAUDE.md §6.1: ADR은 사용자 명시 요청 시에만 발행. 후보로 기록.

- [ ] **Step 1: (사용자 승인 시) ADR 작성**

`docs/superpowers/adr/0027-departure-cancel-scope-and-literal-cas.md` — template 복사 후:
- Context: Phase 4-A Departure CMS, 좌석/가격 안전
- Decision: ① 취소 cascade 범위 제외 + `bookedSeats===0` 가드(D1) ② admin 가드는 `updateMany` 리터럴 CAS(raw 회피), `reserveSeats`는 컬럼식이라 raw 유지
- Consequences: fat-finger 방어, cascade 환불 별도 에픽, 타입 안전 가드
- Alternatives Considered: cascade 포함(거부—부분실패 에픽), 취소 자체 제외(거부—reopen만으론 무산 표현 불가), 전부 raw(거부—리터럴 비교엔 불필요)

`docs/superpowers/adr/README.md` 인덱스에 0027 한 줄 추가.

- [ ] **Step 2: CLAUDE.md §8 갱신**

- "Phase 1+2+3+**4-A** 완료" 마킹, 한 줄 노트 추가.
- 다음 작업자 노트 추가:
  - "왜 admin은 raw SQL 없이 updateMany?" → 리터럴 비교(§spec 4.2)
  - "왜 출발 취소가 예약 있으면 막히나?" → D1, cascade 별도 마일스톤
  - "CLOSED vs CANCELED?" → 둘 다 신규예약 차단, CLOSED만 reopen 가능

- [ ] **Step 3: plan → done/ 이동 + 미체크 0 확인**

```bash
grep -n "\- \[ \]" docs/superpowers/plans/2026-06-02-phase-4a-departure-cms-plan.md   # 기대: 0건
git mv docs/superpowers/plans/2026-06-02-phase-4a-departure-cms-plan.md docs/superpowers/plans/done/
```

- [ ] **Step 4: 최종 커밋**

```bash
git add -A
git commit -m "docs(claude-md): mark Phase 4-A (Departure CMS) complete"
```

---

## 종합 검증 체크리스트 (Task 6 inventory)

- [ ] typecheck / test / lint 3종 PASS
- [ ] 상태머신: 합법/금지 전이쌍 + CANCELED terminal + reopen
- [ ] capacity 축소 < bookedSeats → 거부 (CAS count===0)
- [ ] capacity 증가 → 통과
- [ ] 취소: bookedSeats>0 거부 → 좌석 비움 후 성공 (D1)
- [ ] CLOSED 후 reserveSeats 신규예약 차단 / reopen 후 재판매
- [ ] 가격 수정 시 기존 booking.totalPrice 불변 (스냅샷, D2)
- [ ] revalidateTag(tagDeparturesByProduct)+revalidatePath 발신 (actions.test spy)
- [ ] ADMIN 3중 가드 (actions.test forbidden 케이스)
- [ ] force-dynamic 3라우트 ADR-0020 허용 도메인
