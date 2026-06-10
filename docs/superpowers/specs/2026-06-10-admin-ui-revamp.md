# Admin 셸 A1 클린 블루 UI 개편 — 설계 문서

> **상태**: 승인됨 (2026-06-10)
> **마일스톤**: "일관성 → 문서화 → 알고리즘" 3단계 로드맵의 1단계
> **선행**: `(site)` A1 개편 완료(PR #15, merge `fb95cd6`) — 디자인 시스템 기반(shadcn 프리미티브 8종 + 토큰) 구축 완료

---

## 1. 목표 (Goal)

`(admin)` 셸을 `(site)`와 동일한 **A1 클린 블루** 디자인 시스템으로 통일한다. 직전 UI 개편이 `(site)` 한정이었던 탓에 발생한 시각적 일관성 갭을 메운다.

**핵심 제약 (Non-negotiable):**
- 백엔드·결제·예약·도메인 로직 **0줄 변경**. 순수 프레젠테이션 레이어만 교체.
- `force-dynamic` 캐시 정책 보존(admin 전 페이지 dynamic 유지 — [ADR-0009]/[ADR-0020]).
- FSD 단방향 의존성 무손상 — shared는 도메인 enum을 알지 못한다.
- admin 정보구조(nav 항목·라우팅) 변경 금지 — **스타일만** 교체.

---

## 2. 전략 — 3원칙

### 원칙 1: 무의미 색 → 토큰 (표지판 기둥)
브랜드/구조를 나타내는 무의미 색을 A1 토큰으로 전환한다.

| 레거시 리터럴 | → A1 토큰 |
|---|---|
| `text-red-700` (브랜드 "Nextour Admin") | `text-primary` (클린 블루) |
| `bg-indigo-600` / `bg-indigo-50` (1차 액션) | `Button variant="default"` (primary) / `variant="secondary"` |
| `bg-gray-50` (셸 배경) | `bg-muted` / `bg-background` |
| `border-gray-200` | `border-border` |
| `text-gray-900` / `text-gray-500` | `text-foreground` / `text-muted-foreground` |

### 원칙 2: 의미 색 → 리터럴 보존 (신호등)
**상태를 전달하는 색**은 브랜드 테마와 무관하게 의미를 유지해야 하므로 의도적으로 리터럴로 보존한다. 이는 `(site)`의 포함/불포함 green/red·여권 등록 배지와 동일한 확립된 A1 정책이다.

- `green` = 완료/성공 (PUBLISHED, SUCCEEDED, PAID)
- `yellow` = 대기 (PENDING, DRAFT)
- `blue` = 처리 중 (IN_PROGRESS)
- `red` = 실패 (FAILED)
- `gray` = 중립/보관 (CLOSED, 미해당)

### 원칙 3: red 잔존 위치 한정
red는 다음 두 곳에만 살아남는다:
- **파괴적 액션**: 강제취소·환불·숨김 → `Button variant="destructive"` (= `destructive` 토큰)
- **ADMIN 역할 배지**: 헤더의 권한 표시 pill (의미색 — "주의: 관리자 권한")

---

## 3. 컴포넌트 설계

### 3.1 신설 프리미티브 — `shared/ui/table.tsx` (9번째)
shadcn 표준 Table 조합 프리미티브. 도메인 무지(domain-agnostic)한 순수 프레젠테이션.

```
Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption
```

- cva 없이 토큰 기반 스타일(`border-border`, `bg-muted/50` 헤더, `hover:bg-muted/50` 행).
- 17개 admin 테이블의 SSOT. 기존 수제 `<table>` 마크업을 전부 이 프리미티브로 치환.
- **단위 테스트**: 렌더링 + 토큰 클래스 적용 스냅샷(또는 클래스 존재 확인).

### 3.2 Badge tone 확장 — `shared/ui/badge.tsx`
기존 4 variant(`default/secondary/destructive/outline`)에 **semantic tone** 5종 추가. 도메인 무지한 의미색만 노출.

```ts
// 추가될 tone (의미색 리터럴 — 토큰 아님, 의도적)
success: "border-transparent bg-green-100 text-green-700"
warning: "border-transparent bg-yellow-100 text-yellow-800"
info:    "border-transparent bg-blue-100 text-blue-800"
neutral: "border-transparent bg-gray-100 text-gray-700"
// danger는 기존 destructive variant 재사용 (red 토큰)
```

> ⚠️ tone은 `variant`와 별도 축으로 둘지, `variant`에 합칠지는 구현 시 결정. 권장: 기존 `variant` 축에 tone 값을 추가(단일 축 유지, API 단순). **단위 테스트로 각 tone 클래스 적용 확인.**

### 3.3 도메인 status 매핑 (FSD 경계 수호)
각 admin 페이지/island가 `enum → { label, tone }` 매핑을 보유한다. **shared는 이 매핑을 모른다.**

```ts
// 예: src/app/(admin)/admin/products/page.tsx (기존 STATUS_BADGE 자리)
const PRODUCT_STATUS: Record<ProductStatus, { label: string; tone: BadgeTone }> = {
  DRAFT:     { label: "임시저장", tone: "warning" },
  PUBLISHED: { label: "게시",     tone: "success" },
  CLOSED:    { label: "보관",     tone: "neutral" },
};
// 사용: <Badge variant={PRODUCT_STATUS[status].tone}>{PRODUCT_STATUS[status].label}</Badge>
```

대상 enum: `ProductStatus`, `EmbeddingJobStatus`, `BookingStatus`, `PaymentStatus`, `RefundJobStatus`, `DepartureStatus`, `ReviewStatus`, `DepartureCancellation` 배치 status.

> 🏛️ **Architect 보장**: shared/ui/badge는 tone(success/warning/info/neutral) 추상만 안다. 도메인 enum → tone 결정은 도메인을 아는 레이어(app 페이지/feature island)가 수행 → shared로의 도메인 지식 누출 0, cross-layer 위반 0.

---

## 4. 단계적 롤아웃

### Phase 1 — 기반 구축 (시각 혼재 허용)
페이지를 건드리지 않고 **인프라만** 먼저 구축. 완료 후 레이아웃/nav만 A1, 본문은 레거시인 과도기 상태가 잠시 존재(의도적).

1. `shared/ui/table.tsx` 신설 + 단위 테스트
2. `shared/ui/badge.tsx` tone 확장 + 단위 테스트
3. `(admin)/admin/layout.tsx` A1 토큰화 (헤더·nav·역할 배지·로그아웃)
4. 배럴(`shared/ui` index 또는 직접 경로) 노출 확인
5. 검증: typecheck + test + **build** + grep 경계 가드

### Phase 2 — 페이지 이관 (섹션별, PR 분리)
8개 nav 섹션을 순차 이관. 각 섹션 = 독립 검증 가능 단위.

**권장 순서:**
1. **상품 관리** — `products/{page,new,[id]/edit,[id]/departures/**}` + `ProductForm`/`DepartureForm`/`ItineraryEditor` (폼 비중 최대 → Input/Select/Button 프리미티브 검증)
2. **예약 관리 + 환불 모니터링** — `bookings/{page,[id]}` + `AdminCancelBookingButton`/`DiscretionaryRefundPanel`, `refund-jobs/page`
3. **위약금 정책 / 임베딩 Jobs / 취소 배치** — `penalty-policies` + `PenaltyPolicyForm`, `embedding-jobs`, `departure-cancellations/{page,[id]}` + `ForceCancelButton`
4. **리뷰 관리** — `reviews/{page,[id]}` + `ReviewStatusToggle`/`ReportModerationActions`
5. **대시보드** — `dashboard/page` + `admin-dashboard` 위젯: **토큰 정렬만**(Phase 6에서 이미 정돈, 최소 손질). 차트 리프(`RevenueTrendChart` 등) 색은 의미색이라 보존.

**대상 규모**: 페이지 17 + admin feature islands ~11 + admin-dashboard 위젯. 현재 indigo/red/raw-gray 리터럴 보유 파일 **24개**.

---

## 5. 검증 전략 (QA)

각 Phase 완료 시:
- `npm run typecheck` — 타입 0 에러
- `npm run test` — 신규 프리미티브 단위 테스트 + 회귀
- **`npm run build`** — server-only/배럴/클라경계 회귀는 build로만 발현(메모리 수칙: "server-only/클라경계/배럴 변경은 typecheck+test로 부족")
- **클라 번들 누출 가드**: client island(`'use client'`)이 `@/shared/lib/env`·entities 배럴을 import 안 하는지 grep (실제 사고 이력 있음 — `photoMime.ts` ZodError)
- **Playwright 시각 확인**: admin 로그인(dev 매직링크) → 대시보드 → 상품 → 예약 주요 화면 렌더 회귀

> ⚠️ **dev 서버 가동 중 `npm run build` 금지** (`.next` 충돌 → CSS 404). build는 dev 중단 후 실행.

---

## 6. YAGNI / 비대상 (Out of Scope)

- ❌ 다크모드 (site도 미지원)
- ❌ admin 정보구조(nav 항목·라우팅) 변경 — 스타일만
- ❌ 도메인 로직·Prisma 쿼리·Server Action 변경
- ❌ 캐시 정책 변경 (force-dynamic 유지)
- ❌ admin-dashboard 차트 로직/데이터 (Phase 6 산출물, 토큰 정렬만)

---

## 7. 리스크 & 완화

| 리스크 | 완화 |
|---|---|
| client island이 토큰화 중 entities 배럴/env 누출 → 빌드 깨짐 | Phase별 build 검증 + grep 가드. 신규 import 금지. |
| Badge tone을 variant 단일 축에 합치며 기존 site 사용처 회귀 | tone은 *추가*만(기존 default/secondary/destructive/outline 불변). site 무영향. |
| 과도기(Phase 1 후) 시각 혼재가 사용자 혼란 | 의도된 단계 분리. PR 설명에 명시. admin은 내부 도구라 허용 가능. |
| 의미색을 토큰으로 잘못 전환 → 상태 식별 불가 | 원칙 2 명문화. 리뷰 시 "이 색이 의미를 전달하는가?" 체크. |

---

## 8. 관련 문서

- `(site)` 개편 선례: `docs/superpowers/plans/done/2026-06-09-ui-revamp-a1-clean-blue.md`
- 디자인 토큰: `src/app/globals.css` (`--primary: 219 100% 53%`, `--radius: 0.875rem`)
- 프리미티브: `src/shared/ui/{button,card,input,tabs,badge,select,dropdown-menu,sheet}.tsx`
- FSD 규칙: `CLAUDE.md` §5 Architect
