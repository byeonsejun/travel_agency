# ADR-0053: Next 16 Cache Components 전역 전환 — 2-gate 점진 마이그레이션

- **상태**: Accepted
- **결정일**: 2026-06-12
- **영향 범위**: `next.config.mjs`, `src/app/**`(동적 page 24 + route handler 11), `src/entities/{product,departure,analytics}/api/**`(`unstable_cache` 20곳), `src/features/**/server/actions.ts`(무효화 9곳)
- **관련 commit**: `3f8df71`(P1 캐시 레이어) · `f997a4a`(P2 updateTag 일원화) · `da10bf7`(P3 Gate1 config strip + 누출 봉합) · `66eaed4`(P3 Gate2 Suspense) · `86545cf`(TransactionFallback SSOT)
- **관련 ADR**: [ADR-0052](./0052-next16-upgrade-de-risked.md)(이연 결정 — 본 ADR이 후속), [ADR-0009](./0009-no-real-money-env-invariant.md)/[ADR-0020](./0020-cache-tag-contracts-and-force-dynamic-audit.md)(force-dynamic 안전도메인 정책), [ADR-0035](./0035-route-loading-skeletons-and-global-progress.md)(Phase 7 Suspense 스켈레톤 — 재활용 자산)

## Context (배경)

ADR-0052(Phase 5-B)는 Next 15→16 메이저 범프를 "배선 교체"로 격리하면서, `unstable_cache` → Cache Components(`'use cache'`) 패러다임 전환을 Phase 5-C로 의도적으로 이연했다. 당시 `revalidateTag` 단일인자 9곳만 2-arg(`'max'`)로 임시 호환 패치했다 — 이 `'max'` 워크어라운드는 청산해야 할 부채로 명시됐다.

Phase 5-C 착수 전, 격리 스파이크 브랜치(`spike/phase5c-cache-components`)에서 `cacheComponents: true`만 켜고 `next build`를 반복 실행해 **파괴 표면(blast radius)을 추정이 아닌 실측**으로 확정했다. 핵심 발견 두 가지:

1. **`cacheComponents`는 전역 스위치다.** 라우트별 opt-in 불가 — 켜는 순간 앱 전체가 PPR(정적 셸 + Suspense 동적 스트리밍) 모델로 전환된다. `'use cache'` 지시어 역시 이 플래그가 켜져야만 컴파일된다(부분 도입 불가).

2. **파괴가 2계층이며, 2계층은 1계층에 가려진다(masking).** 단일 빌드로는 전체를 측정할 수 없다:
   - **Gate 1 (컴파일 / Turbopack 정적 분석): 43 에러.** route segment config export 비호환 — `dynamic`×31, `runtime`×10, `revalidate`×2. 빌드가 여기서 즉사해 Gate 2를 가린다.
   - **Gate 2 (prerender / 정적 생성): `Uncached data accessed outside <Suspense>`.** Gate 1을 전부 제거한 뒤에야 노출. 동적 page 24개가 `auth()`/`searchParams`/`cookies()`/uncached `db`를 page-level에서 읽어 실패. 빌드는 첫 prerender 에러에서 중단 → 페이지 단위 반복 해소 필요.

추가로, route handler 11개(webhook/confirm/cron×4/health/csp-report/rum/departures/viewer-context)는 prerender 비대상이라 Gate 1(config strip)만으로 완료되고 Gate 2 작업이 없다. 예상 못 한 항목으로 `runtime = "nodejs"` 핀 10곳도 `cacheComponents`가 거부했다(default가 nodejs이므로 제거 안전).

## Decision (결정)

**4개 조항 — 전역 플래그를 kill-switch로 삼아 격리 브랜치에서 2-gate를 단계 전환한다.**

1. **전역 플래그를 kill-switch로 삼아 단계 전환한다.** `feat/phase5c-cache-components`에서 Phase 1(캐시 레이어)→2(무효화)→3(동적 라우트 Suspense)→4(ISR+전역 검증) 순차 진행. 플래그가 켜진 시점부터 full build는 Phase 3 완료 전까지 의도적으로 red이며, 각 Phase는 typecheck+test로 증분 검증한다(전역 build green은 Phase 4 게이트). 문제 시 플래그만 끄면 즉시 롤백.

2. **안전 도메인(payment/booking/admin)의 "캐시 금지"를 Suspense 격리로 보존한다.** force-dynamic 제거가 곧 "캐시됨"을 의미하지 않는다 — 동적 읽기를 `<Suspense>`로 격리하면 그 부분은 여전히 per-request로 스트리밍된다. 오히려 `cacheComponents`의 strict 빌드는 un-suspended 동적 읽기를 **컴파일 타임에 강제로 에러**로 잡으므로, 결제·예약 상태의 우발적 prerender(stale)를 빌드 게이트가 차단한다 — 안전성 강화로 재해석한다(NO-REAL-MONEY 무손상).

3. **`runtime = "nodejs"` 제거는 default가 nodejs임을 확인 후 일괄 처리한다.** route handler 10곳의 명시적 핀은 cacheComponents가 거부하므로 삭제하되, Edge로 강등되지 않음(Next 16 route handler default = nodejs)을 검증. `middleware.ts`는 별개 — 본 마이그레이션 범위 밖(ADR-0052 유지).

4. **무효화는 same-request 즉시성이 필요한 곳만 `updateTag`, 그 외 `revalidateTag` 유지.** ADR-0052의 `'max'` 워크어라운드를 청산한다. ~~admin 수정→PDP 즉시 반영처럼 같은 요청에서 신선도가 필요한 경로는 `updateTag(tag)`, 백그라운드 stale-while-revalidate로 충분한 경로는 `revalidateTag(tag)`(2-arg 강제 해소).~~ **[2026-06-13 AMENDED — 아래 ⚠️ 참조]** 태그 SSOT(`TAG_PRODUCTS_*`/`tagProductDetail`/`tagDeparturesByProduct`)는 `cacheTag()` 호출로 이식하되 네임스페이스는 무손상(ADR-0020 컨트랙트 유지).

   > ⚠️ **Amendment (2026-06-13, Phase 2 구현 중 실측 정정):** 위 취소선 조항의 "백그라운드는 `revalidateTag(tag)`(1-arg)" 가정은 **사실과 다르다**. Next 16.2.9의 `revalidateTag` 타입 시그니처는 `revalidateTag(tag: string, profile)`로 **2-arg가 강제**다(`node_modules/next/dist/server/web/spec-extension/revalidate.d.ts` 확인). 1-arg 무효화기는 `updateTag(tag)`(Server Action 전용, read-your-writes) 하나뿐이다. 9개 무효화 지점이 전부 Server Action이고 Final Checklist가 `revalidateTag(_, 'max')` **0**을 요구하므로, **9곳 전부 `updateTag(tag)`로 일원화**했다(`updateTag` 6 admin + checkout/booking-cancel 2 + admin-product 4태그). 좌석·가격 무효화는 stale-window 0이 정합성에 최선이라 customer 경로(checkout/booking-cancel)도 `updateTag`가 오히려 우월. 따라서 "백그라운드 `revalidateTag`로 분류" 조항은 **사문화**되었고, 정정된 결정은 "**Server Action 무효화는 `updateTag`로 통일**"이다. 배선은 Phase 2 단위테스트(`updateTag×N` 단언, 1188 green)가 증명. 커밋 `f997a4a`.

```ts
// 전환 패턴 (unstable_cache → use cache)
// Before
export const getProductById = (id: string) =>
  unstable_cache(async () => db.product.findUnique(...),
    [`product-${id}`], { revalidate: 3600, tags: [tagProductDetail(id)] })();
// After
export async function getProductById(id: string) {
  "use cache";
  cacheTag(tagProductDetail(id));   // 태그 SSOT 이식
  cacheLife({ revalidate: 3600 });  // keyParts 불요 — 인자에서 자동 키 생성
  return db.product.findUnique(...);
}
```

## Consequences (결과)

**얻은 것:**
- PPR 스트리밍 — 정적 셸 즉시 페인트 + 동적 부분 스트리밍(현 force-dynamic의 "전부 동적" 대비 TTFB 개선).
- `updateTag` 정식화로 ADR-0052 `'max'` 워크어라운드 부채 청산.
- 결제·예약 상태의 우발적 캐싱이 컴파일 타임에 차단(회귀 방어선이 런타임→빌드로 전진).
- `unstable_cache` 수동 keyParts 관리 제거(인자 기반 자동 키).

**포기한 것 / 미해결:**
- 동적 page 24개의 Suspense 경계 재배치 노동 + prerender 반복 빌드 사이클(첫 에러 중단 특성).
- ISR 2개(home 300s / PDP 3600s)의 의미를 `export const revalidate` → `cacheLife`로 재정의.
- 플래그 ON 이후 Phase 3 완료 전까지 full build red — 증분 검증은 typecheck+test에 의존.
- `middleware.ts` deprecation 경고 잔존(ADR-0052 유지, proxy 전환은 별도 에픽).

## Alternatives Considered (대안)

### 옵션 A: 전체 Cache Components 전환 (채택)
- force-dynamic 31 + runtime 10 + revalidate 2 + unstable_cache 20을 모두 전환. PPR + updateTag 정식화의 풀 가치.
- 채택 이유: 부분 전환이 **구조적으로 불가능**(use cache가 전역 플래그에 게이트됨). 어차피 플래그를 켜야 하면 절반만 전환한 상태가 오히려 부채.

### 옵션 B: 캐시 래퍼 + ISR만 전환, force-dynamic 동적 유지
- `unstable_cache` 20 + ISR 2만 `use cache`로, 안전 도메인은 force-dynamic 유지.
- 기각 이유: **불가능.** `cacheComponents: true`가 `dynamic`/`runtime`/`revalidate` config export 자체를 컴파일 에러로 거부(Gate 1 실측). 플래그를 켜는 순간 force-dynamic 라우트도 반드시 Suspense로 전환해야 한다 — "동적 유지"가 config로는 표현 불가.

### 옵션 C: Phase 5-C 추가 이연
- 현행 `unstable_cache` + `'max'` 워크어라운드 유지.
- 기각 이유: `'max'` 부채가 무기한 지속되고, RUM baseline(ADR-0051)으로 확보한 성능 측정 기반을 PPR로 활용할 기회를 상실. 마일스톤 로드맵상 더 미룰 명분 없음.

## Notes

- **2-gate masking은 6개월 뒤 재현 시 혼란 1순위 후보.** "config 다 지웠는데 또 깨진다"가 정상 — Gate 1(43 config) 제거가 Gate 2(24 페이지 Suspense)를 비로소 노출시킨다. 단일 빌드 = 빙산의 일각.
- 모니터링 지표: PPR 전환 후 home/PDP TTFB·LCP(RUM 파이프라인 ADR-0051로 측정), admin→PDP 무효화 즉시성(updateTag 회귀).
- route handler 11곳은 Gate 1만 — Suspense 작업 0건임을 plan에 명시(과잉 작업 방지).
- 테스트 영향: `cacheTag`/`cacheLife`는 `'use cache'` 스코프 밖(vitest)에서 호출 시 throw 가능 — 데이터 레이어 직접 단위테스트가 있으면 `next/cache` 모킹 필요(Phase 1에서 확인).
- **Gate 1.5 — 잠복 누출(빌드만 포착, typecheck/test 통과):** `cacheComponents` 첫 빌드가 Phase 1의 잠복 회귀를 드러냄 — client island이 `use cache`를 품은 entity 배럴을 **value import**하면 서버 그래프가 client 번들로 compile돼 `"use cache" in Client Components` 에러. 봉합 3종: (a) 직렬화 가능 상수는 **서버부모가 prop 주입**(`LiveDepartureList.badgeThreshold`, `DateRangePicker.presets`), (b) **non-serializable(접근자 함수) 프레젠테이션은 feature로 이관**(`DRILLDOWN_COLUMNS`→`features/admin-dashboard-drilldown/model/drilldownColumns.ts`), (c) client는 `import type`만. 교훈: server/client 경계·배럴 변경은 `npm run build` 필수(typecheck+test 불충분).
- **24 동적 page의 실제 격리는 "차단원(choke point) 우선"으로 최소화:** admin 16곳은 layout의 top-level `auth()`가 공통 차단원 → `(admin)/admin/layout.tsx` 단일 Suspense(가드+nav+children 동봉)로 16곳 동시 해소. 전 (site) 페이지는 `(site)/layout.tsx`의 `WebVitalsReporter`(`usePathname()`)가 공통 차단원 → `<Suspense fallback={null}>` 1줄로 해소. 페이지별 Suspense는 결제·예약·login·compare에만.
- **PPR redirect 뉘앙스(런타임 스모크 실측):** 인증 가드가 Suspense 자식 안에서 발화하면 응답이 **307이 아니라 200 + 스트리밍 redirect**로 나올 수 있다(shell이 먼저 flush). 단 본문엔 skeleton + `/login` redirect만 있고 보호 페이로드(결제폼·clientKey)는 **0 누출**(`.next` 셸 grep + dev 런타임 양쪽 실증). 보안 동일.
- **dev는 `use cache` 우회:** `next dev`는 매 요청 캐시 함수 재실행(open-kitchen) → 캐시 hit·`updateTag` 무효화는 **prod-only 관측**. dev에서 "캐시 hit 안 보임"은 정상. 무효화 배선은 Phase 2 단위테스트로 증명.

### 운영 메모 — 프로덕션 디버깅 후속 (2026-06)

> 아래 두 항목은 본 ADR의 결정을 바꾸지 않는다. Cache Components 운영 중 비싸게 배운 교훈을 보강한다.

- **서버리스 DB 커넥션은 `connection_limit=1`이 정답 (Vercel + Supabase 풀러):** prod `DATABASE_URL`은 Supabase 트랜잭션 풀러(`:6543` + `?pgbouncer=true`)를 경유하며 **`connection_limit=1`** 을 명시한다 — 서버리스 인스턴스마다 커넥션을 1개만 잡아 free 플랜 풀러 고갈을 막는다. 배경: `connection_limit=10`이면 **단일 페이지의 RSC fan-out(여러 `use cache`/쿼리)** 이 다중 서버리스 호출 × 10 커넥션으로 풀러를 고갈시켜 **매직링크 발송 지연·`/mypage` Server Component 에러·`POST /api/rum` 500이 동시 발생**했다(전부 `P2024` 커넥션 풀 타임아웃의 다른 얼굴). 코드는 in-code 풀링이 없고(`shared/lib/db.ts`) 이 값을 전적으로 `DATABASE_URL`에 위임하므로, prod DB 증상의 1순위 점검 대상은 **풀러 경유 + `connection_limit=1`** 여부다.
- **빌드 prerender 0 + 전량 on-demand는 `generateStaticParams` *제거*로 (≠ `return []`):** 라우트를 빌드 표본 없이 순수 on-demand로 두려면 `generateStaticParams`를 **빈 배열로 두지 말고 함수 자체를 제거**한다. `return []`은 Cache Components가 **`EmptyGenerateStaticParamsError`로 거부**한다("빌드 검증 표본이 0이라 동적 누출을 검증할 수 없음" — `npm run build`에서만 포착, typecheck/lint는 통과). 함수 부재는 "빌드 표본 불필요, 순수 on-demand"로 해석돼 통과하며, `dynamicParams` 기본 `true`라 첫 요청 시 `◐`(PPR) 셸을 생성·캐시한다. 실사례: PDP(`/products/[id]`)가 `generateStaticParams`로 **전체 PUBLISHED 상품을 빌드 prerender**하며 페이지당 2쿼리(`product.findUnique` + `departure.findMany`)를 `connection_limit=1`에 동시 투입 → 빌드가 `P2024`로 실패 → **함수 제거로 해소**(커밋 `d5f7f51`). 교훈: 빌드 prerender 정책 변경은 `npm run build`로만 검증된다(앞의 Gate 1.5와 동일 계열).
