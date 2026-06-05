# Phase 10 — 대시보드 고도화: 커스텀 날짜 범위 & 상품별 필터

> 작성일: 2026-06-05
> 상태: 승인됨 (설계 확정, 구현 대기)
> 관련 ADR 후보: **ADR-0037** (start/end 일 양자화 캐시 키 + 프리셋=숏컷 재정의)
> 선행: Phase 6 운영 대시보드([ADR-0032]/[ADR-0033]), Phase 7 `useTransition` 펜딩 island 선례

---

## 1. 배경 & 목표

Phase 6에서 구축한 운영 대시보드는 고정 프리셋(`today/7d/30d/90d/all`) 단일 축으로만 기간을 제어한다(`?range=` → `parseRange()` → `DateRange`). 실무 운영자는 (a) 임의 회계 구간(예: "5/1~5/15 캠페인 기간")과 (b) 특정 상품 단위 성과 분석을 요구한다. Phase 10은 이 두 축을 추가한다.

**목표**
1. **커스텀 날짜 범위**: 고정 `RangeKey` 대신 임의 `start`/`end` 지정. 프리셋은 start/end를 채우는 숏컷으로 강등.
2. **상품별 필터링**: 상단 상품 드롭다운. 선택 시 KPI 4종 + 매출추이 + 좌석점유율 + 상태분포 **전부** 해당 상품 기준 재계산.

**비목표 (YAGNI)**
- 무거운 캘린더 라이브러리(`react-day-picker` 등) 도입 — 네이티브 `<input type="date">`로 충족.
- CSV 내보내기, 다중 상품 비교, 커스텀 KPI — 별도 에픽.
- 실시간(60s 미만) 갱신 — 기존 60s TTL 유지.

---

## 2. 현황 (As-Is)

| 요소 | 현재 구현 |
|---|---|
| URL 파라미터 | `?range=<RangeKey>` 단일 |
| 파싱 | `parseRange(raw)` → `DateRange{from, to, key, bucket}`. `to = new Date()`(ms 정밀도), 폴백 `30d` |
| 집계 | `entities/analytics/api/queries.ts` 6함수, 단일 테이블 `$queryRaw` |
| 캐시 | `unstable_cache(..., ["dash-X", range.key], { revalidate: 60, tags: ["analytics:dashboard"] })` |
| range 무관 스냅샷 | `getSeatOccupancy()`·`getBookingStatusDistribution()` → 정적 키 |
| UI | `DashboardRangeFilter`(프리셋 5탭 `<Link>`), 차트 2개 `'use client'` 리프([ADR-0033]) |
| 페이지 | `(admin)/admin/dashboard/page.tsx`, `force-dynamic`, `Promise.all` 6쿼리 |

**스키마 조인 경로** (상품 필터 근거):
- `Payment.bookingId → Booking.departureId → Departure.productId`
- `RefundJob.bookingId → Booking.departureId → Departure.productId`
- `Booking.departureId → Departure.productId`
- `Departure.productId` (직결)

---

## 3. 핵심 논점 ① — 데이터 모델 통일: `RangeKey` → `{start, end, productId}`

### 3.1 함정: 캐시 키가 enum이라 동작했다
현재 `unstable_cache` 적중의 *유일한* 이유는 키가 안정적인 enum(`range.key`)이기 때문이다. start/end로 단순 이행하면 `to = new Date()`(ms)가 매 요청 유니크 → **캐시 영구 미스**. 이 함정 회피가 양자화 전략(§5)의 존재 이유다.

### 3.2 `parseRange` → `parseFilter` 교체
새 시그니처: `parseFilter(searchParams: { start?, end?, productId? }) → DashboardFilter`.

```ts
interface DashboardFilter {
  from: Date;          // 집계 하한(포함), 일 경계 00:00:00.000Z
  to: Date;            // 집계 상한(미포함), 일 경계(end+1일 00:00 또는 오늘+1일 00:00)
  bucket: "day" | "month";
  productId: string | null;   // null = 전체 상품
  cacheKey: {                 // unstable_cache 키 파트 (직렬화 가능한 string)
    startDay: string;         // "YYYY-MM-DD"
    endDay: string;           // "YYYY-MM-DD"
    product: string;          // productId | "all"
  };
}
```

**파싱 규칙** (Zod + `.catch`):
- `start`/`end`: `YYYY-MM-DD` 형식 검증. 파싱 실패·누락 → 폴백.
- **폴백**: `end` 누락 = 오늘. `start` 누락 = `end − 30일`. `start > end`(역전) = 두 값 스왑 또는 30일 기본으로 리셋(구현 시 스왑 채택 — 운영자 의도 보존).
- `end` 상한 클램프: 미래 날짜 입력 시 오늘로 클램프(미래 데이터 없음).
- `productId`: cuid 형태면 통과(존재 검증 안 함 — 조인이 빈 결과로 자연 처리, §4.3). 형식 불일치 → `null`.

### 3.3 bucket 파생 (enum 의존 제거)
기존엔 `key`에 묶여 있었음(`all`=month, 그 외 day). 이제 **span 길이**로 결정:
- `(to − from) 일수 ≤ 92` → `"day"`
- 초과 → `"month"`

경계 92일은 분기당 일별 표시 상한(90일 프리셋 + 여유 2일). 1년 범위면 자동 월별.

### 3.4 프리셋 = 숏컷 (DashboardRangeFilter 재정의)
프리셋 칩(오늘/7일/30일/90일/전체)은 RangeKey가 아니라 **렌더 시점 계산된 `<Link href="?start=..&end=..&productId=..">`**. productId 보존. "전체"는 `start=2000-01-01`(epoch 근사) → 오늘.

`RangeKey` 타입은 제거하거나 프리셋 라벨 전용 const로 강등. 활성 칩 표시는 현재 start/end가 해당 프리셋 계산값과 일치할 때.

---

## 4. 핵심 논점 ② — 상품별 조인 + 캐시 차원 (전부 상품 스코프)

### 4.1 6개 집계 전부 productId 차원 추가
| 함수 | 변경 | 캐시 키 |
|---|---|---|
| `getRevenueSummary` | Payment/RefundJob → JOIN Booking→Departure WHERE productId | `["dash-revenue", startDay, endDay, product]` |
| `getPenaltyRevenue` | RefundJob → JOIN ... WHERE productId | `["dash-penalty", startDay, endDay, product]` |
| `getCancellationStats` | Booking → JOIN Departure WHERE productId | `["dash-cancel", startDay, endDay, product]` |
| `getRevenueTrend` | Payment/RefundJob → JOIN ... WHERE productId | `["dash-trend", startDay, endDay, product]` |
| `getSeatOccupancy` | Departure WHERE productId (range 무관 유지) | `["dash-occupancy", product]` |
| `getBookingStatusDistribution` | Booking → JOIN Departure WHERE productId (range 무관 유지) | `["dash-status", product]` |

### 4.2 조건부 조인 (productId=null 시 현 동작 보존)
`productId`가 `null`이면 JOIN·WHERE 절을 생략해 **기존 단일 테이블 쿼리와 동일**한 SQL·결과를 보장(하위호환). `Prisma.sql` 조각을 조건부로 합성:

```ts
const productFilter = productId
  ? Prisma.sql`AND b."departureId" IN (
      SELECT id FROM "Departure" WHERE "productId" = ${productId}
    )`
  : Prisma.empty;
```

> 서브쿼리 `IN (SELECT departureId ...)` 방식을 기본 채택(기존 SUM 구조 최소 변경). JOIN 방식 대비 가독성↑, Departure 인덱스(`@@unique([productId, departureDate])`) 활용. 성능 이슈 시 명시 JOIN으로 전환 가능.

### 4.3 비존재 productId 안전성
임의 productId가 들어와도 서브쿼리가 빈 집합 → SUM=0/COUNT=0 반환. 별도 존재 검증·404 불요. SQL 인젝션은 `Prisma.sql` 태그드 템플릿이 차단(§CLAUDE.md 권장 패턴).

### 4.4 상품 옵션 소스
드롭다운 옵션용 신규 read 쿼리 `getProductOptions()`: `{ id, title }[]` 전 상품(DRAFT 포함 — 운영자는 전체 가시). `unstable_cache` 5분 TTL, 태그 `analytics:dashboard` 공유(상품 생성/수정 시 자연 만료 또는 기존 무효화에 편승). `entities/analytics` 또는 `entities/product` 중 배치 — analytics가 리포팅 read-model이므로 `entities/analytics`에 둠([ADR-0032] 정신: 테이블 직접 조회, 모듈 import 안 함).

---

## 5. 캐시 양자화 전략 (상세)

### 5.1 문제
`unstable_cache`의 키 배열은 직렬화 가능 값만 허용하며, `Date`는 키로 못 쓴다(기존 코드 주석에도 명시). start/end를 그대로 ms 타임스탬프로 키에 넣으면 `to=now`가 매 요청 달라 적중 0.

### 5.2 해법: `YYYY-MM-DD` 일 경계 정규화 + 클램프
1. **양자화**: `from`/`to`를 일 경계로 절단. `startDay = from.toISOString().slice(0,10)`, `endDay = (to − 1ms).toISOString().slice(0,10)` (또는 사용자 입력 end 날짜 그대로).
2. **`to` 클램프**: "라이브" 구간(end=오늘)의 `to`를 **오늘 끝(내일 00:00)** 고정 → 같은 날 안에서 동일 키 → 동일 날짜 반복 조회 + 동시 조회 모두 60s 캐시 적중.
3. **키 구성**: `["dash-X", startDay, endDay, productId ?? "all"]`. 모두 string → 직렬화 안전.

### 5.3 적중 시나리오
| 시나리오 | 적중? | 이유 |
|---|---|---|
| 과거 고정 구간(5/1~5/15) 반복 조회 | ✅ | startDay/endDay 불변 |
| 같은 날 동일 필터 동시 다중 운영자 | ✅ | to가 "오늘 끝"으로 동일 양자화 |
| end=오늘, 1초 뒤 새로고침 | ✅ (60s 내) | to 키가 ms→일 경계라 동일 |
| 자정 경과 후 동일 "오늘" 조회 | ❌(의도) | endDay 바뀜 → 새 키, 신선 집계 |
| 상품 A→B 전환 | ❌(의도) | product 키 차원 다름 |

### 5.4 무효화
기존 `revalidateTag("analytics:dashboard")` 컨트랙트 유지. 60s TTL 자연 만료 우선(실시간성 불요). 양자화로 키 카디널리티가 (구간 수 × 상품 수)로 늘지만 TTL 60s라 메모리 누적 무시 가능.

---

## 6. 핵심 논점 ③ — FSD/UI: 격리된 Client Island 2개 + URL SSOT

### 6.1 SSOT 원칙
필터 상태(start/end/productId)는 **URL Search Params가 유일 진실원**. 컴포넌트 `useState`로 필터 상태 보관 금지. island는 입력을 받아 `router.push`로 URL을 갱신할 뿐, 결과는 RSC 재요청으로 흐른다. (Phase 6 `DashboardRangeFilter` 정신 계승, [ADR-0033] 차트 격리 원칙 일관.)

### 6.2 `DateRangePicker` (`'use client'` 리프)
- 위치: `widgets/admin-dashboard/ui/DateRangePicker.tsx`.
- 구성: `<input type="date" name="start">` + `<input type="date" name="end">` + 프리셋 칩 + "적용" 버튼.
- 동작: "적용" → 현재 `useSearchParams` 복사 → start/end 갱신(**productId 보존**) → `router.push`를 `useTransition`으로 감싸 `isPending` 스피너(`SortSelect` 선례). 타이머/리스너 없음 → cleanup 불요(§5 Frontend 규칙).
- **네이티브 `<input type="date">` 채택**: 무의존성·브라우저 네이티브 접근성·RSC 친화. 라이브러리 거부(ADR-0037 Alternatives).
- 초기값: 현재 URL의 start/end를 `defaultValue`로 주입(controlled 아님 — URL이 SSOT라 적용 전까지 로컬 편집은 비제어 입력으로 충분).

### 6.3 `ProductSelect` (`'use client'` 리프)
- 위치: `widgets/admin-dashboard/ui/ProductSelect.tsx`.
- props: `options: {id, title}[]`(서버에서 주입), `current: string | null`.
- 동작: `<select>` onChange → searchParams 복사 → productId 갱신(`"all"` 선택 시 param 삭제) → start/end 보존 → `router.push` + `useTransition`. `SortSelect` 패턴 동형.

### 6.4 페이지 & 조립
- `page.tsx`: `force-dynamic` 유지. `searchParams`에서 start/end/productId 읽어 `parseFilter`. 추가로 `getProductOptions()` 조회(7번째 병렬 쿼리). `Promise.all`로 6 집계 + 옵션.
- `AdminDashboard`(서버 조립): 상단에 `<DateRangePicker>` + `<ProductSelect options={...} current={...}>` 배치. KPI·차트는 기존대로 데이터 props 주입.
- 차트 client 리프는 **여전히 2개**(`RevenueTrendChart`/`BookingStatusDonut`). island 2개 추가로 총 4개 `'use client'`. 회귀 검증: `grep -c "use client" src/widgets/admin-dashboard/ui/*` 로 4개 확인.

---

## 7. 테스트 전략 (TDD)

| 대상 | 유형 | 케이스 |
|---|---|---|
| `parseFilter` | 단위(vitest, fake timers) | 양자화(ms→일경계), end 클램프(미래→오늘), 폴백(누락/오타), start>end 스왑, productId 형식, cacheKey 직렬화 형태 |
| bucket 파생 | 단위 | ≤92일=day, >92일=month 경계 |
| 프리셋 숏컷 링크 계산 | 단위 | 각 프리셋의 start/end 산출값 |
| 쿼리 productId 스코핑 | QA 런타임 증거 | seed 상품 1개 선택 시 KPI가 전체 대비 감소, 미존재 productId → 0 |
| island URL 갱신 | 단위(선택) | `SortSelect.test` 패턴 — productId 변경 시 start/end 보존 |

런타임 증거: `npm run typecheck`/`test`/`lint` + admin 로그인 후 `/admin/dashboard?start=..&end=..&productId=..` 실제 조회 스크린샷 또는 SQL count 대조.

---

## 8. 마이그레이션 / 하위호환

- `?range=<key>` 구식 링크: 깨지지 않게 `parseFilter`가 레거시 `range` 파라미터도 인식해 start/end로 1회 변환(선택적 — 북마크·외부 링크 보호). 미구현 시 폴백 30d로 흡수되므로 치명적 아님. **구현 시 레거시 매핑 포함 권장.**
- `parseRange`/`RangeKey`/`DateRange` 제거 시 import 그래프 점검: `entities/analytics/index.ts` barrel, `page.tsx`, `DashboardRangeFilter`, 기존 테스트.
- `analytics/index.ts` barrel에 `parseFilter`·`getProductOptions`·`DashboardFilter`·`ProductOption` 추가, `parseRange`·`RangeKey`·`DateRange` 제거/대체.

---

## 9. ADR 후보

**ADR-0037 — start/end 일 양자화 캐시 키 + 프리셋=숏컷 재정의**
- Context: enum 키 → 임의 날짜 전환 시 캐시 폭발.
- Decision: `YYYY-MM-DD` 양자화 + `to` 오늘-끝 클램프 키, 프리셋을 start/end 숏컷으로 강등.
- Alternatives: (a) 커스텀 비캐시 — 동시/반복 조회 보호막 상실로 거부, (b) 캐시 전면 제거 — DB 부하로 거부, (c) react-day-picker — 무의존성 위배로 거부.

> 저장소 실제 최신 ADR은 0036 → 다음 빈 번호는 **0037**. (지시상 "Phase 9 ADR-0037 발행"은 저장소에 존재하지 않아 0038 갭이 생기므로 0037로 정정 기록.)

---

## 10. 영향 파일 요약

**신규**: `model/filter.ts`(parseFilter) + 테스트, `ui/DateRangePicker.tsx`, `ui/ProductSelect.tsx`, `api/queries.ts`에 `getProductOptions`.
**수정**: `api/queries.ts`(6함수 productId 차원), `model/types.ts`(DashboardFilter/ProductOption), `index.ts` barrel, `page.tsx`, `ui/AdminDashboard.tsx`, `ui/DashboardRangeFilter.tsx`(숏컷 재정의).
**제거**: `model/range.ts`(parseRange) 또는 filter.ts로 흡수.
