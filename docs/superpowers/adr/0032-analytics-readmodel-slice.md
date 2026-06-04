# ADR-0032: 대시보드 집계를 `entities/analytics` 통합 read-model 슬라이스로 분리

- **상태**: Accepted
- **결정일**: 2026-06-04
- **영향 범위**: `src/entities/analytics/**`, `src/widgets/admin-dashboard/**`, `src/app/(admin)/admin/dashboard/page.tsx`
- **관련 commit**: `7174ba8` (parseRange), `45a9807` (집계 read-model), `94e1af5` (status 가드 + 시간축 주석)

## Context (배경)

Phase 6 관리자 대시보드는 **순매출·위약금 수익·취소율·좌석 점유율** 4개 KPI와 매출 추이/상태 분포 차트를
한 화면에 모은다. 이 집계는 본질적으로 **여러 도메인을 가로지른다**:

- 순매출/추이 → `Payment` + `RefundJob`
- 위약금 수익 → `RefundJob.penaltyAmount`
- 취소율/상태 분포 → `Booking`
- 좌석 점유율 → `Departure`

FSD에서 `entities/*`는 단일 도메인 모듈이며 **동일 레이어 cross-slice import가 금지**(§5)된다.
"대시보드 통계"라는 읽기 전용 관심사를 어디에 둘지가 문제였다. 기존 도메인 슬라이스(`booking`, `payment`)에
억지로 끼워 넣으면 각 슬라이스가 "자기 도메인 + 대시보드 집계" 두 책임을 지게 되고, 위젯이 4개 슬라이스를
조합해야 해 "대시보드 데이터"의 단일 홈이 사라진다.

## Decision (결정)

**리포팅 전용 read-model을 1급 도메인 `entities/analytics`로 신설**한다. 이 슬라이스는 쓰기 없이 집계 조회만 보유:

```ts
// entities/analytics/api/queries.ts — 6개 집계, 전부 단일 $queryRaw + Prisma.sql
// 다른 entity 모듈을 import하지 않는다. shared의 db로 Prisma 테이블을 직접 조회.
async function _revenue(from, to) {
  const rows = await db.$queryRaw<{ paid: bigint; refunded: bigint }[]>(Prisma.sql`
    SELECT
      COALESCE((SELECT SUM(amount) FROM "Payment"
                WHERE "paidAt" >= ${from} AND "paidAt" < ${to}
                  AND status IN ('PAID','PARTIAL_CANCELED','CANCELED')), 0) AS paid,
      COALESCE((SELECT SUM(amount) FROM "RefundJob"
                WHERE status='SUCCEEDED' AND "updatedAt" >= ${from} AND "updatedAt" < ${to}), 0) AS refunded`);
  // ... num() 정규화 후 { paid, refunded, net: paid-refunded }
}
```

핵심 경계 규칙:
- **다른 entity 모듈 import 0** — `Payment`/`Booking` 등을 *모듈*로 가져오지 않고, `shared/lib/db`의 Prisma로
  *테이블*을 raw 조회한다. 이는 cross-slice import가 아니므로 FSD 단방향 위반이 아니다.
- 모든 집계는 단일 SQL(N+1 0), `unstable_cache(revalidate:60, tags:['analytics:dashboard'])`로 래핑.
  캐시 키에 `range.key`(enum 문자열)를 포함 — `unstable_cache`가 `Date`를 직렬화 못 하기 때문.
- `widgets/admin-dashboard`는 `@/entities/analytics` barrel만 바라본다(직접 DB 금지 규칙 준수).

## Consequences (결과)

**얻은 것:**
- "대시보드 데이터"의 단일 홈 — 타입(`DashboardData`)·쿼리·기간 파싱(`parseRange`)이 한곳에 응집.
- 각 도메인 슬라이스(`booking`/`payment`)는 리포팅 책임에서 자유 — 단일 책임 유지.
- 위젯/페이지는 6개 함수를 `Promise.all`로 병렬 호출만 하면 됨 — 페칭 병목·N+1 구조적 차단.
- read-model이라 쓰기 경로(돈·좌석 안전)와 완전히 격리 — 대시보드 변경이 결제/예약에 영향 0.

**포기한 것 / 미해결:**
- "analytics가 4개 테이블을 raw로 안다" — 스키마 변경 시 이 슬라이스의 SQL도 함께 손봐야 하는 결합.
  단, 컬럼명 변경은 어차피 광범위 영향이므로 수용 가능한 비용.
- 집계가 `Prisma` 관계 대신 raw SQL이라 타입 안전은 `$queryRaw<RowType[]>` 수동 제네릭에 의존.

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: 각 도메인 슬라이스에 집계 분산 (revenue→payment, cancel→booking, occupancy→departure)
- 가장 "순수 FSD"처럼 보이는 배치. 각 통계를 해당 도메인이 소유.
- **거부 이유**: ① "대시보드 데이터"의 단일 타입(`DashboardData`)이 갈 곳이 없어진다 — 위젯이 4개 슬라이스의
  부분 타입을 조립해야 함. ② 순매출/추이는 `Payment`+`RefundJob` 두 도메인에 동시 걸쳐 어느 슬라이스
  소유인지 모호. ③ 리포팅 관심사가 도메인 코어에 누수돼 슬라이스마다 책임이 둘로 늘어남.

### 옵션 B: 위젯(`widgets/admin-dashboard`)에서 직접 DB 조회
- 슬라이스 신설 없이 위젯이 `db.$queryRaw`를 직접 호출.
- **거부 이유**: CLAUDE.md §2 "widgets는 직접 DB 호출 금지" 명시 위반. 위젯은 entity UI 조합 레이어이지
  데이터 게이트웨이가 아니다. 테스트·캐시·재사용 경계도 무너진다.

### 옵션 C: `shared`에 집계 유틸로 배치
- 도메인 무지(domain-agnostic) 레이어에 통계 함수 추가.
- **거부 이유**: 집계는 `Booking`/`Payment` 도메인 스키마를 강하게 안다 — domain-agnostic이 아니다.
  `shared`에 도메인 지식이 새면 레이어 정의가 무너진다.

## Notes

- 새 KPI 추가 시 `entities/analytics/api/queries.ts`에 단일 SQL 함수 + barrel export + `DashboardData` 확장
  한 곳만 손대면 위젯/페이지가 자동 흡수.
- 무효화는 60s TTL 자연만료에 의존(실시간성 불요). 즉시 무효화가 필요해지면 booking/refund 뮤테이션에
  `revalidateTag('analytics:dashboard')`를 추가하면 됨(태그는 이미 부여돼 있음).
- 시간축 비대칭(매출=`paidAt`, 환불=`updatedAt`)은 의도된 설계 — 코드 주석으로 박제(ADR-0027 스냅샷 정신과 동형).
- 6개월 뒤 의심받을 부분: "왜 analytics가 raw SQL이고 Prisma 관계가 아니지?" → 집계(SUM/FILTER/date_trunc/
  FULL OUTER JOIN)는 Prisma 빌더로 표현이 불가능하거나 N+1을 유발. raw + `Prisma.sql` 파라미터화가 정답.
