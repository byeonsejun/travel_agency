---
name: clean-code-react
description: Next.js 15 App Router(RSC) + TypeScript 환경의 성능·타입 안전성 가이드. 'use client' 남용, N+1, 타입 우회, 배열 변이를 차단한다.
---

# Clean Code React (Next.js 15 RSC)

## Objective
Nextour 모든 페이지는 기본 RSC. 클라이언트 번들 최소화, 데이터 페칭 단순화, 런타임 안전성 확보를 목표로 한다.

## Rules

### R1. 서버/클라이언트 경계
- 페이지(`app/**/page.tsx`)는 RSC 기본. `'use client'` 선언 금지.
- 클라이언트 컴포넌트는 다음이 반드시 필요할 때만:
  - `useState`/`useReducer`/`useEffect`
  - 브라우저 API(`window`, `localStorage`)
  - 이벤트 핸들러(`onClick`, `onChange` 등)
  - 클라이언트 전용 라이브러리(react-hook-form 등)
- 클라이언트 컴포넌트는 트리 leaf로 격리. RSC가 client component를 children으로 받는 패턴 권장.

### R2. Next.js 15 비동기 API
`params`, `searchParams`, `cookies()`, `headers()`는 **Promise**다. 반드시 `await`.

```tsx
// ✅
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
}
// ❌
export default function Page({ params }: { params: { id: string } }) { ... }
```

`useSearchParams()`를 쓰는 클라이언트 컴포넌트는 반드시 `<Suspense>`로 감싼다.

### R3. 데이터 페칭
- RSC에서 직접 `async/await` + Prisma. `useEffect` 페칭 금지.
- 독립 쿼리는 `Promise.all`로 병렬화.
  ```tsx
  const [product, departures] = await Promise.all([
    getProductById(id),
    getDeparturesByProduct(id),
  ]);
  ```
- N+1 금지: 리스트 항목당 추가 쿼리 발생 시 `include` 또는 `$queryRaw`로 단일 쿼리화.
- `db`(Prisma) import는 RSC/서버함수에서만. 클라이언트 컴포넌트에서 import 시 빌드 실패.

### R4. 타입 안전성
- `any`, `as any`, `@ts-ignore`, `@ts-expect-error` 금지. 불가피하면 PR 설명에 사유 명시.
- 외부 데이터(searchParams, fetch 응답, env)는 **zod**로 파싱 후 사용. 파싱 실패 폴백은 `.catch()`.
- 타입 별칭은 `type`, 확장 가능한 contract는 `interface`.
- 제네릭은 의미 있는 이름(`TProduct`, `TParams`). 단일 문자는 트리비얼한 경우만.

### R5. 순수 함수와 불변성
- 배열 변이 메서드(`sort`, `reverse`, `splice`, `push`)를 순수 함수 내부에서 직접 사용 금지.
  ```ts
  // ✅
  return [...items].sort((a, b) => a.price - b.price);
  return items.toSorted((a, b) => a.price - b.price);
  // ❌
  items.sort(...); return items;
  ```
- 객체 변이도 마찬가지: 스프레드 또는 `structuredClone` 사용.

### R6. 이미지·번들
- 외부 이미지는 `next.config.mjs`의 `remotePatterns` 등록 후 `next/image` 사용.
- `<Image>`에 `width`/`height` 또는 `fill` + `sizes` 필수.
- `priority`는 LCP 후보(viewport 최상단)에만.

### R7. 캐시 정책
- 현재 모든 페이지 `export const dynamic = "force-dynamic"`. Phase 2에서 도메인별 튜닝.
- 새 페이지 추가 시도 일단 `force-dynamic` 유지. 캐시 결정은 별도 PR.

## Anti-patterns

| 패턴 | 문제 | 해결 |
|------|------|------|
| `'use client'` 페이지 전체 | 전체 트리 클라이언트화, useEffect 페칭 의존 | RSC로 변환, 인터랙션만 child client로 분리 |
| `useEffect(() => fetch('/api/products'))` | 워터폴, 로딩 처리 복잡 | RSC에서 `await getProducts()` |
| `searchParams.sort` 직접 접근 (Next 15) | Promise에 `.sort` 접근 → 런타임 오류 | `const { sort } = await searchParams` |
| `for (p of products) { await getDepartures(p.id) }` | N+1 | `$queryRaw` join, 또는 `IN (...)` 후 메모리 그룹화 |
| `const data = res as ApiResponse` | 런타임 검증 없는 단언 | `ApiResponseSchema.parse(res)` |
| `items.sort((a,b) => ...)` (props 배열) | 호출자 배열 변이 | `[...items].sort(...)` |
| `<img src="...">` | 최적화 불가, LCP 저하 | `<Image>` + remotePatterns |

## Action (Output Format)

```
## Clean Code Review

### [Critical] R3 - N+1 쿼리
- file: src/entities/product/api/queries.ts:78
- code: for (const p of products) { p.departures = await db.departure.findMany(...) }
- impact: 상품 100건 → 쿼리 101회
- fix: $queryRaw로 단일 join, 또는 productId IN (...) 후 메모리 그룹화

### [Major] R2 - Next.js 15 비동기 params 미적용
- file: src/app/(site)/products/[id]/page.tsx:14
- problem: params.id 직접 접근 (await 누락)
- fix: const { id } = await params;

### [Minor] R5 - 입력 배열 변이
- file: src/entities/product/api/mapping.ts:23
- problem: departures.sort((a, b) => a.priceAdult - b.priceAdult)
- fix: [...departures].sort(...) 또는 .toSorted(...)
```

위반 없으면 `✅ Clean Code 통과`.
