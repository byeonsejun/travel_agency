# ADR-0048: Admin 셸 디자인 토큰화 + 도메인 의미색(tone) 분리 추상화

- **상태**: Accepted
- **결정일**: 2026-06-10
- **영향 범위**: `src/shared/ui/{table,badge}.tsx`, `src/app/(admin)/**`, `src/features/admin-*`, `src/widgets/{admin-dashboard,booking-detail}`
- **관련 commit**: `371e572`(Table 프리미티브), `50d6a12`/`25b60b5`(Badge tone + WCAG), `d26ecda`(layout 토큰화), `772356e`(PR #22 merge)

## Context (배경)

`(site)` 공개 셸은 A1 "클린 블루" 디자인 시스템(shadcn 프리미티브 8종 + HSL 토큰)으로 전면 개편됐으나, `(admin)` 셸은 레거시 스타일(`red-700` 브랜드 · `indigo-600` 1차 액션 · raw gray + 수제 배지/테이블)로 남아 시각적 일관성 갭이 있었다.

admin 이관에는 `(site)`에 없던 두 가지 구조적 난점이 있었다.

1. **도메인 상태색의 편재(遍在).** admin은 `ProductStatus`·`BookingStatus`·`PaymentStatus`·`RefundJobStatus`·`DepartureStatus`·`ReviewStatus`·`EmbeddingJobStatus`·`DepartureCancellationStatus` 등 8종 enum의 상태 배지를 도처에서 렌더한다. 각 상태에 색을 입히는 로직이 필요한데, 이를 어디에 두느냐가 FSD 단방향 의존성과 직결된다 — `shared/ui`가 도메인 enum을 알면 레이어 경계가 무너진다.
2. **"브랜드 통일"과 "상태색 보존"의 긴장.** A1 토큰화는 무의미한 브랜드·구조 색을 클린 블루로 수렴시키려 하지만, 상태 배지의 green/yellow/red는 *의미를 전달*(완료/대기/실패)하므로 토큰으로 치환하면 정보가 소실된다.

## Decision (결정)

**"신호등 vs 표지판 기둥" 원칙**으로 색을 이원화하고, 도메인 지식을 `shared/ui` 밖에 격리한다.

1. **무의미 색(표지판 기둥) → A1 토큰.** 브랜드·구조 색(`red-700`/`indigo-*`/raw gray)은 `primary`/`muted`/`card`/`border`/`foreground` 토큰으로 수렴.
2. **의미 색(신호등) → 리터럴 보존.** 상태를 전달하는 색은 브랜드 무관하게 유지([ADR 없이도 OK였던 site의 포함/불포함 green/red 선례 계승).
3. **`Badge`에 도메인 무지 `tone` 4종 추가** (`success`/`warning`/`info`/`neutral`, cva `variant` 단일 축). `shared/ui/badge`는 tone(추상)만 알고 enum은 모른다. **`enum → tone` 매핑은 각 페이지/island(도메인 인지 레이어)가 소유**한다.

```ts
// 페이지 소유 (도메인 인지). shared/ui 는 이 Record 를 모른다.
const STATUS_TONE: Record<ProductStatus, "success" | "warning" | "neutral"> = {
  DRAFT: "warning", PUBLISHED: "success", CLOSED: "neutral",
};
// <Badge variant={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Badge>
```

4. **데이터 밀도용 `Table` 프리미티브(9번째) 신설** — 도메인 무지, A1 토큰. 17개 admin 테이블의 수제 `<table>` 마크업을 SSOT로 수렴.
5. **엔티티 레벨 상태 배지(`BookingStatusBadge`·`PaymentStatusBadge`)는 5-tone으로 흡수하지 않고 보존.** 이들은 8개 상태를 *각각 다른 의미색*(blue/emerald/purple/gray…)으로 구분하므로, 5-tone에 강제하면 PAID/READY/COMPLETED가 모두 `success`로 뭉개져 정보가 손실되고 (site) 공유 컴포넌트라 범위가 번진다.

## Consequences (결과)

**얻은 것:**
- `(site)`/`(admin)` 시각 일관성. 백엔드·도메인·캐시(`force-dynamic`/ISR) 0줄 변경.
- **FSD 경계 무손상** — `shared/ui`는 색맹(tone 추상만), 도메인 지식 누출 0. 신규 `'use client'` 0건.
- **타입 강제 망라성** — `Record<Enum, Tone>`가 enum 추가 시 컴파일 에러로 색 누락을 강제 검출(사람 눈검사 불요).
- `Table`/`Badge tone` 재사용 인프라 확보(향후 admin 화면 추가 시 즉시 사용).

**포기한 것 / 미해결:**
- 5-tone은 8-상태 예약 라이프사이클을 다 표현 못 함 → 엔티티 배지(`BookingStatusBadge` 등)는 별도 의미색 컴포넌트로 *이원 존속*(통일 시스템 외부). 다음 작업자가 "왜 어떤 배지는 tone, 어떤 건 엔티티 컴포넌트?"로 혼란할 여지(→ CLAUDE.md 노트로 박제).
- `enum → tone` Record가 동일 enum을 쓰는 2개 파일에 중복 정의되는 경우 존재(예: products 목록/편집의 `JOB_TONE`). 엔티티 레이어 추출 대신 **sync 주석 + typecheck 망라성**으로 drift 방어(추출은 UI 이관 범위 밖 — YAGNI).
- 인증 후 admin 화면의 픽셀 정합성은 자동 검증 불가(이 환경 Playwright 부재) → reviewer 수동 확인 항목으로 남김(런타임 스모크로 500 크래시 0만 확증).

## Alternatives Considered (대안)

### 옵션 A: tone 매핑을 `shared/ui/Badge`가 직접 소유 (Badge가 enum을 앎)
- `<Badge status={booking.status} />`처럼 Badge가 `BookingStatus`→색을 내부에서 해결. 호출부 간결.
- **거부:** `shared`가 도메인 enum을 import → FSD 단방향(`shared`는 최하위, 도메인 무지) 정면 위반. 8개 enum이 `shared`에 결합되어 도메인 변경이 `shared` 변경을 유발. 경계 붕괴 비용이 호출부 간결함을 압도.

### 옵션 B: 엔티티 상태 배지(`BookingStatusBadge` 등)도 5-tone Badge로 일괄 교체
- 모든 상태 배지를 단일 `Badge` tone 시스템으로 통일 → 외형 완전 일관.
- **거부:** 8개 상태(blue/emerald/purple/gray 등 고유색)를 5-tone에 매핑하면 PAID/READY/COMPLETED가 `success` 하나로 뭉개져 at-a-glance 식별성 손실. 게다가 이 컴포넌트는 `(site)`와 공유 → admin 개편이 site 외형을 바꾸는 범위 침범. 정보 보존 > 외형 완전 통일.

### 옵션 C: 의미색까지 전부 토큰화 (예외 없는 토큰화)
- green/yellow/red 상태색도 토큰(`success`를 토큰화 등)으로 흡수해 "토큰만 쓰는" 순수성 달성.
- **거부:** 상태색은 *의미 전달* 매체(신호등). 토큰화하면 브랜드 테마 변경 시 상태 식별이 깨진다. site 개편에서 확립된 "의미색 보존" 정책(포함/불포함 green/red) 계승.

### 옵션 D: `tone`을 `variant`와 별도 prop 축으로 분리
- `<Badge variant="outline" tone="success">`처럼 2축 API.
- **거부(이번 결정에서):** admin 배지는 outline+success 같은 조합 수요가 없음. 단일 `variant` 축에 tone 값을 추가하는 편이 API가 단순하고 기존 4 variant와 일관. YAGNI.

### 옵션 E: 빅뱅 단일 PR
- 17 페이지 + 위젯을 한 번에 이관.
- **거부:** 리뷰 부담 과대, 중간 검증 구간 부재. 5개 섹션 단계적 PR(기반 → 섹션별)이 각 단계 typecheck/build/grep 게이트로 안전.

## Notes

- 본 ADR은 **요청된 2건 중 1건만** 신규 발행한 것이다. "REPORTED status-flip 포기 + report-driven 큐" 결정은 이미 [ADR-0044](./0044-review-report-queue-vs-status-flip.md)(2026-06-09, Phase 15)에 박제되어 있어 중복 발행하지 않음.
- 마일스톤 "일관성 → 문서화 → 알고리즘" 3단계의 1·2단계 산출물(CLAUDE.md §8 로드맵).
- 6개월 뒤 의심 가능 지점:
  - "왜 어떤 상태 배지는 `Badge variant={tone}`이고 어떤 건 `BookingStatusBadge` 엔티티 컴포넌트인가?" → 본 ADR Decision 5 / 옵션 B(8-상태 정보 보존).
  - "`grep 'use client' src/widgets/admin-dashboard/ui/`가 왜 2개가 아니라 4개?" → 차트 리프 2 + 필터 island 2(`DateRangePicker`/`ProductSelect`, router/searchParams 기반). 회귀 가드의 본질은 "*새* server 컴포넌트에 client 미추가"(diff `+use client` 0건). [ADR-0033] 노트 정정(CLAUDE.md 반영).
  - "Button에 `py-3`를 줬는데 안 먹는다?" → 기본 `h-9` 고정과 충돌. 큰 CTA는 `size="lg"`.
