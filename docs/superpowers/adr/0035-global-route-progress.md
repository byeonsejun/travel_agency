# ADR-0035: 전역 클릭 기반 trickle 진행 바 (useLinkStatus per-link 폐기)

- **상태**: Accepted
- **결정일**: 2026-06-04
- **영향 범위**: `src/shared/ui/GlobalRouteProgress.tsx`, `src/app/(site)/layout.tsx`, `src/widgets/product-card-list/ui/ProductFilterBar.tsx`, `src/widgets/product-card-list/ui/Pagination.tsx`
- **관련 commit**: `6aeed11`(초기 useLinkStatus), `5ce54ad`(per-link 적용), `90670ff`(가시성), `450de59`(전역 전환), `c683011`(trickle)

## Context (배경)

Phase 7 spec(`2026-06-04-phase7-nav-ux-design.md`) §3.5 는 페이지 이동 진행 바를 **`useLinkStatus`(Next 15 네이티브)** per-link 방식으로 설계했다: `ProgressLink` 래퍼를 만들어 필터탭·페이지네이션에만 적용. 구현·검증 후 사용자 런타임 테스트에서 두 문제가 드러났다.

1. **적용 범위 누락**: per-link 방식은 `ProgressLink` 로 감싼 링크에서만 동작한다. 정작 가장 흔한 이동인 **상품 카드 클릭(목록→상세)·헤더 네비**는 일반 `<Link>` 라 진행 바가 전혀 안 떴다. "페이지 이동 시 로딩 표시가 없다"는 정당한 지적.
2. **가시성**: 초기 바가 `h-0.5`(2px) + `animate-pulse` 라 느린 네트워크에서도 육안 식별 불가. (Playwright + CDP throttle 로 pending 감지·DOM 렌더는 정상이나 시각적으로 안 보임을 확인 — `90670ff` 로 4px 슬라이드 바 1차 개선.)
3. **`useLinkStatus` 자체 한계**: prefetch 완료된 링크는 클릭 시 pending 이 거의 0 → prod 에서 진행 바 누락 위험.

또한 초기 전역 구현은 `infinite` keyframe 으로 바가 이동 완료까지 좌→우 슬라이드를 **계속 반복**해 "로딩 % 표시"가 아니라 어수선한 무한 루프로 보였다.

## Decision (결정)

per-link `useLinkStatus` 를 폐기하고, `(site)` 레이아웃에 **단일 전역 `GlobalRouteProgress`** 를 둔다. 내부 링크 클릭을 **capture 단계**에서 가로채 이동 시작을 감지하고, `pathname`/`searchParams` 변화로 완료를 감지한다. 바는 YouTube/nprogress 식 **trickle**(0→90% ease-out 단방향, 완료 시 100%→fade)로 한 번만 진행한다.

```ts
// capture 단계가 핵심: Next <Link> 의 preventDefault 보다 먼저 실행돼야 클릭을 잡는다.
// (bubble 단계면 Link 가 먼저 preventDefault → e.defaultPrevented=true 로 누락)
document.addEventListener("click", onClick, true);
// ...
// loading: width 0→90% cubic-bezier(처음 빠르고 점점 느려짐, RSC 스트리밍이라 실제 % 측정 불가 → 근사)
// done(pathname/search 변화): width→100%, opacity→0
```

## Consequences (결과)

**얻은 것:**
- 상품 카드·헤더·필터·페이지네이션 등 **사이트 모든 내부 `<Link>` 이동**을 단일 컴포넌트가 커버. 새 링크 추가 시 별도 작업 불필요.
- prefetch 완료 여부와 무관하게 클릭 즉시 표시(useLinkStatus 한계 해소).
- trickle 단방향 진행으로 "로딩 중" UX 명확. `useSearchParams` 는 Suspense 로 감싸 정적 prerender 무손상([ADR-0018] PDP ISR 무영향).

**포기한 것 / 미해결:**
- **실제 로딩 % 는 불가능**: App Router client 이동은 RSC 스트리밍이라 수신률을 알 수 없어 determinate 진행 바가 원천 불가. trickle(점근 근사)로 흉내. (YouTube/GitHub 동일 한계.)
- `router.push` 기반 이동(정렬·검색)은 `<a>` 클릭이 아니라 이 리스너가 못 잡음 → 기존 `useTransition` 컴포넌트 내부 스피너가 분담(역할 분리 유지).
- per-link 컴포넌트(`ProgressLink`/`RouteProgress`)·테스트 삭제.

## Alternatives Considered (대안)

### 옵션 A: useLinkStatus per-link 유지 + 모든 링크를 ProgressLink 로 교체 (spec 원안 확장)
- 사이트의 40+ 파일 모든 `<Link>` 를 `ProgressLink` 로 일괄 교체.
- 거부: 유지보수 부담(신규 링크마다 교체 강제) + prefetch 완료 시 미표시 한계는 그대로. 누락이 구조적으로 재발.

### 옵션 B: bubble 단계 클릭 리스너
- `addEventListener("click", fn)` 기본(bubble).
- 거부: Next `<Link>` 가 bubble 단계에서 먼저 `preventDefault()` → 도달 시 `e.defaultPrevented=true` 라 무시됨(Playwright 로 실증: bubble 시 pending 로그 0건). capture 단계 필수.

### 옵션 C: infinite 슬라이드(초기 전역 구현)
- 바가 이동 완료까지 좌→우 슬라이드 무한 반복.
- 거부: "로딩 진행"이 아니라 반복 애니메이션으로 보여 사용자가 명시적으로 거부. 단방향 trickle 로 교체.

### 옵션 D: 외부 라이브러리(nprogress / next-nprogress-bar)
- 거부: spec §결정 환경 제약 — 외부 의존성·번들 증가 금지(YAGNI). 네이티브 구현으로 충분.

## Notes

- 검증: Playwright + CDP throttle 로 (a) 상품 카드/헤더 클릭 시 진행 바 노출 (b) width 0→89% 단조 증가·리셋 0회 (c) 완료 시 100%→idle 확인. 단위 테스트 `GlobalRouteProgress.test.tsx` 4종(클릭 표시/동일URL 무시/외부링크 무시).
- 안전장치: 이동이 끝내 완료 안 돼도(차단·동일 URL) 8초 후 자동 숨김(`setTimeout` + cleanup).
- 새 force-dynamic 도메인이나 `(admin)` 셸에도 진행 바를 원하면 해당 레이아웃에 `<Suspense><GlobalRouteProgress/></Suspense>` 추가(현재 `(site)` 만).
- 모니터링: client island 이 늘면 capture 클릭 리스너 1개가 document 전역이라 비용 무시 가능하나, 만약 SPA 이동이 잦은 화면에서 깜빡임이 거슬리면 trickle 시작 지연(예: 100ms debounce) 검토.
