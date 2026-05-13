# Nextour — Agent Operating Manual

> AI 기반 맞춤형 패키지 여행 플랫폼. Next.js 15 App Router + FSD(Feature-Sliced Design).
> 이 문서는 **이 저장소에서 작업하는 모든 AI 에이전트(Claude Code, Cursor 등)** 를 위한 라우팅·운영 지침이다. 사용자 지시와 충돌하면 사용자 지시가 우선.

---

## 1. 기술 스택 (요약)

- **Framework**: Next.js 15 (App Router), TypeScript strict
- **Data**: Prisma 5 + PostgreSQL
- **UI**: Tailwind CSS, RSC 우선
- **Validation**: Zod 3 (외부 입력 파싱 표준)
- **Test**: Vitest 2 + TDD
- **Architecture**: FSD — `app → widgets → features → entities → shared` (단방향)

## 2. 프로젝트 구조

```
src/
  app/        # 라우팅·페이지·layout·error/not-found. 비즈니스 로직 금지.
  widgets/    # entity UI 조합. 직접 DB 호출 금지.
  features/   # 사용자 인터랙션 단위 (예: checkout, search). 'use client' 허용.
  entities/   # 도메인 모듈 (product, departure, booking…). model/api/ui.
  shared/     # 도메인 무지 유틸·UI·db client.
docs/superpowers/
  skills/     # ↓ 아래 스킬 라우팅 표 참조
  plans/      # 실행 가능한 구현 계획 (체크박스 단위)
  specs/      # 설계 문서
prisma/       # schema.prisma, seed.ts
```

---

## 3. 스킬 라우팅 — 언제 어떤 스킬을 적용할 것인가

`docs/superpowers/skills/` 아래의 3개 스킬은 **상황 기반으로 자동 적용**된다. 매 작업 시작 전, 아래 매트릭스에서 해당하는 스킬을 식별하고 해당 파일을 읽어 규칙을 컨텍스트에 로드한다.

### 3.1 스킬 적용 매트릭스

| 작업 유형 | enforce-fsd | clean-code-react | booking-transaction-safety |
|-----------|:-----------:|:----------------:|:--------------------------:|
| `src/**/*.ts(x)` 신규 작성 | **필수** | **필수** | 도메인이 booking/payment면 필수 |
| `src/**/*.ts(x)` 수정/리팩터 | **필수** | **필수** | 같은 도메인 한정 |
| 새 entity/widget/feature slice 생성 | **필수** | 필수 | — |
| Prisma 스키마 변경 | 권장(공개 API 영향 확인) | 필수(타입 안전성) | booking/payment 모델이면 **필수** |
| `app/**/page.tsx`·`layout.tsx` | **필수** | **필수** | — |
| `app/api/**` route handler | 필수 | 필수 | 결제·예약 API면 **필수** |
| 코드 리뷰 / PR review | **필수** | **필수** | 해당 도메인이면 필수 |
| 시드·테스트 데이터 | 권장 | 권장 | — |
| 문서·plan·spec 작성 | — | — | — |

### 3.2 라우팅 트리거 (키워드 기반 자동 감지)

작업 요청이나 변경 파일 경로에 아래 키워드가 보이면 즉시 해당 스킬을 로드한다.

- **enforce-fsd 트리거**: `entities/`, `widgets/`, `features/`, `shared/`, `index.ts` (barrel), `import`, "레이어", "의존성", "import 경로"
- **clean-code-react 트리거**: `'use client'`, `useEffect`, `searchParams`, `params`, `next/image`, `Promise.all`, `force-dynamic`, `any`, `as`, "N+1", "RSC"
- **booking-transaction-safety 트리거**: `booking`, `payment`, `checkout`, `departure.bookedSeats`, `webhook`, `$transaction`, `refund`, `idempotent`, `status` 전이, 가격·금액 컬럼

### 3.3 적용 순서

여러 스킬이 동시에 적용될 때는 다음 순서로 검토한다 (도메인 → 아키텍처 → 코드 품질):

1. **booking-transaction-safety** (해당 도메인이면) — 안전성은 협상 불가
2. **enforce-fsd** — 레이어가 잘못되면 이후 클린업이 광범위해짐
3. **clean-code-react** — 위 둘이 잡힌 후 마이크로 레벨 품질

리뷰 결과 출력 형식은 각 스킬의 `Action` 섹션을 따른다. **위반 0건이면 해당 스킬의 통과 메시지(`✅ ... 통과`)를 명시적으로 출력**한다 — 침묵은 검토하지 않은 것과 구분되지 않는다.

---

## 4. 작업 흐름 (Universal Workflow)

모든 변경 작업은 다음 순서를 따른다:

1. **컨텍스트 파악** — 관련 파일 읽기, `MEMORY.md` 인덱스 확인, 관련 plan/spec 확인.
2. **스킬 로드** — 3.1 매트릭스로 적용 스킬 식별 후 해당 `docs/superpowers/skills/*.md` 읽기.
3. **TDD 우선** — 순수 함수·비즈니스 로직은 테스트 먼저 작성 → FAIL 확인 → 구현 → PASS 확인.
4. **타입 검증** — 변경 후 `npm run typecheck` 통과 필수.
5. **테스트 실행** — `npm run test` 통과 필수.
6. **스킬 셀프 리뷰** — 본인이 작성한 코드에 대해 적용 스킬의 Anti-patterns 자가 점검.
7. **체크박스 갱신** — plan 파일의 해당 태스크 항목을 즉시 `[x]` 처리.
8. **커밋** — Conventional Commits 형식 (`feat(scope): ...`, `fix(...): ...`).

---

## 5. 절대 규칙 (Non-negotiable)

위반 시 즉시 작업 중단하고 사용자 확인 요청.

- ❌ `entities/`, `widgets/`, `shared/`의 깊은 경로 import (`@/entities/product/ui/...`).
- ❌ `entities/**/ui/*.tsx`에 `'use client'` 추가.
- ❌ `app/**/page.tsx`에 `'use client'` 선언 (인터랙션은 child client component로 분리).
- ❌ 클라이언트 컴포넌트에서 `db`(Prisma) import.
- ❌ `any`, `as any`, `@ts-ignore`, `@ts-expect-error` 사용.
- ❌ 좌석·결제 도메인에서 `findUnique → 검사 → update` (TOCTOU). 반드시 `updateMany` 조건부 차감.
- ❌ 가격·금액을 `number`(float)로 표현. 정수(원 단위) 또는 `Decimal`만 허용.
- ❌ 결제 웹훅에서 멱등성 키(`providerEventId`) 검사 없이 처리.
- ❌ booking status 직접 할당 (반드시 `assertTransition` 통과 후 update).
- ❌ 순수 함수 내부에서 입력 배열 변이 (`arr.sort()` 직접 호출). `[...arr].sort()` 또는 `.toSorted()`.
- ❌ 사용자 명시 요청 없이 force push, `git reset --hard`, `--no-verify`, 브랜치 삭제.

## 6. 권장 패턴

- ✅ 모든 페이지 RSC 기본, `export const dynamic = "force-dynamic"` (Phase 2에서 캐시 튜닝).
- ✅ 외부 입력은 Zod로 파싱, 폴백은 `.catch()`.
- ✅ 독립 쿼리는 `Promise.all` 병렬화.
- ✅ 복잡 정렬·집계는 `db.$queryRaw` + `Prisma.sql` 태그드 템플릿 (SQL 인젝션 차단 + N+1 회피).
- ✅ 외부 이미지는 `next.config.mjs`의 `remotePatterns` 등록 후 `next/image`.
- ✅ Prisma 변경 시 마이그레이션 + seed 영향 동시 검토.

---

## 7. 커뮤니케이션

- **사용자 응답 언어**: 한국어 (기본).
- **코드·주석**: 한국어 주석 허용, 식별자는 영문.
- **커밋 메시지**: 영문 Conventional Commits.
- **plan/spec 문서**: 한국어 본문 + 영문 식별자.

## 8. 기억해야 할 컨텍스트

- 현재 Phase 1(Product 표시 모듈) 완료. Phase 2(예약/결제 + AI 검색) 진입 예정.
- 모든 페이지가 `force-dynamic` 상태 — Phase 2 후반에 도메인별 캐시 튜닝 PR로 분리.
- 시드 데이터는 `prisma/seed.ts`. 검증용 10개 상품(JP/VN/TH/EU/ID/PH).
- 자세한 진행 상황은 `docs/superpowers/plans/done/`의 완료된 plan 참조.

---

## 9. 참고 문서

- 스킬: `docs/superpowers/skills/{enforce-fsd,clean-code-react,booking-transaction-safety}.md`
- 계획: `docs/superpowers/plans/`
- 설계: `docs/superpowers/specs/`
- Prisma: `prisma/schema.prisma`, `prisma/seed.ts`
