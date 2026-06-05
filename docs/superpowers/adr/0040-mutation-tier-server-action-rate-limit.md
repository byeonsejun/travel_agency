# ADR-0040 — `mutation` tier 신설 + Server Action 미들웨어 우회 갭 봉합(`onBlock` 반환모드)

- **Status**: Accepted
- **Date**: 2026-06-06
- **Phase**: 11 (Security Hardening)
- **영향 범위**: `src/shared/lib/rate-limit/tiers.ts`, `src/shared/lib/rate-limit/withRateLimitAction.ts`, `src/features/{checkout,booking-cancel,review-upload,passport-profile}/server/actions.ts`
- **Related**: [ADR-0022](./0022-rate-limit-hybrid-integration.md)(hybrid 통합), [ADR-0023](./0023-rate-limit-fail-open-policy.md)(fail-open)

## Context

[ADR-0022] 의 hybrid 모델은 (a) `middleware` 의 `global` tier 와 (b) route handler/Server Action 의 정밀 wrapper 두 층으로 구성된다. 그런데 **middleware 의 `global` tier 는 `pathname.startsWith("/api/")` 인 경우에만 평가**한다(콜드스타트 비용 방어선이 `/api/*` 한정이라는 의도). 

문제: **Server Action 은 자신이 정의된 *페이지* 경로로 POST** 된다(`/checkout`, `/mypage` 등) — `/api/*` 가 아니다. 따라서 변형 Server Action 은 middleware rate-limit 을 통째로 우회하며, 명시적으로 `withRateLimitAction` 으로 감싼 `signInWithProvider`(auth tier) 외 **모든 변형 액션이 rate-limit 0** 이었다. checkout(좌석 hold·인벤토리 소진), 리뷰 제출/사진 서명 URL 발급(스팸·스토리지 파밍), 여권 PII write, 예약 취소(환불 경로)가 무방비.

추가 제약: 이 고위험 액션들은 `signInWithProvider`(redirect 형)와 달리 **discriminated union 을 반환**해 `useActionState`/client island 가 소비한다. 기존 `withRateLimitAction` 은 차단 시 `redirect()` 만 가능 → 반환 계약을 깨뜨려 그대로 적용 불가.

## Decision

세 가지를 한 번에:

1. **`mutation` tier 신설** — 인증 사용자의 범용 콘텐츠 write 용.
```ts
mutation: { limit: 20, window: "1 m", idStrategy: "userFirst" },
```
2. **`withRateLimitAction` 에 `onBlock` 반환모드 추가**(하위호환 — 기존 redirect 경로 보존).
```ts
if (!verdict.ok) {
  if (opts.onBlock) return opts.onBlock(verdict.retryAfterSeconds); // 반환모드
  redirect(opts.redirectOnBlock?.(…) ?? "/?error=RATE_LIMITED&…");   // 기존
}
```
3. **고위험 4곳 래핑** — 각 액션의 *네이티브 에러 shape* 을 `onBlock` 으로 반환.
   - `createCheckoutBooking`·`cancelBookingAction` → **payment tier**(10/1m), `idStrategy: "userFirst"` 재정의.
   - `signReviewPhotoUploads`·`submitReview`·`updatePassportProfile` → **mutation tier**.

## Consequences

**얻은 것:**
- 변형 Server Action 의 rate-limit 공백이 봉합됨 — 좌석/스토리지/PII/환불 남용 표면 축소.
- `onBlock` 은 제네릭 `R` 로 핸들러 반환타입과 정합 → `useActionState`/island 가 차단 시에도 *기존 에러 분기*(`{type:"error"}`, `{ok:false, error:"RATE_LIMITED"}`, `{success:false}`)로 자연스럽게 처리. redirect 로 인한 폼 상태 유실 없음.
- `signInWithProvider`(redirectOnBlock, onBlock 없음)는 무변경 컴파일·테스트 통과 — 하위호환 입증(941 tests green).

**포기한 것 / 미해결:**
- **payment tier 에 `userFirst` 재정의**가 들어감 — tier 의 기본 `userOnly` 와 호출부가 다를 수 있다는 비대칭. 사유: `userOnly` 는 미인증 시 `identify` 가 throw → 500. 액션 자체에 auth 가드가 있어 우아한 에러를 반환하므로, wrapper 는 throw 대신 IP 폴백(userFirst)이 옳다. 코드 주석으로 박제.
- **admin 액션·고빈도 저위험 액션(wishlist toggle, loadMore)은 의도적 미적용**(YAGNI) — 아래 Alternatives 참조.
- enforce 는 `RATE_LIMIT_MODE` 기본 enforce + Upstash 도달 가능할 때만 실제 429. 미설정 시 fail-open([ADR-0023]).

## Alternatives Considered

### 옵션 A: middleware 를 확장해 페이지 경로 POST 도 rate-limit
- middleware 에서 모든 POST 를 잡으면 wrapper 없이 일괄 보호.
- 거부: Server Action POST 는 pathname 으로 일반 form POST·RSC 요청과 **구별 불가**. tier 식별을 pathname 에 묶는 건 [ADR-0022] 가 이미 거부한 회귀 위험 패턴. 도메인별 정밀 한도는 액션 지점의 wrapper 가 정확.

### 옵션 B: 신규 tier 없이 기존 tier 재사용
- 콘텐츠 write 를 `ai-search`(20/1m) 나 `payment`(10/1m) 로 흡수.
- 거부: `payment` 는 `userOnly` 라 미인증 throw + "결제" 의미 오염. `ai-search` 로 리뷰를 세는 건 의미 오염(대시보드·로그 tier 라벨이 거짓). `mutation` 전용 tier 가 정직한 모델.

### 옵션 C: 모든 액션을 redirect-on-block 으로
- 기존 wrapper 그대로 사용, 확장 불요.
- 거부: 4개 액션은 `useActionState`/island 가 반환값을 소비. 차단 시 redirect 하면 (a) 멀티스텝 폼 상태 유실(checkout) (b) island 의 RSC action 경계에서 NEXT_REDIRECT 가 비정상 전파. 반환모드가 계약 보존.

### 옵션 D: 각 액션에 `enforce()` 인라인 호출
- HOF 없이 액션 상단에서 직접 `identify`+`enforce`.
- 거부: 4곳에 동일 보일러플레이트 중복. `signInWithProvider` 가 이미 쓰는 HOF + `onBlock` 확장이 DRY 하고 호출 패턴 통일.

## Notes

- 향후 admin 액션 남용이 관측되면 `admin` tier 를 추가해 동형 래핑(현재는 middleware 의 ADMIN role 게이트 뒤라 표면 미미 → YAGNI 보류).
- `mutation` 한도(20/1m) 변경은 `tiers.ts` 한 곳. shadow→enforce 점진 롤아웃은 `RATE_LIMIT_MODE` 로([ADR-0022]).
