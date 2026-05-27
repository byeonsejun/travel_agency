# ADR-0020: 캐시 무효화 컨트랙트 + force-dynamic audit (Phase 3 B1)

- **상태**: Accepted
- **결정일**: 2026-05-27
- **영향 범위**: `src/entities/product/api/queries.ts`, `src/entities/product/index.ts`, `src/app/(site)/products/page.tsx`, `src/app/(site)/compare/page.tsx`, `src/app/api/compare/products/route.ts`
- **관련 commit**: `04c4114`, `27d7bc1`, `8658a6e`, `c722f83`, `3ea0498`

## Context (배경)

Phase 3 진입 시점(2026-05-27)에 코드베이스에 남은 `force-dynamic` 들이 *의도된* 결정인지, 정리할 수 있는 보일러플레이트인지 audit이 필요했다. Phase 2(ADR-0012/0015/0017/0018)에서 PDP와 홈을 ISR로 승격한 직후라 "force-dynamic 일괄 가정"이 더 이상 유효하지 않다.

16 페이지 + 10 API route 스캔 결과: 모든 잔존 `force-dynamic`이 NO-REAL-MONEY([ADR-0009]) / per-user / 운영 즉시성 등 의도된 사유로 유지 — 제거 후보 0건.

진짜 cache 윈은 데이터 레이어였다. `entities/product/api/queries.ts`의 3개 함수(`getProductList` / `getDistinctDestinations` / `getProductsByIds`)가 `unstable_cache` wrap 없이 매 요청 DB hit를 발생시키고 있었다. 특히 `/products`와 `/compare`의 hotspot이었으며, `getDistinctDestinations`는 `groupBy` 비용을, `getProductsByIds`는 배치 조회를 반복하고 있었다.

## Decision (결정)

3-part 결정:

1. **force-dynamic 일괄 유지** — 16 페이지 + 10 API route의 `force-dynamic` declaration 0건 제거. 각 declaration이 명시적 의도(payment/booking 안전성, per-user, operational immediacy)의 코드 박제.

2. **데이터 레이어 unstable_cache 확장** — 3개 함수에 `unstable_cache` 적용:
   - `getDistinctDestinations`: 1h TTL, `TAG_DESTINATIONS_LIST` 단일 태그
   - `getProductList`: 5min TTL, `TAG_PRODUCTS_LIST` 단일 태그 (outer/inner closure로 params 정규화)
   - `getProductsByIds`: 1h TTL, **per-id fan-out 태그** `ids.map(tagProductDetail)`

3. **per-id fan-out 태그 패턴 채택** — `getProductsByIds`의 cache 엔트리가 자기가 담은 모든 product id의 `tagProductDetail(id)` 태그를 부여. `tagProductDetail`은 `getProductById`와 같은 namespace 공유. 결과: admin product CMS가 `revalidateTag(tagProductDetail("X"))` 단 1회 호출로 PDP 캐시 + X가 포함된 모든 비교 캐시 엔트리가 동시 무효화된다.

```ts
// getProductsByIds — per-id tag fan-out
return unstable_cache(
  async (idsKey: string[]) => { /* findMany + sort preserve */ },
  ["products-by-ids"],
  { revalidate: 3600, tags: ids.map(tagProductDetail) }
)(ids);
```

## Consequences (결과)

**얻은 것:**
- `/products` 리스팅의 (sort, page, destinationCode) 조합별 DB hit 5min 압축
- `/compare` + `/api/compare/products`의 동일 ids 조합 재방문 DB hit 1h 압축
- `getDistinctDestinations`의 groupBy 비용 1h 압축
- 무효화 컨트랙트가 `entities/product/index.ts` JSDoc 표로 박제 — 미래 admin product CMS 작업자가 IDE hover만으로 어떤 mutation에서 어떤 태그를 bust해야 하는지 즉시 파악 가능
- `TAG_PRODUCTS_FEATURED` visibility 정렬 (private → public) — 5개 태그 모두 동등 노출

**포기한 것 / 미해결:**
- 현재 새 태그(`TAG_PRODUCTS_LIST`, `TAG_DESTINATIONS_LIST`, `TAG_PRODUCTS_FEATURED`)의 mutation 발신처 0건 — TTL fallback(5min / 1h / 5min)만이 유일한 invalidation 경로. 미래 admin product CMS PR에서 wiring 필요.
- `getProductList`의 inner가 `today = new Date()`를 매 cache miss 시 재계산 → cache HIT 동안에는 첫 today가 재사용되어 자정 경계에서 최대 5min stale. 영향 미미하나 의식적 trade-off.
- `force-dynamic` declaration들을 implicit dynamism(`auth()` / `searchParams`)에 의존하지 않고 **명시적**으로 유지 — 라인 수 cost는 있으나 미래 작업자가 auth()를 제거하는 회귀에 대한 defense-in-depth.

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: per-user 페이지의 explicit force-dynamic 제거 (mypage, reviews/new, bookings/*)

- **어떤 방식이었나**: `auth()` 호출이 implicit dynamism을 유발하므로 `export const dynamic = "force-dynamic"` 라인이 중복. 제거하면 코드가 더 간결해진다.
- **왜 안 골랐나**: 미래 누군가 `auth()` 호출을 다른 곳으로 옮기거나 client island화 하면(ADR-0018처럼) 페이지가 의도치 않게 ISR/static으로 떨어진다. 결제·예약 인접 페이지가 stale 캐시로 사용자 혼란을 야기할 수 있다. defense-in-depth 명목으로 explicit 유지가 안전하다. NO-REAL-MONEY([ADR-0009])는 이런 안전 마진을 협상 불가 영역으로 본다.

### 옵션 B: getProductsByIds를 단일 id 캐시 + N회 fan-out 호출 패턴

- **어떤 방식이었나**: `getProductsByIds(ids)`가 내부에서 `Promise.all(ids.map(getProductById))` 호출. 각 id의 cache가 단독 hit. 태그도 자동으로 `tagProductDetail(id)` 별로 분리된다.
- **왜 안 골랐나**: 배치 조회의 DB I/O 압축이 사라진다 (1 round-trip → N round-trips). compare 페이지 진입 latency가 증가한다. 캐시 hit ratio도 단건 PDP와 비교 페이지 카트가 서로 다른 진입 빈도라 단순 합산이 어렵다. 배치 1 cache key + per-id fan-out 태그가 더 자연스러운 설계다.

### 옵션 C: PPR (Partial Prerendering) opt-in으로 force-dynamic 페이지 정적 shell화

- **어떤 방식이었나**: Next.js 15의 `experimental.ppr`을 켜고 dynamic block을 `<Suspense>`로 격리해 static shell + dynamic chunk hybrid로 변환한다.
- **왜 안 골랐나**: Next.js 15 시점에서 PPR이 여전히 `experimental` 상태다. ADR-0012, 0017, 0018 시리즈 모두 같은 이유로 보류했다. PPR stable 승격 시 별도 ADR로 본 결정 재논의 예정. 그 전엔 force-dynamic 유지가 production safe choice다.

### 옵션 D: admin product CMS placeholder wiring을 본 plan에 포함

- **어떤 방식이었나**: 미래 admin product CRUD가 호출할 `revalidateTag`를 placeholder API로 미리 만들어 둔다.
- **왜 안 골랐나**: YAGNI. admin CMS가 구현될 때 그 PR에서 wiring 추가가 자연스럽다. 본 plan은 무효화 컨트랙트의 *문서화*까지만 책임 — JSDoc 표가 wiring point를 명시한다.

## Notes

- **후속 작업**: admin product CMS PR에서 `TAG_PRODUCTS_FEATURED` / `TAG_PRODUCTS_LIST` / `TAG_DESTINATIONS_LIST` / `tagProductDetail(id)` mutation hook 추가. `entities/product/index.ts`의 JSDoc 표가 wiring spec 역할을 한다.
- **모니터링 지표**: dev server first vs second `/products` 응답 시간 차이로 cache 효과 가시화. Phase 3 후속에서 Vercel Analytics 또는 dev-mock의 metric counter 통합 시 정량화.
- **6개월 뒤 의심받을 가능성**: "왜 mypage/reviews/new도 force-dynamic 유지인가?" — 본 ADR의 옵션 A 거부 사유 참조. PPR stable 승격 시 재논의.
- **본 ADR과 ADR-0004의 관계**: 본 ADR은 **ADR-0004 (캐시 2-layer: 페이지 hint + unstable_cache + revalidateTag)**의 데이터 레이어 부분을 구체 적용한 것 — ADR-0004의 진화이지 supersede가 아님.
