---
name: enforce-fsd
description: Feature-Sliced Design의 단방향 의존성, 공개 API(barrel) 규칙, 레이어별 책임 분리를 강제하는 리뷰어 스킬. Nextour 모든 코드 작성·리뷰 시 항상 적용한다.
---

# Enforce FSD

## Objective
Nextour FSD 레이어링을 침범하는 코드를 차단한다. 의존성 방향은 단 하나만 허용:

`app → widgets → features → entities → shared`

상위 → 하위만 가능. 같은 레이어 내 cross-slice 참조도 원칙적으로 금지(같은 entity끼리, 같은 widget끼리 import 불가).

## Rules

### R1. 의존성 방향
- `entities/product`는 `entities/departure`, `widgets/*`, `features/*`, `app/*`을 import할 수 없다.
- `widgets/product-detail`는 `widgets/product-card-list`를 import할 수 없다.
- `shared/*`는 어떤 프로젝트 도메인도 import할 수 없다(도메인 무지).

### R2. 공개 API (Barrel)
- 외부 import는 반드시 `@/entities/{name}` 또는 `@/widgets/{name}` 경로(barrel `index.ts`).
- `@/entities/product/ui/ProductCard` 같은 깊은 경로 import 금지.
- 같은 slice 내부(예: entity 내 api/ui 상호 참조)는 상대경로 허용.

### R3. 레이어별 책임
- `entities/{name}/model/` — 타입·상수만. 비즈니스 로직 금지.
- `entities/{name}/api/` — Prisma 호출과 순수 함수. UI 의존 금지.
- `entities/{name}/ui/` — RSC 호환 프레젠테이션. `'use client'` 금지.
- `widgets/` — entity UI 조합. 직접 Prisma 호출 금지(page에서 호출 → props 주입).
- `features/` — 사용자 인터랙션 단위(출발일 선택, 결제 진행). `'use client'` 허용.
- `app/` — 라우팅·페이지·에러바운더리만. 비즈니스 로직 금지.

### R4. 클라이언트 경계
- `'use client'`는 features 또는 widget의 인터랙티브 컴포넌트에만.
- entity UI에 `'use client'`가 들어가면 import하는 모든 RSC 트리가 클라이언트로 전환되므로 절대 금지.

## Anti-patterns

| 패턴 | 문제 | 해결 |
|------|------|------|
| `import { ProductCard } from '@/entities/product/ui/ProductCard'` | 깊은 경로 | `from '@/entities/product'` |
| `entities/product`가 `widgets/...` import | 역방향 의존성 | 로직을 entity api로 이동 또는 feature로 재구성 |
| `widgets/product-detail`가 `widgets/booking-form` import | 동일 레이어 cross-import | 공통 로직을 entity 추출 또는 page에서 조합 |
| `entities/product/ui/ProductCard.tsx`에 `'use client'` | RSC 트리 오염 | 인터랙션은 widget/feature로 분리 |
| `app/(site)/products/page.tsx`에 30줄짜리 비즈니스 로직 | app 비대화 | `entities/*/api/` 또는 `features/*`로 이동 |
| `shared/ui/SortSelect`가 `ProductListParams` 의존 | shared가 도메인 의존 | 옵션을 props로 받도록 일반화 |

## Action (Output Format)

```
## FSD Violations

### [Critical] R1 - 의존성 역방향
- file: src/entities/product/api/queries.ts:42
- problem: import { formatPrice } from '@/widgets/product-card-list/lib/format'
- fix: formatPrice를 shared/lib/format.ts로 이동

### [Major] R2 - Barrel 우회
- file: src/app/(site)/products/page.tsx:8
- problem: '@/widgets/product-card-list/ui/ProductCardList' 깊은 import
- fix: '@/widgets/product-card-list'

### [Minor] R3 - 책임 오용
- file: src/widgets/product-detail/ui/ProductDetail.tsx:55
- problem: 위젯 내부에서 db.product.findUnique 직접 호출
- fix: page에서 호출 후 props 주입
```

위반 0건이면 `✅ FSD 컴플라이언스 통과`만 출력.
