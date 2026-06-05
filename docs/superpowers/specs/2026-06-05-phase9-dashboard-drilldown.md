# Phase 9 — Dashboard Drill-down & CSV Export (설계 스펙)

> 작성일: 2026-06-05 · 상태: **승인됨(설계)** · 후속: `2026-06-05-phase9-dashboard-drilldown-plan.md`
> 관련 ADR 후보: **ADR-0037** (CSV export: client-side Blob 채택 + 5000 cap + server streaming 승격 조건)

---

## 1. 배경 & 목표

운영 대시보드(`/admin/dashboard`)의 KPI 카드는 현재 **집계값(aggregate)** 만 보여준다. 운영자가 "이번 달 취소 12건이 *구체적으로 무엇*인지" 확인하려면 별도 화면(`/admin/bookings`)으로 이탈해 수동 필터링해야 한다.

Phase 9는 두 가지 실무 가치를 추가한다:

1. **Drill-down** — KPI 카드 클릭 시 **페이지 이동 없이** 우측 슬라이드 패널(Sheet)로 해당 메트릭의 원천 로우(raw rows)를 즉시 표시.
2. **CSV Export** — 패널에 내장된 버튼으로, 표시 중인 메트릭의 전체 로우를 CSV로 다운로드.

**핵심 설계 원칙**: 드릴다운과 CSV는 **메트릭당 단일 read-model 쿼리 1벌**을 공유한다. 패널이 미리보기를 위해 가져온 in-memory 로우셋이 그대로 CSV의 입력이 된다 → 쿼리·DTO·직렬화 중복 0, 서버 추가 부하 0.

### 비목표 (Out of Scope)
- 차트(매출추이 막대 / 상태 도넛 조각) 데이터포인트 드릴다운 — KPI 카드 4종만.
- 서버 스트리밍 CSV / 대용량(수만 행+) 추출 — 소규모(~수천 행) 가정. 초과 시 ADR-0037 승격 경로.
- 커스텀 날짜 범위 picker — 기존 `?range=` 프리셋(today/7d/30d/90d/all) 재사용.
- 상품별 추가 드릴다운(별도 에픽).

---

## 2. 메트릭 ↔ 드릴다운 데이터셋 매핑

| KPI 카드 | metric 키 | 원천 쿼리 (read-model) | window | 주요 컬럼 |
|---|---|---|---|---|
| 순매출 (결제−환불) | `revenue` | `Payment` WHERE `paidAt`∈range AND status∈(PAID, PARTIAL_CANCELED, CANCELED) | range | 결제일·주문ID·상품명·고객·결제액·환불액·상태 |
| 위약금 수익 | `penalty` | `RefundJob` WHERE status=SUCCEEDED AND `updatedAt`∈range | range | 처리일·상품명·고객·kind·기준액·위약금·실환불액 |
| 취소율 | `cancellation` | `Booking` WHERE `createdAt`∈range AND status∈(CANCELED_BY_USER, CANCELED_BY_AGENCY) | range | 예약일·취소일·상품명·고객·상태·사유·금액 |
| 좌석 점유율 (현재) | `occupancy` | `Departure` WHERE `departureDate`≥CURRENT_DATE AND status≠CANCELED | **range 무관(스냅샷)** | 출발일·상품명·정원·예약좌석·점유율%·상태 |

**불일치 차단 불변식**: 각 드릴다운 쿼리는 KPI 집계 쿼리(`entities/analytics/api/queries.ts`)와 **동일한 WHERE 필터·동일 window·동일 60s 캐시·동일 tag(`analytics:dashboard`)** 를 사용한다. 그래야 "카드 숫자 ≠ 패널 로우 수/합계" 불일치가 구조적으로 발생하지 않는다.

- `revenue` 카드의 *순매출*은 `paid − refunded`지만, 드릴다운은 결제(Payment) 로우를 보여준다(환불액은 행별 `refundedAmount` 컬럼으로 동행 표기). 운영자가 "무엇이 매출을 구성하는가"를 보는 관점에 맞춘다.
- `occupancy`는 range 무관 현재 스냅샷이므로 Server Action에서 range 인자를 무시한다(카드도 동일).

---

## 3. 아키텍처 (FSD 준수)

### 3.1 레이어 배치

```
shared/lib/csv/
  toCsv.ts                      # 순수 함수: rows + columns → RFC4180 CSV 문자열. client-safe(env import 0).
  __tests__/toCsv.test.ts       # TDD: escaping/개행/한글 BOM/빈배열

entities/analytics/
  api/drilldown.ts              # 4개 상세 쿼리 (단일 JOIN, N+1 0), 60s unstable_cache, tag=analytics:dashboard
  model/types.ts                # + Row DTO 4종 + DrilldownMetric + DrilldownResult<T> + ColumnDef
  model/columns.ts              # 메트릭별 컬럼 정의(헤더 라벨 + 셀 접근자) — 테이블/CSV 공유 SSOT
  index.ts                      # barrel: 쿼리·타입·컬럼 공개

features/admin-dashboard-drilldown/        # ← 신규 (인터랙션 단위)
  ui/KpiDrilldownGrid.tsx       'use client' # KPI 카드 4종(클릭 가능) + openMetric 상태 + Sheet 렌더
  ui/DrilldownSheet.tsx         'use client' # 슬라이드 패널 + 미리보기 테이블 + CSV 다운로드 버튼
  lib/downloadCsv.ts                         # Blob + createObjectURL + revokeObjectURL 래퍼 (client)
  server/actions.ts                          # loadDrilldownAction — Zod + admin 가드
  index.ts                      # barrel: KpiDrilldownGrid 공개

widgets/admin-dashboard/
  ui/AdminDashboard.tsx         # DashboardKpiCards → KpiDrilldownGrid 로 교체 (range 전달)
  ui/DashboardKpiCards.tsx      # (제거 or 카드 presentational sub로 흡수 — 구현 시 결정)
```

### 3.2 FSD 의존성 규칙 준수
- **데이터 접근 단일화**: 모든 DB 조회는 `entities/analytics` 내부. `features`·`widgets`는 `@/entities/analytics` **barrel만** import(직접 `db` 금지). `entities/analytics`는 다른 entity 모듈을 import하지 않고 `shared`의 `db.$queryRaw`로 *테이블*만 직접 조회 → cross-slice import 아님([ADR-0032] 선례 계승).
- **widget → feature 의존은 정방향**(허용). `widgets/admin-dashboard`가 `features/admin-dashboard-drilldown` 의 `KpiDrilldownGrid`를 조립.
- **client island 격리**: `'use client'`는 `KpiDrilldownGrid`/`DrilldownSheet` 2개 리프에만. 차트 island 2개([ADR-0033])는 무손상 → 대시보드 위젯의 client 리프는 총 4개.
- **CSV 순수 함수는 `shared`**: 도메인 무지(domain-agnostic) 직렬화 로직이므로 `entities`가 아닌 `shared/lib/csv`. client-safe — `@/shared/lib/env` import **금지**(브라우저 ZodError 사고 방지, [feedback_client_safe_no_env_import]).

---

## 4. Client-side CSV Export (지시사항: 무거운 라이브러리 금지)

### 4.1 구현 제약 (Non-negotiable)
- ❌ `papaparse`, `json2csv`, `xlsx` 등 **외부 CSV/엑셀 라이브러리 도입 금지**.
- ✅ 오직 브라우저 **네이티브 API**: `Blob`, `URL.createObjectURL`, `<a download>`, `URL.revokeObjectURL`.
- ✅ 직렬화는 **초경량 순수 함수** `shared/lib/csv/toCsv.ts` 하나로. 의존성 0.

### 4.2 `toCsv` 순수 함수 계약
```ts
interface CsvColumn<T> { header: string; value: (row: T) => string | number | null | undefined; }
function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string;
```
- **RFC 4180 이스케이프**: 셀에 `"`·`,`·`\n`·`\r` 포함 시 전체를 `"`로 감싸고 내부 `"`→`""`.
- `null`/`undefined` → 빈 문자열.
- 행 구분 `\r\n`(엑셀 호환), 헤더 1행 선행.
- 한글 깨짐 방지: 다운로드 시 **UTF-8 BOM(`﻿`)** prepend (toCsv는 BOM 미포함 순수 문자열 반환, BOM은 `downloadCsv` 래퍼가 부착 — 순수 함수는 직렬화만).

### 4.3 다운로드 흐름 (`features/.../lib/downloadCsv.ts`)
```
csv = toCsv(rows, columns)
blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })
url = URL.createObjectURL(blob)
<a href=url download="nextour_{metric}_{rangeKey}_{yyyymmdd}.csv"> 프로그램 클릭
URL.revokeObjectURL(url)   // ← 누수 차단 (필수)
```

### 4.4 전략 결정 근거 (ADR-0037 후보)
| | Client-side Blob **(채택)** | Server-side Streaming |
|---|---|---|
| 서버 부하 | **0** (이미 로드된 in-memory 로우 순수 변환) | 다운로드마다 DB 커넥션·CPU 직렬화 |
| 추가 인프라 | 없음 | Route Handler + auth + 커서 페이지네이션 + 스트림 |
| 대용량 | ~수만 행+ 시 브라우저 메모리 위험 | 수십만 행+ 상수 메모리 |
| 적합도 | **소규모·이미 로드된 데이터에 최적** | 대규모 전용 |

**채택: Client-side Blob.** 패널이 미리보기를 위해 (소규모) 전체 로우셋을 이미 클라이언트로 가져오므로 CSV는 그 배열의 순수 변환일 뿐 서버 비용 0. **MAX 5000행 cap**을 안전핀으로 두고, 초과 시 server streaming Route Handler로 승격(미래 ADR 트리거).

---

## 5. 데이터 플로우 & 보안 (Backend)

1. 패널 open → `KpiDrilldownGrid`가 `loadDrilldownAction({ metric, range })` 호출(`useTransition`으로 pending).
2. **Server Action** (`features/.../server/actions.ts`):
   - **자체 admin 가드**: `auth()` + `session.user.role === "ADMIN"` 검증. (admin) 레이아웃 가드와 *별개* — Server Action은 독립 호출 가능 엔드포인트라 내부 가드 필수(방어선 이중화).
   - **Zod 파싱**: `{ metric: z.enum(["revenue","penalty","cancellation","occupancy"]), range: z.enum(["today","7d","30d","90d","all"]) }`. 실패 시 거부.
   - 클라이언트가 보낸 **날짜는 불신** — 서버가 `parseRange(range)`로 window 재도출(SSOT).
3. `entities/analytics/api/drilldown.ts` 상세 쿼리 실행:
   - 메트릭당 **단일 raw-SQL JOIN**(상품명·고객명 포함) → N+1 0.
   - **MAX 5000행 cap**(`LIMIT 5000`). 총건수는 별도 COUNT 또는 cap 도달 플래그.
   - `unstable_cache` 60s, key=`["drilldown", metric, rangeKey]`, tag=`analytics:dashboard`.
   - 반환: `DrilldownResult<T> = { rows: T[]; total: number; capped: boolean }`.
4. 클라이언트: 미리보기 테이블(스크롤 컨테이너) 렌더 + `capped`면 경고 배너("상위 5000건만 표시·추출") + "CSV 다운로드 (N건)" 버튼.

### 보안/성능 체크리스트
- [규칙] Server Action 입력 Zod 검증 — 누락 금지.
- [규칙] `process.env` 직접 접근 금지(`env.X`). client 모듈은 `@/shared/lib/env` import 금지.
- [규칙] `any`/`as any`/`@ts-ignore` 금지.
- raw SQL은 `Prisma.sql` 태그드 템플릿(인젝션 차단).

---

## 6. 프론트엔드 메모리 누수 방어 (Frontend)

- **stale 응답 무시**: 메트릭 빠른 전환 시 직전 Server Action 응답이 늦게 도착해 잘못된 메트릭을 렌더하지 않도록 **load-token(요청 시퀀스 번호) 가드**. Server Action은 AbortController로 취소 불가하므로 토큰 비교로 차단.
- **키보드/오버레이 리스너 cleanup**: ESC 키 close → `useEffect` 내 `window.addEventListener("keydown", ...)` 등록 시 **반드시 cleanup**. 오버레이 클릭 close.
- **포커스 관리**: 패널 open 시 포커스 이동, close 시 트리거로 반환(a11y 최소선).
- **CSV objectURL 회수**: `URL.revokeObjectURL` 필수.
- 카드/그리드는 `'use client'`지만 `db`·`env` import 0 — 순수 presentational + 상태.

---

## 7. 테스트 전략 (QA, TDD 우선)

| 대상 | 유형 | 케이스 |
|---|---|---|
| `shared/lib/csv/toCsv` | 순수 단위 (TDD: FAIL→구현→PASS) | 쉼표·따옴표 이스케이프, 개행 포함 셀, null/undefined, 빈 배열(헤더만), 숫자 셀, 컬럼 순서 |
| `entities/analytics` drilldown | 단위 | range window 경계, status 필터 정확성, cap(5000) 경계, occupancy range 무시 |
| `loadDrilldownAction` | 단위 | Zod 거부(잘못된 metric/range), 비-admin 거부, 정상 통과 |
| 런타임 | QA 증거 | dev 서버에서 카드 클릭→패널→CSV 다운로드 + `typecheck`/`test`/`lint` |

> 컬럼 정의(`model/columns.ts`)를 테이블과 CSV가 공유하므로, 한 메트릭의 컬럼 변경이 양쪽에 자동 반영(SSOT) — drift 테스트 불필요.

---

## 8. ADR 후보

- **ADR-0037 (후보)**: CSV export 전략 — client-side Blob 채택. *거부한 대안*: server streaming Route Handler(현 데이터 규모에 과설계), 외부 라이브러리(papaparse 등, 번들 비용·의존성). *승격 조건*: 추출 데이터가 수만 행을 상시 초과하면 streaming으로 전환.

---

## 9. 영향 받는 기존 파일

- `widgets/admin-dashboard/ui/AdminDashboard.tsx` — KPI 그리드 교체.
- `widgets/admin-dashboard/ui/DashboardKpiCards.tsx` — presentational 흡수 or 제거.
- `entities/analytics/model/types.ts` / `index.ts` — DTO·barrel 확장.
- `app/(admin)/admin/dashboard/page.tsx` — `range` 키를 그리드까지 전달(이미 range 보유, props 경로만 연장).
