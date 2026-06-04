# ADR-0033: 대시보드 차트 라이브러리로 Recharts 채택 + `'use client'` 리프 격리

- **상태**: Accepted
- **결정일**: 2026-06-04
- **영향 범위**: `src/widgets/admin-dashboard/ui/RevenueTrendChart.tsx`, `src/widgets/admin-dashboard/ui/BookingStatusDonut.tsx`, `package.json`
- **관련 commit**: `89af54d` (recharts 추가), `c7d176c` (BarChart 리프), `73a8129` (PieChart 리프)

## Context (배경)

Phase 6 대시보드는 매출 추이(막대)와 예약 상태 분포(도넛) 2종 차트가 필요하다. 저장소에 차트 라이브러리가
없어 신규 런타임 의존성을 1건 도입해야 했다. 제약 조건:

- **Next.js 15 App Router + React 19** 환경. 페이지는 RSC 우선이고 집계는 서버에서 끝난다.
- 차트 라이브러리는 대부분 `window`/`ResizeObserver`/`<canvas>` ref에 의존 → **클라이언트 전용**.
- 무거운 집계 SQL이 브라우저 번들로 새면 안 되고, 차트 번들이 대시보드 외 페이지로 퍼지면 안 된다.
- Tailwind 기반 디자인 시스템과 충돌 없어야 한다.

## Decision (결정)

**Recharts 채택**(`recharts@^2.15.4`). 차트는 **`'use client'` 리프 컴포넌트로만 격리**하고, 서버가 집계한
plain 배열을 props로 주입한다:

```tsx
// widgets/admin-dashboard/ui/RevenueTrendChart.tsx
"use client";
import { Bar, BarChart, ResponsiveContainer, ... } from "recharts";
import type { RevenueTrendPoint } from "@/entities/analytics";

// 차트는 window/ResizeObserver 의존 → 클라이언트 리프로 격리.
// 집계(서버)된 plain 배열만 props로 받는다. DB·env import 없음.
export function RevenueTrendChart({ data }: { data: RevenueTrendPoint[] }) { ... }
```

- 페칭/집계 = 서버(RSC `Promise.all`), 렌더 = 클라이언트(Recharts). `AdminDashboard`(server)가 두 리프를 조합.
- `'use client'`는 **차트 2개 파일에만**. KPI 카드·기간 필터·조립 컴포넌트는 전부 서버 컴포넌트.
- 결과: 집계 SQL·`db`·`env`가 브라우저로 누출 0, recharts 번들은 대시보드 라우트에만 코드 분할.

## Consequences (결과)

**얻은 것:**
- SVG 기반이라 Tailwind와 충돌 없고, React 19 선언형 컴포넌트 모델과 자연스럽게 맞음(`<BarChart><Bar/></BarChart>`).
- tree-shakeable — 사용한 컴포넌트(Bar/Pie/Tooltip 등)만 번들에 포함.
- 자체 TypeScript 타입 번들 — `@types/*` 불요, strict 환경에서 `formatter` 콜백까지 타입 안전.
- 서버/클라이언트 경계가 파일 단위로 명확 — `grep "use client"`로 누수 회귀를 1초에 검증 가능.

**포기한 것 / 미해결:**
- 차트는 클라이언트 렌더라 초기 페인트에 JS 실행 필요(SSR 차트 정적 이미지는 미지원). admin 내부 화면이라 수용.
- Recharts 2.x는 React 19에서 동작하나 공식 19 지원 명시는 버전에 따라 다를 수 있음 — 업그레이드 시 회귀 확인 필요.

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: Chart.js (+ react-chartjs-2)
- 성숙하고 인기 높은 라이브러리.
- **거부 이유**: `<canvas>` 기반 — ref 수동 배선과 명령형 라이프사이클이 필요하고, React 19/RSC 선언형 모델과
  궁합이 떨어진다. canvas는 Tailwind 스타일링·접근성·반응형 컨테이너 처리도 더 번거롭다.

### 옵션 B: visx (Airbnb)
- D3 위의 저수준 프리미티브 — 최대 유연성.
- **거부 이유**: KPI 막대/도넛 2종에는 과설계. 축·스케일·툴팁을 직접 조립해야 해 구현·유지 비용이 크다.
  YAGNI — 단순 차트에 D3 수준 제어가 불필요.

### 옵션 C: Tremor
- 대시보드 특화 + Tailwind 네이티브 컴포넌트 키트.
- **거부 이유**: 자체 Tailwind preset·디자인 토큰을 강제해 기존 디자인 시스템과 충돌 위험. 또 차트뿐 아니라
  레이아웃 컴포넌트까지 끌고 들어와 의존성 표면이 넓다. 우리는 차트 프리미티브만 필요.

## Notes

- 새 차트 추가 시 동일 패턴: `'use client'` 리프 + 서버 집계 props 주입. 절대 차트에서 `db`/`env`를 import하지 말 것.
- Tooltip/tickFormatter 콜백은 strict에서 명시 타입(`(value: number, name: string)`)으로 통과 — `any` 불요.
- 6개월 뒤 의심받을 부분: "왜 Tremor 같은 대시보드 키트를 안 썼지?" → 디자인 시스템 충돌 + 의존성 표면.
  차트 프리미티브만 가져오는 Recharts가 결합도 최소. PPR/RSC 차트가 안정화되면 재논의 여지 있음.
