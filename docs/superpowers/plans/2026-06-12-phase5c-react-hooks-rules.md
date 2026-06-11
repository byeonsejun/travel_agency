# Phase 5-C Task 1: react-hooks@7 규칙 재활성화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 5-B에서 parity 목적으로 비활성화한 `react-hooks@7` 신규 14규칙을 전부 `error`로 재활성화하고, 그 과정에서 드러나는 8개 위반 사이트(7×`set-state-in-effect`, 1×`refs`)를 올바른 React 19 패턴으로 리팩터한다.

**Architecture:** "배선 점검 먼저." Cache Components 대공사(컴포넌트 수십 개 편집) 전에 엄격 린트를 정상화해, 이후 캐시 리팩터가 회귀를 즉시 갈라내게 한다. 변경은 **전부 `'use client'` 리프 컴포넌트 한정** — 백엔드·서버액션·도메인 로직 0줄. 위험 분산: 위반 0인 12규칙을 먼저 켜고(즉시 윈), 1-site `refs`, 그다음 7-site `set-state-in-effect`를 클러스터별로 처리한다.

**Tech Stack:** React 19.2, ESLint 9 flat config, `eslint-plugin-react-hooks@7`, Next.js 16.

**페르소나:** 🎨 Frontend Expert(전 Task), 💳 Domain Booking(Task 4의 booking-cancel UI 2곳), 🔬 QA(완료 검증).

**핵심 원칙:** classic `react-hooks/rules-of-hooks`·`exhaustive-deps`는 이미 활성 — 건드리지 않는다. 인라인 `// eslint-disable`로 위반을 덮지 않는다(프로젝트 규칙). 각 사이트는 React가 권장하는 컴파일러-친화 패턴으로 *리팩터*한다.

---

## File Structure (touched files)

- `eslint.config.mjs` — 14개 `"off"` 라인을 단계적으로 제거 (Task 1·2·5)
- `src/shared/ui/GlobalRouteProgress.tsx` — `refs` 위반 (Task 2)
- `src/features/wishlist/ui/WishlistHeartButton.tsx` — prop-sync (Task 3)
- `src/features/admin-booking-cancel/ui/AdminCancelBookingButton.tsx` — post-action (Task 4)
- `src/features/booking-cancel/ui/CancelBookingButton.tsx` — post-action (Task 4)
- `src/features/admin-penalty-policy/ui/PenaltyPolicyForm.tsx` — post-action (Task 4)
- `src/features/admin-dashboard-drilldown/ui/DrilldownSheet.tsx` — async-fetch (Task 5)
- `src/features/product-compare/ui/FloatingCompareCart.tsx` — async-fetch (Task 5)
- `src/features/review-upload/ui/ReviewForm.tsx` — objectURL (Task 5)

> 검증 도구: `npm run lint`(파리티 게이트), `npm run typecheck`, `npm run test`. 위반 스캔은 `npx eslint src --rule '{"<rule>":"error"}'`로 개별 확인.

---

## Task 1: 위반 0인 12규칙 즉시 재활성화

> `set-state-in-effect`·`refs` 2개를 제외한 나머지 12규칙은 코드베이스 위반이 0이다(스캔으로 확인됨). 먼저 켜서 미래 회귀 보호를 즉시 확보한다.

**Files:**
- Modify: `eslint.config.mjs`

- [x] **Step 1: 12개 `"off"` 라인 제거**

`eslint.config.mjs`의 react-hooks 비활성 블록에서 다음 12줄을 **삭제**한다 (`set-state-in-effect`와 `refs` 2줄만 남긴다):
```
"react-hooks/static-components": "off",
"react-hooks/use-memo": "off",
"react-hooks/preserve-manual-memoization": "off",
"react-hooks/incompatible-library": "off",
"react-hooks/immutability": "off",
"react-hooks/globals": "off",
"react-hooks/error-boundaries": "off",
"react-hooks/purity": "off",
"react-hooks/set-state-in-render": "off",
"react-hooks/unsupported-syntax": "off",
"react-hooks/config": "off",
"react-hooks/gating": "off",
```
남는 블록(주석 갱신 — "14개 중 2개만 off, 나머지는 활성화됨. set-state-in-effect/refs는 Task 4·5 이전 임시 잔존"):
```js
      // react-hooks@7: set-state-in-effect/refs는 위반 사이트 리팩터 전까지 임시 off.
      // 나머지 12규칙은 위반 0으로 활성화됨. classic rules-of-hooks/exhaustive-deps도 활성.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
```

- [x] **Step 2: lint 그린 확인 (신규 에러 0)**

Run:
```bash
npm run lint
```
Expected: `0 errors`, 기존 10 warnings 동일(증가 없음). 12규칙 활성화로 신규 위반이 뜨면 스캔이 틀린 것 → 해당 규칙만 다시 off하고 보고.

- [x] **Step 3: Commit**

```bash
git add eslint.config.mjs
git commit -m "chore(lint): re-enable 12 zero-violation react-hooks@7 rules

- only set-state-in-effect/refs remain off (have violation sites, fixed next)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `refs` 위반 수정 + 규칙 활성화 (GlobalRouteProgress)

> `refs` 규칙은 **렌더 단계에서 `ref.current` 쓰기**를 금지한다. `GlobalRouteProgress`가 `phaseRef.current = phase`를 렌더 본문에서 실행한다(line 29). 이 미러는 "done 이펙트"가 `phase`를 deps에 넣지 않고 최신값을 읽기 위함이다. 쓰기를 effect로 옮긴다.

**Files:**
- Modify: `src/shared/ui/GlobalRouteProgress.tsx`
- Modify: `eslint.config.mjs`

- [x] **Step 1: 렌더-단계 ref 쓰기를 effect로 이동**

`src/shared/ui/GlobalRouteProgress.tsx`의 line 28-29:
```ts
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
```
를 다음으로 교체 (초기값만 유지, 쓰기는 effect로):
```ts
  const phaseRef = useRef<Phase>(phase);
  // 렌더 단계 ref 쓰기 금지(react-hooks/refs) → commit 후 동기화.
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
```

- [x] **Step 2: 위반 해소 확인**

Run:
```bash
npx eslint src/shared/ui/GlobalRouteProgress.tsx --rule '{"react-hooks/refs":"error"}'
```
Expected: 위반 0.

- [x] **Step 3: `refs` 규칙 활성화**

`eslint.config.mjs`에서 `"react-hooks/refs": "off",` 줄을 **삭제**.

- [x] **Step 4: lint + typecheck + test 그린**

Run:
```bash
npm run lint && npm run typecheck && npm run test 2>&1 | tail -4
```
Expected: lint 0 errors, typecheck 0, 1170 tests pass.

- [ ] **Step 5: 런타임 거동 수동 확인 노트**

> 🔬 자동화 한계: 진행 바 타이밍(클릭→90% trickle→네비게이션 완료→100%→fade)은 단위테스트 불가. 구현자는 `npm run dev` 후 내부 링크 클릭 시 진행 바가 정상 동작하는지 1회 육안 확인하고, 불가하면 사용자 수동 검증 항목으로 명시(절차: 홈→상품 링크 클릭 시 상단 파란 바 0→90→100 후 사라짐).

- [x] **Step 6: Commit**

```bash
git add src/shared/ui/GlobalRouteProgress.tsx eslint.config.mjs
git commit -m "fix(progress): sync phaseRef in effect not render + enable react-hooks/refs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `set-state-in-effect` — prop-sync 수정 (WishlistHeartButton)

> 가장 깨끗한 케이스. "prop이 바뀌면 state 동기화"를 effect로 하는 안티패턴 → React 공식 "렌더 중 조건부 setState" 패턴으로 교체(effect 제거).

**Files:**
- Modify: `src/features/wishlist/ui/WishlistHeartButton.tsx`

- [x] **Step 1: prop-sync effect → 렌더-단계 조건부 setState**

`src/features/wishlist/ui/WishlistHeartButton.tsx`의 line 48-56:
```ts
  const [displayed, setDisplayed] = useState(inWishlist);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // 부모 RSC 가 새로운 inWishlist prop 을 내려주면 동기화. ...
  useEffect(() => {
    setDisplayed(inWishlist);
  }, [inWishlist]);
```
를 다음으로 교체:
```ts
  const [displayed, setDisplayed] = useState(inWishlist);
  const [prevInWishlist, setPrevInWishlist] = useState(inWishlist);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // 부모 RSC 가 새 inWishlist prop 을 내려주면 동기화. React 공식 "prop 변화 시
  // state 조정" 패턴(렌더 중 조건부 setState) — effect 불필요. 사용자 클릭으로
  // setDisplayed 한 직후 prop 이 같으면 prev===next 라 no-op.
  if (prevInWishlist !== inWishlist) {
    setPrevInWishlist(inWishlist);
    setDisplayed(inWishlist);
  }
```

- [x] **Step 2: 미사용 `useEffect` import 제거**

line 3에서 `useEffect`를 import 목록에서 제거 (`useState`, `useTransition`만 남김):
```ts
import { useState, useTransition } from "react";
```
(파일에 다른 useEffect 사용이 없음을 grep으로 확인: `grep -n "useEffect" src/features/wishlist/ui/WishlistHeartButton.tsx` → 출력 없어야 함.)

- [x] **Step 3: 위반 해소 + typecheck**

Run:
```bash
npx eslint src/features/wishlist/ui/WishlistHeartButton.tsx --rule '{"react-hooks/set-state-in-effect":"error"}'
npm run typecheck
```
Expected: 위반 0, typecheck 0 errors.

- [x] **Step 4: Commit**

```bash
git add src/features/wishlist/ui/WishlistHeartButton.tsx
git commit -m "fix(wishlist): adjust displayed state during render not effect (set-state-in-effect)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `set-state-in-effect` — post-action 클러스터 (3 사이트)

> 💳 Domain Booking + 🎨 Frontend 동시 발동 (AdminCancel·CancelBooking은 booking-cancel 도메인 UI). `useActionState`의 `state`를 effect로 감시해 성공 시 `setOpen(false)`/필드 리셋하는 패턴이 `set-state-in-effect`에 걸린다. **서버 액션·도메인 로직은 변경하지 않는다** — UI 상태 처리만 컴파일러-친화 패턴으로.

**Files:**
- Modify: `src/features/admin-booking-cancel/ui/AdminCancelBookingButton.tsx`
- Modify: `src/features/booking-cancel/ui/CancelBookingButton.tsx`
- Modify: `src/features/admin-penalty-policy/ui/PenaltyPolicyForm.tsx`

- [x] **Step 1: AdminCancelBookingButton — `open`을 파생값으로, effect는 router.refresh만**

`useActionState`의 `state`는 유지. `setOpen(false)`를 effect에서 제거하고 `open`을 파생한다. line 44-49의 effect와 `open` state를 다음 구조로:
```ts
  // rawOpen: 사용자가 연 의도. settled: 액션 성공/지연. open: 둘의 파생.
  const [rawOpen, setRawOpen] = useState(false);
  const settled = state?.type === "success" || state?.type === "deferred";
  const open = rawOpen && !settled;

  // 성공/지연 시 RSC 재검증만 effect 로(부수효과, setState 아님 → 규칙 무관).
  // 다이얼로그 닫힘은 open 파생으로 자동 처리.
  useEffect(() => {
    if (settled && rawOpen) router.refresh();
  }, [settled, rawOpen, router]);
```
기존 `setOpen(true)`/`setOpen(false)` 호출처를 `setRawOpen(true)`/`setRawOpen(false)`로 치환(예: `handleClose`의 `setOpen(false)` → `setRawOpen(false)`, 트리거 버튼 `onClick={() => setOpen(true)}` → `setRawOpen(true)`). 렌더에서 다이얼로그 가드 `{open && ...}`는 그대로 파생 `open`을 사용.

> ⚠️ 구현자: 파일 전체를 읽고 모든 `open`/`setOpen` 참조를 정확히 매핑할 것. `open`(파생 읽기)과 `setOpen`(→`setRawOpen`)을 혼동하지 말 것.

- [x] **Step 2: CancelBookingButton — 동일 패턴 적용**

`src/features/booking-cancel/ui/CancelBookingButton.tsx` line 62-67의 effect도 Step 1과 **동일 구조**로 변환(`rawOpen`/`settled`/`open` 파생 + effect는 `router.refresh()`만). 이 파일의 `open`/`setOpen` 참조 전부를 매핑해 치환. 도메인 주석(success/deferred 구분)은 보존.

- [x] **Step 3: PenaltyPolicyForm — useActionState→수동 transition으로 성공 시 리셋을 콜백에서**

`src/features/admin-penalty-policy/ui/PenaltyPolicyForm.tsx`는 성공 시 4개 필드를 리셋한다(파생 불가 — 사용자 편집 state). `useActionState`를 수동 `useState`+`useTransition`으로 바꿔 리셋을 액션 콜백(이벤트)에서 수행한다. line 31-45를:
```ts
  const [state, dispatch, isPending] = useActionState(savePenaltyPolicyAction, null);
  ...
  useEffect(() => {
    if (state?.type === "success") {
      setKey(""); setName(""); setRows(DEFAULT_ROWS); setClientError(null);
      router.refresh();
    }
  }, [state, router]);
```
다음으로 교체:
```ts
  const [state, setState] = useState<Awaited<ReturnType<typeof savePenaltyPolicyAction>> | null>(null);
  const [isPending, startTransition] = useTransition();
```
그리고 폼 제출 핸들러에서(기존 `<form action={dispatch}>`였다면 `onSubmit`으로 전환):
```ts
  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await savePenaltyPolicyAction(state, formData);
      setState(res);
      if (res?.type === "success") {
        setKey(""); setName(""); setRows(DEFAULT_ROWS); setClientError(null);
        router.refresh();
      }
    });
  }
```
> ⚠️ 구현자: 이 파일 전체를 읽고 `dispatch` 사용처(폼 `action`/버튼)와 `state` 참조(에러 표시 등)를 정확히 파악해 수동 transition으로 일관 변환할 것. `savePenaltyPolicyAction`의 시그니처(prevState, formData)를 확인해 호출 인자를 맞출 것. 미사용 `useActionState` import 제거.

- [x] **Step 4: 3 파일 위반 해소 + typecheck**

Run:
```bash
npx eslint src/features/admin-booking-cancel/ui/AdminCancelBookingButton.tsx src/features/booking-cancel/ui/CancelBookingButton.tsx src/features/admin-penalty-policy/ui/PenaltyPolicyForm.tsx --rule '{"react-hooks/set-state-in-effect":"error"}'
npm run typecheck
```
Expected: 위반 0, typecheck 0 errors.

- [x] **Step 5: 관련 테스트 + 도메인 거동 확인**

Run:
```bash
npm run test 2>&1 | tail -6
```
Expected: 1170 pass. booking-cancel/penalty 관련 테스트가 있으면 그린. 

> 🔬💳 자동화 한계: 다이얼로그 닫힘·router.refresh·폼 리셋의 실거동은 단위테스트 범위 밖. 구현자는 변경된 상태 흐름이 기존과 동치임을 코드로 논증하고(특히 `deferred` 케이스 — PG 지연 시에도 다이얼로그 닫힘 유지), 실 클릭 검증은 사용자 수동 항목으로 명시(예약 직권취소/자가취소/위약금정책 저장 3 플로우의 다이얼로그·리스트 갱신).

- [x] **Step 6: Commit**

```bash
git add src/features/admin-booking-cancel/ui/AdminCancelBookingButton.tsx src/features/booking-cancel/ui/CancelBookingButton.tsx src/features/admin-penalty-policy/ui/PenaltyPolicyForm.tsx
git commit -m "fix(booking-ui): handle post-action UI in derived state/transition not effect

- AdminCancel/CancelBooking: derive dialog open, effect does router.refresh only
- PenaltyPolicyForm: useActionState → manual transition, reset in callback
- server actions / domain logic unchanged

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `set-state-in-effect` — async-fetch/objectURL 클러스터 (3 사이트) + 규칙 활성화

> 마지막 3 사이트는 비동기 fetch·objectURL 라이프사이클이라 setState가 effect에 있는 게 관행이지만, 규칙은 **동기 setState in effect**를 싫어한다. 컴파일러-친화 패턴으로 동기 setState를 제거한다: fetch는 "loadedKey를 data와 함께 저장→loading 파생", objectURL은 "생성을 이벤트 핸들러로, effect는 revoke만".

**Files:**
- Modify: `src/features/review-upload/ui/ReviewForm.tsx`
- Modify: `src/features/admin-dashboard-drilldown/ui/DrilldownSheet.tsx`
- Modify: `src/features/product-compare/ui/FloatingCompareCart.tsx`
- Modify: `eslint.config.mjs`

- [ ] **Step 1: ReviewForm — objectURL 생성을 이벤트로, effect는 revoke만**

현재(line 55-61) effect가 `files` 변화 시 `setPreviewUrls(urls)` (동기 setState). previewUrls를 별도 state로 두지 말고 **files와 URL을 함께** 이벤트에서 관리한다. `files: File[]`와 병행하는 `previewUrls`를 `handleFilePick`/`removeFile`에서 같이 갱신하고, effect는 unmount 시 revoke만 담당한다.

`previewUrls` state는 유지하되 setState 위치를 이동:
- `handleFilePick`의 `setFiles((prev) => [...prev, ...accepted])` 직후 동일 콜백에서 `setPreviewUrls((prev) => [...prev, ...accepted.map((f) => URL.createObjectURL(f))])`.
- `removeFile(idx)`에서 해당 url을 revoke하고 `setPreviewUrls((prev) => prev.filter((_, i) => i !== idx))` + `setFiles` 동기.
- 기존 line 55-61 effect는 다음으로 축소(생성 제거, 언마운트 revoke만):
```ts
  // 컴포넌트 unmount 시 잔여 objectURL 일괄 revoke (메모리 누수 방어).
  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);
```
이때 cleanup이 최신 urls를 보도록 `const previewUrlsRef = useRef<string[]>([]); previewUrlsRef.current = previewUrls;` 는 **refs 규칙 위반**이므로, 대신 effect로 동기화: `useEffect(() => { previewUrlsRef.current = previewUrls; }, [previewUrls]);`

> ⚠️ 구현자: `files`와 `previewUrls`의 인덱스 정합을 반드시 유지(removeFile이 둘 다 같은 idx로 필터). handleFilePick의 부분 수락(accepted) 경로에서 files와 urls가 어긋나지 않게 같은 accepted 배열로 생성. 전체 파일 읽고 정합 검증.

- [ ] **Step 2: DrilldownSheet — loadedKey 파생으로 동기 setState 제거**

현재(line 37-54) effect가 `setLoading(true); setError(null); setData(null)` 동기 호출. `loading`을 state 대신 파생한다: 요청 키를 data와 함께 저장.
```ts
  const reqKey = `${metric}|${start}|${end}|${productId ?? ""}`;
  const [result, setResult] = useState<{ key: string; data: DrilldownData | null; error: string | null }>(
    { key: "", data: null, error: null },
  );
  const loading = result.key !== reqKey;

  useEffect(() => {
    const token = ++tokenRef.current;
    loadDrilldownAction({ metric, start, end, productId: productId ?? undefined })
      .then((res) => {
        if (token !== tokenRef.current) return;
        setResult(res.type === "error"
          ? { key: reqKey, data: null, error: res.message }
          : { key: reqKey, data: res.data, error: null });
      })
      .catch(() => {
        if (token === tokenRef.current) setResult({ key: reqKey, data: null, error: "데이터 조회 실패" });
      });
  }, [reqKey, metric, start, end, productId]);
```
렌더에서 `data`/`error`/`loading`을 `result.data`/`result.error`/`loading`으로 참조하도록 갱신. (setState는 .then/.catch 콜백에만 → 규칙 통과.)

> ⚠️ 구현자: 파일 전체를 읽고 `data`/`error`/`loading` 모든 참조를 새 파생값으로 일관 치환. `tokenRef` stale 가드는 유지.

- [ ] **Step 3: FloatingCompareCart — 동일 loadedKey 파생 패턴**

`src/features/product-compare/ui/FloatingCompareCart.tsx`의 line 32-61도 Step 2와 동형으로: `products`/`errored` 동기 리셋 제거, `{ key, products, errored }` 단일 state + `isLoading = state.key !== idsKey` 파생, fetch 결과는 .then/.catch 콜백에서만 setState. `AbortController` cleanup은 유지. `ids.length === 0` early 처리도 콜백/파생으로 정리(동기 `setProducts([])` 제거 — `idsKey===""`를 loaded로 간주).

> ⚠️ 구현자: 기존 `// eslint-disable-next-line react-hooks/exhaustive-deps`(line 60)도 재검토 — idsKey 단일 dep이 유지되면 보존, 구조 변경으로 불필요해지면 제거. AbortController abort cleanup 필수 유지(Frontend critical rule).

- [ ] **Step 4: 3 파일 위반 해소 확인**

Run:
```bash
npx eslint src/features/review-upload/ui/ReviewForm.tsx src/features/admin-dashboard-drilldown/ui/DrilldownSheet.tsx src/features/product-compare/ui/FloatingCompareCart.tsx --rule '{"react-hooks/set-state-in-effect":"error","react-hooks/refs":"error"}'
```
Expected: 위반 0. (혹 특정 사이트가 규칙과 근본적으로 양립 불가하면 — 인라인 disable 금지 — 즉시 보고. set-state-in-effect를 `error` 대신 `warn`으로 두는 폴백을 컨트롤러가 결정.)

- [ ] **Step 5: `set-state-in-effect` 규칙 활성화 + 전체 그린**

`eslint.config.mjs`에서 `"react-hooks/set-state-in-effect": "off",` 줄 **삭제** (이제 react-hooks 비활성 블록 전체가 비어 주석만 정리하거나 블록 제거).

Run:
```bash
npm run lint && npm run typecheck && npm run test 2>&1 | tail -4
```
Expected: lint 0 errors(기존 warnings만), typecheck 0, 1170 tests pass.

- [ ] **Step 6: 빌드 회귀 가드 (선택, 클라 경계 변경 다수)**

> 메모리(run-build-for-boundaries): 클라이언트 컴포넌트 다수 편집 → dev 서버 종료 후 `npx next build`로 번들 회귀 확인 권장.

Run (dev 종료 상태에서):
```bash
npx next build 2>&1 | tail -8
```
Expected: Turbopack 빌드 성공, BUILD_ID 생성.

- [ ] **Step 7: Commit**

```bash
git add src/features/review-upload/ui/ReviewForm.tsx src/features/admin-dashboard-drilldown/ui/DrilldownSheet.tsx src/features/product-compare/ui/FloatingCompareCart.tsx eslint.config.mjs
git commit -m "fix(client): remove sync setState-in-effect (derive loading, objectURL in handler)

- ReviewForm: create object URLs in event handlers, effect revokes only
- DrilldownSheet/CompareCart: store loaded key with data, derive loading
- enable react-hooks/set-state-in-effect → all 14 react-hooks@7 rules now active

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 마감 — 문서/검증

**Files:**
- Modify: `eslint.config.mjs` (주석 정리), `CLAUDE.md` (노트), 이 플랜 파일

- [ ] **Step 1: 종합 증거**

Run (출력 인용):
```bash
npm run lint && npm run typecheck && npm run test 2>&1 | tail -4
npx eslint src --rule '{"react-hooks/set-state-in-effect":"error","react-hooks/refs":"error"}' 2>&1 | tail -3
```
Expected: 전부 그린, 잔여 react-hooks 위반 0.

- [ ] **Step 2: eslint.config.mjs 주석 최종 정리**

react-hooks 비활성 블록이 비었으면 제거하고, 헤더 JSDoc(현재 "14개 off" 설명)을 "react-hooks@7 전 규칙 활성(Phase 5-C에서 위반 사이트 리팩터 완료)"로 갱신.

- [ ] **Step 3: CLAUDE.md 노트**

§8에 한 줄 추가: `**Phase 5-C Task1(react-hooks@7 재활성화) 완료** — Phase 5-B에서 parity 위해 끈 14규칙 전부 error 재활성화 + 위반 8곳(7 set-state-in-effect, 1 refs) 컴파일러-친화 패턴 리팩터(서버/도메인 로직 무변경).`

- [ ] **Step 4: 플랜 체크박스 최종 sweep**

```bash
grep -n "\- \[ \]" docs/superpowers/plans/2026-06-12-phase5c-react-hooks-rules.md
```
완료 Task의 미체크 0건 확인.

- [ ] **Step 5: Commit**

```bash
git add eslint.config.mjs CLAUDE.md docs/superpowers/plans/2026-06-12-phase5c-react-hooks-rules.md
git commit -m "docs: finalize Phase 5-C Task 1 (react-hooks@7 fully re-enabled)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Checklist (작성자 점검)

- **Spec coverage:** 14규칙 전부 활성화 경로 존재 — 12(Task1) + refs(Task2) + set-state-in-effect 7사이트(Task3 prop-sync 1 / Task4 post-action 3 / Task5 fetch·objectURL 3) → Task5 Step5에서 마지막 규칙 on. 누락 없음.
- **Placeholder scan:** 각 사이트 fix를 구체 코드로 제시. "구현자: 파일 전체 읽고 매핑" 지시는 플레이스홀더가 아니라 다중-참조 치환의 정확성 가드(open/setOpen, data/loading 등 동일 식별자 다수 참조 때문).
- **Type consistency:** `rawOpen`/`settled`/`open` 파생 네이밍이 Task4 두 파일에서 동일. `result.key` 파생 패턴이 Task5 Drilldown/CompareCart에서 동일.
- **위험:** Task4(booking-cancel UI)·Task5(fetch)가 거동 민감 → 각 Task 그린 게이트 + 수동검증 항목 명시. 서버액션/도메인 로직 0줄 변경이 전 Task 불변식.

## 검증 게이트 (Task별)
- T1: lint 0 errors(12규칙 on, 위반 0)
- T2: refs 위반 0 + lint/typecheck/test 그린
- T3: wishlist set-state-in-effect 위반 0 + typecheck
- T4: 3 파일 위반 0 + test 1170 + 도메인 거동 논증
- T5: 3 파일 위반 0 + set-state-in-effect on + 전체 그린 + build
- T6: 잔여 react-hooks 위반 0 + 문서
