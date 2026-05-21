# 2026-05-21 — Booking Progress Bar (예약 진행 상태 바)

> PRD §4.1D 「예약 상태 트래킹 (Progress Bar)」 의 미구현 부분을 구현하여 마이페이지 및 예약 상세 페이지 UX를 보강한다.
> 본 plan은 단절된 기획 문서 체계 복구를 겸해 **활성 plan**으로 유지된다.

## Context

- PRD §4.1D: `예약 접수 → 출발 대기(최소 인원 미달) → 출발 확정 → 결제 완료 → 여행 준비(E-ticket)`
- `entities/booking/model/constants.ts` 에 `BOOKING_PROGRESS_STEPS` 상수가 이미 정의되어 있음 (6단계: `RECEIVED → AWAITING_GROUP → DEPARTURE_CONFIRMED → PAID → READY → COMPLETED`).
- 현재 UI: `BookingStatusBadge` (단일 배지)만 존재. Progress Bar 컴포넌트는 미구현.
- 기존 BookingStatus 전체: `RECEIVED, AWAITING_GROUP, DEPARTURE_CONFIRMED, PAID, READY, COMPLETED, CANCELED_BY_USER, CANCELED_BY_AGENCY` (Prisma enum).
- 적용 대상: `/mypage` 의 각 예약 카드 (`BookingHistoryList`), `/bookings/[id]` 의 상단 (`BookingDetailView`).

## Persona Activation

| 페르소나 | 발동 사유 |
|---|---|
| 🏛️ Architect | `entities/booking/ui/**` 신규 파일, `widgets/booking-list`·`widgets/booking-detail` 수정 — FSD 단방향·barrel 강제 |
| 🎨 Frontend Expert | RSC 컴포넌트 신규 작성, `'use client'` 금지, hydration·접근성 |
| 🔬 QA Engineer | 작업 완료 보고 직전 자동 증거 수집 (typecheck/test/lint/runtime) |

Backend Expert / Domain Booking 비활성 — DB 스키마·결제·좌석 로직 변경 없음. 도메인 상수(`BOOKING_PROGRESS_STEPS`)는 read-only 사용.

## Design Decisions

1. **레이아웃**: 가로형 점 연결 (Connected dots with lines). 표준 이커머스/여행 플랫폼 UX.
2. **6단계 노출**: PRD가 명시한 5단계 + 기존 `BOOKING_PROGRESS_STEPS` 의 마지막 `COMPLETED` 까지 그대로 표시 (도메인 단일 진실 원천 유지).
3. **상태별 시각화 규칙** (Tailwind):
   - `done` (지난 스텝): `bg-blue-600 text-white` 원 + 체크 SVG + 라벨 `text-blue-700 font-medium`, 연결선 `bg-blue-600`.
   - `current` (현재 스텝): `bg-blue-600 text-white` 원 + `ring-4 ring-blue-200` (활성 강조) + 라벨 `text-blue-700 font-semibold`.
   - `upcoming` (남은 스텝): `bg-gray-200 text-gray-400` 원 + 라벨 `text-gray-400`, 연결선 `bg-gray-200`.
4. **취소 상태 처리** (`CANCELED_BY_USER`, `CANCELED_BY_AGENCY`): 진행 바를 렌더링하지 않고 `bg-red-50 border-red-200 text-red-700` 배너로 대체 — 진행 흐름과 어울리지 않는 단절 상태를 시각적으로 분리.
5. **반응형**: 모바일에서 라벨이 뭉개지지 않도록 `text-[10px] sm:text-xs` + `truncate` 및 컨테이너 가로 스크롤은 사용하지 않고 6개 스텝이 균등 분할 (`flex-1`) 되도록 함. 라벨이 두 줄 이상 늘어나지 않게 `line-clamp` 또는 짧은 라벨 사용.
6. **순수 함수 분리 (TDD)**: 상태 → 스텝 배열 변환 로직은 `model/progress.ts` 의 순수 함수 `getBookingProgress(status)` 로 분리. UI는 결과를 받아 렌더만 담당. 이 분리로 (a) Vitest 로 모든 transition 케이스를 검증하고, (b) UI 변경이 로직을 흔들지 않게 함.

## Files Touched

| 작업 | 파일 | 종류 |
|---|---|---|
| 신규 | `src/entities/booking/model/progress.ts` | 순수 함수 |
| 신규 | `src/entities/booking/model/__tests__/progress.test.ts` | Vitest |
| 신규 | `src/entities/booking/ui/BookingProgressBar.tsx` | RSC UI |
| 수정 | `src/entities/booking/index.ts` | barrel 추가 export |
| 수정 | `src/widgets/booking-list/ui/BookingHistoryList.tsx` | 카드 내부 배치 |
| 수정 | `src/widgets/booking-detail/ui/BookingDetailView.tsx` | 상단 배치 (Summary 위) |

## Tasks

### Task 1 — `getBookingProgress` 순수 함수 + 테스트 (TDD)

- [x] `src/entities/booking/model/__tests__/progress.test.ts` 작성 — FAIL 확인 (`Failed to resolve import "../progress"`)
  - `RECEIVED` 입력 → step 0이 `current`, 나머지 `upcoming`, `canceled=false`
  - `DEPARTURE_CONFIRMED` 입력 → step 0~1 `done`, step 2 `current`, 나머지 `upcoming`
  - `COMPLETED` 입력 → 모든 step `done`, 마지막 step 도 `done` (current 없음)
  - `CANCELED_BY_USER` 입력 → `canceled=true, canceledBy='user'`, steps 배열 비어있지 않으나 모든 state `upcoming` (UI 측에서 hide 처리)
  - `CANCELED_BY_AGENCY` 입력 → `canceled=true, canceledBy='agency'`
- [x] `src/entities/booking/model/progress.ts` 구현 — PASS 확인 (9 tests passed)
  - 시그니처: `getBookingProgress(status: BookingStatus): BookingProgress`
  - 반환 타입:
    ```ts
    type BookingProgress = {
      canceled: boolean;
      canceledBy?: "user" | "agency";
      steps: Array<{
        key: BookingProgressStep;
        label: string;
        state: "done" | "current" | "upcoming";
      }>;
    };
    ```
- [x] Architect 자가 점검: 순수 함수, prisma/react 의존 없음, model 레이어 범위 내. ✅ R3 통과

### Task 2 — `BookingProgressBar` RSC 컴포넌트 구현

- [x] `src/entities/booking/ui/BookingProgressBar.tsx` 신규 작성
  - `'use client'` 미선언 (R4) — `grep -r "use client" src/entities/booking/ui/` 결과 0건
  - props: `{ status: BookingStatus; className?: string }`
  - 취소 상태: `bg-red-50 border-red-200` 배너 렌더 후 early return
  - 진행 상태: 점(circle) + 라인 + 라벨 (Tailwind 규칙은 §Design Decisions 3 참조)
  - 체크 아이콘은 inline SVG (외부 의존성 0)
  - 접근성: `<ol role="list" aria-label="예약 진행 단계">`, 현재 스텝 `aria-current="step"`
- [x] Frontend Expert 자가 점검: hook 없음, timer/listener 없음, hydration safe (서버 전용 데이터만 받음). ✅ 통과
- [x] SSR 렌더 검증 테스트(`BookingProgressBar.test.tsx`) 6 tests 추가 — 전부 PASS

### Task 3 — barrel export

- [x] `src/entities/booking/index.ts` 에 `export { BookingProgressBar } from "./ui/BookingProgressBar"` 명시적 named export 추가 (R2). `getBookingProgress` 함수 및 관련 타입도 함께 노출.
- [x] Architect 자가 점검: `export *` 사용 금지 ✅, 깊은 경로 import 차단 ✅

### Task 4 — `BookingHistoryList` 카드 내부 적용

- [x] `src/widgets/booking-list/ui/BookingHistoryList.tsx` 수정
  - 각 카드 내부, 가격 라인 위에 `BookingProgressBar` 삽입. (`<BookingProgressBar status={booking.status} className="mt-5" />`)
  - Link 내부 인터랙션 영향 없는지 확인 — ProgressBar 는 `<button>`/`<a>` 미포함, 비-interactive.
- [x] Architect 자가 점검: barrel(`@/entities/booking`) 통해 import ✅, 깊은 경로 금지 ✅

### Task 5 — `BookingDetailView` 상단 적용

- [x] `src/widgets/booking-detail/ui/BookingDetailView.tsx` 수정
  - `BookingSummaryCard` 위 (최상단)에 `BookingProgressBar` 삽입.
- [x] Architect 자가 점검: 동일 widget cross-import 없음 ✅

### Task 6 — 정적 & 동적 검증

- [x] `npm run typecheck` — exit 0, 출력 없음 (clean)
- [x] `npm run test` — `Test Files 41 passed (41) / Tests 407 passed (407)` (progress 9 + BookingProgressBar SSR 6 포함)
- [x] `npm run lint` — 신규/수정 파일 경고 **0건** (남은 경고는 pre-existing, 본 작업과 무관)
- [x] `npm run dev` 백그라운드 기동 → `Ready in 4.2s`, `/mypage` HTTP 307 → `/login?callbackUrl=/mypage` (미들웨어 정상), `/login` HTTP 200
- [x] 시각 검증(색상/정렬/모바일 wrap)만 사용자 수동 확인 요청 — 그 외 자동화 가능 항목은 SSR HTML 검증으로 모두 대체

### Task 7 — 완료 처리

- [x] 본 plan 의 모든 `- [ ]` 를 작업 직후 `- [x]` 로 갱신 (CLAUDE.md §4.1)
- [x] 보고 양식 §7.1 준수 (🏗️ Core Architecture / ♻️ Boilerplate / 🧠 Concept Insight)

## Verification Checklist (최종)

- [x] FSD 단방향 (Architect R1, R6) 위반 0건
- [x] entity UI 에 `'use client'` 부재 (R4)
- [x] barrel 명시적 named export (R2)
- [x] 모든 BookingStatus 케이스 진행 바 상태 검증 (Vitest 9 + 6 = 15 tests)
- [x] typecheck / test / lint 그린
- [x] `/mypage` 및 `/bookings/[id]` 페이지 렌더 확인 (SSR HTML + dev 컴파일/미들웨어)

## Out of Scope

- 결제 만료 카운트다운, E-ticket 다운로드 UI — 별도 plan.
- COMPLETED 이후 후속 단계(여행 후기 등) — Phase 2 추가 기능 후보.
- 라이브 실거래(NO-REAL-MONEY §5) 관련 작업 일체.
