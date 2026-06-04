# Phase 6 — 관리자 운영 대시보드 (Admin Dashboard)

> 작성일: 2026-06-04
> 상태: 설계 확정 (brainstorming 승인 완료)
> 관련 도메인: analytics(신규 read-model) · admin · payment · booking · departure
> 차트: Recharts (신규 런타임 의존성 1건)

---

## 1. 배경 & 목적

Phase 5-B까지 결제·환불·위약금 코어 백엔드가 완성되어 `Booking`/`Payment`/`RefundJob`/`Departure`에
운영 데이터가 누적된다. 그러나 admin은 개별 레코드 리스트(`/admin/bookings` 등)만 볼 수 있고
**집계된 사업 지표를 한 화면에서 조망할 수단이 없다.**

Phase 6은 이 누적 데이터를 시각화하는 **단일 운영 대시보드(`/admin/dashboard`)** 를 추가한다.
신규 비즈니스 로직이나 금전 이동은 없다 — **읽기 전용(read-only) 집계 + 시각화**에 한정한다.
(🛑 NO-REAL-MONEY 무관: 조회만 한다.)

## 2. 범위 (Scope)

### In scope
- MVP KPI 지표 4종 집계 + 카드 렌더링
- 차트 2종 (매출 추이 BarChart, 예약 상태 분포 PieChart)
- 기간 필터 (오늘 / 7일 / 30일 / 90일 / 전체) — **URL `searchParams` 기반**
- `entities/analytics` read-model 슬라이스 신규 생성
- `widgets/admin-dashboard` 위젯 신규 생성
- admin 셸 nav에 "대시보드" 진입점 추가 + `/admin` 랜딩을 대시보드로 전환

### Out of scope (YAGNI)
- 실시간 갱신(웹소켓/폴링) — admin 새로고침으로 충분
- CSV/엑셀 내보내기, 커스텀 날짜 범위 피커
- 상품별/목적지별 드릴다운, 코호트 리텐션
- 매출 예측·이상탐지 등 분석 고도화
- 대시보드 권한 세분화(현재 ADMIN 단일 role로 충분)

## 3. MVP 지표 정의 (SSOT)

모든 금액은 **정수(원)**. 환율·소수 없음.

| # | 지표 | 정의 | 소스 쿼리 |
|---|---|---|---|
| 1 | **순매출** | Σ 결제액 − Σ 실환불액 | `Payment.amount`(paidAt∈range) − `RefundJob.amount`(SUCCEEDED, updatedAt∈range) |
| 2 | **위약금 수익** | Σ 동결 위약금(성공 환불) | `RefundJob.penaltyAmount`(status=SUCCEEDED, updatedAt∈range) |
| 3 | **취소율** | 코호트 취소 비율 | range 내 생성(`createdAt`) booking 중 status∈{CANCELED_BY_USER, CANCELED_BY_AGENCY} 비율 |
| 4 | **좌석 점유율** | 현재 스냅샷(range 무관) | Σ`bookedSeats` / Σ`capacity` (예정 출발: `departureDate ≥ 오늘`, status≠CANCELED) |

**기간 의존성 주의:** 지표 1·2·3은 range 의존(시간 윈도우 집계), 지표 4는 **현재 스냅샷**(예정 출발 재고).
이 차이는 카드 캡션에 "현재 기준"으로 명시한다. 혼동 방지.

### 차트
- **매출 추이** (BarChart): range 내 **일별** `결제액`(`paidAt` 버킷) vs `환불액`(SUCCEEDED `updatedAt` 버킷).
  `date_trunc('day', ...)` GROUP BY. range=전체일 때만 월별 버킷으로 폴백(가독성).
- **예약 상태 분포** (PieChart): 전체 booking을 `status`별 count (현재 스냅샷). PAID/READY/COMPLETED 등
  표시용 그룹으로 묶어 5개 슬라이스 이내 유지.

## 4. 아키텍처

### 4.1 데이터 페칭 — RSC 우선
```
/admin/dashboard/page.tsx  (RSC, force-dynamic)
   │  parseRange(searchParams.range) → { from, to, key }   // 순수함수, TDD
   │  Promise.all([
   │    getRevenueSummary(range),         // KPI 1
   │    getPenaltyRevenue(range),         // KPI 2
   │    getCancellationStats(range),      // KPI 3
   │    getSeatOccupancy(),               // KPI 4 (스냅샷)
   │    getRevenueTrend(range),           // 차트 1
   │    getBookingStatusDistribution(),   // 차트 2
   │  ])
   └─▶ <AdminDashboard {...metrics} />    // widget이 props로 조합
```

- 모든 집계는 `entities/analytics/api/queries.ts`의 **`db.$queryRaw` + `Prisma.sql`** (N+1 0, SQL 인젝션 0).
- 각 쿼리는 `unstable_cache`로 래핑: **revalidate 60초**, key에 `range.key` 포함, tag `analytics:dashboard`.
  admin은 force-dynamic이지만 집계 SQL은 60초 캐시로 연타 새로고침 부하를 흡수
  (product `getFeaturedProducts` 5분 캐시 선례 동형). 무효화는 TTL 자연만료에 의존(실시간성 불요).

### 4.2 기간 필터 — searchParams (useState 금지)
- 필터 UI(`DashboardRangeFilter`)는 **plain `<Link href="?range=7d">`** 묶음 = 순수 RSC.
  클라이언트 상태 없음 → 새로고침/공유/뒤로가기 모두 URL과 일치. 활성 탭은 현재 `range` 비교로 강조.
- `parseRange`는 미지정/오타 입력을 `30d` 기본값으로 폴백(`.catch` 정신). enum: `today|7d|30d|90d|all`.

### 4.3 Recharts — 클라이언트 리프 격리
- `recharts`는 `ResponsiveContainer`가 `window`/`ResizeObserver`에 의존 → **차트 컴포넌트만 `'use client'` 리프**.
- 서버가 집계한 **plain 배열을 props로 주입**. 페칭=서버, 렌더=클라이언트. 집계 SQL은 브라우저로 누출 0,
  recharts 번들은 대시보드 페이지에만 실림.
- `RevenueTrendChart`(BarChart), `BookingStatusDonut`(PieChart) 2개 리프.

### 4.4 FSD 레이어 배치
```
src/entities/analytics/            # 신규 read-model 도메인 (단일 책임: 집계 조회)
  api/queries.ts                   # 6개 집계 함수 (unstable_cache + $queryRaw)
  model/
    range.ts                       # parseRange(): 순수함수 (TDD 대상)
    types.ts                       # RevenueSummary, RevenueTrendPoint, StatusSlice, DateRange ...
  api/__tests__/                   # range/매핑 단위 테스트
  index.ts                         # barrel (공개 API)

src/widgets/admin-dashboard/       # 신규 위젯 (entities/analytics 조합, 직접 DB 금지)
  ui/
    AdminDashboard.tsx             # server: KPI 카드 + 차트 그리드 조립
    DashboardKpiCards.tsx          # server: 4 KPI 카드
    DashboardRangeFilter.tsx       # server: Link 기반 기간 탭
    RevenueTrendChart.tsx          # 'use client' Recharts BarChart 리프
    BookingStatusDonut.tsx         # 'use client' Recharts PieChart 리프
  index.ts

src/app/(admin)/admin/dashboard/page.tsx   # RSC 엔트리 (force-dynamic)
```

- **단방향 의존성 준수**: `app → widgets → entities → shared`. 위젯은 `@/entities/analytics` barrel만 import.
- `entities/analytics`가 `db.$queryRaw`로 `Payment`/`Booking`/`RefundJob` 테이블을 조회하는 것은
  **다른 entity 모듈 import가 아니라 Prisma(shared) 직접 쿼리** → cross-slice 위반 아님.
- 차트 leaf의 `'use client'`는 widgets 레이어이므로 허용(entities/ui의 'use client' 금지 규칙과 무관).

### 4.5 admin 셸 진입점
- `layout.tsx` nav 최상단에 "대시보드"(`/admin/dashboard`) 링크 추가.
- `(admin)/admin/page.tsx`의 redirect 대상을 `/admin/products` → `/admin/dashboard`로 변경
  (대시보드가 admin의 자연스러운 홈). `UserNavIsland`의 "관리자" 링크 href도 함께 갱신
  (CLAUDE.md §8 "새 admin 1차 화면 변경 시 두 곳 동기화" 규칙 준수).

## 5. 의존성

- **신규 런타임 의존성: `recharts`** (1건). App Router/React 19 호환, SVG 기반, tree-shakeable.
  대안(Chart.js=canvas+ref 수동배선, visx=저수준 과설계, Tremor=Tailwind 충돌 위험)은 거부.
  ADR 후보(§7).

## 6. 검증 전략 (QA)

- `parseRange` 순수함수: TDD — 유효 enum / 미지정 / 오타 → 경계 단위 테스트.
- 집계 쿼리: seed 데이터 기준 `prisma`/`$queryRaw` 직접 실행으로 기대 합계 대조(런타임 증거).
- `npm run typecheck` / `npm run test` / `npm run lint` 그린.
- `/admin/dashboard?range=7d` 등 각 range 렌더 + 활성 탭 강조 육안 확인(목업 대비).
- 차트 leaf가 서버 번들에 안 섞이는지(`'use client'` 경계) 확인.

## 7. ADR 후보 (작성 제안 — 승인 시 발행)

1. **`entities/analytics` read-model 도메인 신설** — 다중 도메인(payment/booking/departure)을 가로지르는
   집계의 단일 홈. 대안(각 entity에 분산 / widget에서 직접 DB)과의 트레이드오프 박제 가치.
2. **Recharts 채택** — Chart.js/visx/Tremor 거부 이유 박제(6개월 뒤 재논의 방지).

---

## 부록 A — 지표별 SQL 개략 (구현 가이드)

```sql
-- 1. 순매출 (range: from..to)
SELECT
  COALESCE((SELECT SUM(amount) FROM "Payment"
            WHERE "paidAt" >= $from AND "paidAt" < $to), 0)
  -
  COALESCE((SELECT SUM(amount) FROM "RefundJob"
            WHERE status = 'SUCCEEDED' AND "updatedAt" >= $from AND "updatedAt" < $to), 0)
  AS net_revenue;

-- 2. 위약금 수익
SELECT COALESCE(SUM("penaltyAmount"), 0) AS penalty_revenue
FROM "RefundJob"
WHERE status = 'SUCCEEDED' AND "updatedAt" >= $from AND "updatedAt" < $to;

-- 3. 취소율 (코호트: createdAt∈range)
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE status IN ('CANCELED_BY_USER','CANCELED_BY_AGENCY')) AS canceled
FROM "Booking"
WHERE "createdAt" >= $from AND "createdAt" < $to;

-- 4. 좌석 점유율 (현재 스냅샷)
SELECT
  COALESCE(SUM("bookedSeats"), 0) AS booked,
  COALESCE(SUM(capacity), 0) AS capacity
FROM "Departure"
WHERE "departureDate" >= CURRENT_DATE AND status <> 'CANCELED';

-- 차트1. 매출 추이 (일별)
SELECT date_trunc('day', "paidAt") AS bucket, SUM(amount) AS paid
FROM "Payment" WHERE "paidAt" >= $from AND "paidAt" < $to
GROUP BY 1 ORDER BY 1;
-- (환불액은 RefundJob.updatedAt SUCCEEDED 동형 쿼리로 병합)

-- 차트2. 예약 상태 분포 (스냅샷)
SELECT status, COUNT(*) AS n FROM "Booking" GROUP BY status;
```

> `range=all`은 `$from`을 epoch(또는 NULL 가드)로 두고 추이 차트만 월별(`date_trunc('month', ...)`) 버킷.
