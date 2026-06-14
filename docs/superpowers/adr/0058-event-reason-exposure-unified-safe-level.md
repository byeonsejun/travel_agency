# ADR-0058: 이벤트 reason 노출 — 공유 컴포넌트로 안전 수위 일원화(고객/admin 분리 아님)

- **상태**: Accepted
- **결정일**: 2026-06-14
- **영향 범위**: `src/entities/booking/ui/BookingEventTimeline.tsx`, `src/widgets/booking-detail/ui/BookingDetailView.tsx`, `src/app/(admin)/admin/bookings/[id]/page.tsx`
- **관련 commit**: `c19bf9b` (이벤트 소싱 타임라인 + reason 필터 도입)

## Context (배경)

예약 상태 타임라인(`BookingEventTimeline`)은 각 `BookingEvent`의 `reason`을 표시한다. 그런데 reason에는 두 종류가 섞인다: 사람이 입력한 것(고객/관리자 취소 사유)과, 시스템이 기록한 내부 문자열(예: `tossPaymentKey=...`). 후자를 고객 화면에 그대로 노출하면 결제 키 같은 내부 식별자가 새고 스크린샷 위험이 있다.

## Decision (결정)

**시스템 actor가 기록한 reason은 숨기고, 사람이 입력한 reason만 노출한다.** `BookingEventTimeline`은 (site) 예약 상세와 (admin) 예약 상세가 **공유**하는 단일 컴포넌트이므로, 이 필터는 양쪽에 동일하게 적용된다 → 노출 수위가 *고객 안전 기준으로 일원화*된다.

```ts
// src/entities/booking/ui/BookingEventTimeline.tsx
:35-36 // 시스템 actor 의 내부 reason(예: "tossPaymentKey=...")은 고객 화면에 부적절하므로 숨긴다
:37    const showReason = ev.reason && !ev.actor.startsWith("system:");
:65-66 {showReason && <p>...{ev.reason}</p>}
```

사용처(공유):
- `src/widgets/booking-detail/ui/BookingDetailView.tsx` — (site) 고객 예약 상세
- `src/app/(admin)/admin/bookings/[id]/page.tsx` — (admin) 예약 상세

## Consequences (결과)

**얻은 것:**
- 결제 키 등 시스템 내부 reason이 고객 화면에 새지 않음(안전 기본값).
- 단일 컴포넌트라 site/admin이 자동 일관 — 한쪽만 안전하고 다른 쪽은 새는 drift가 구조적으로 불가능.

**포기한 것 / 미해결:**
- **이건 "고객/admin 분리"가 아니다.** 공유 컴포넌트라 고객용 필터가 admin에도 그대로 걸려, **admin도 현재 raw 시스템 reason(예: `tossPaymentKey`)을 보지 못한다.** 노출 수위가 두 갈래로 *분리*된 게 아니라, 둘 다 *안전 수위 하나로 일원화*된 상태다.
- 따라서 admin이 디버깅·감사를 위해 raw reason을 봐야 하는 요구가 생기면 현재 구조로는 불가 — surface별 분리는 보류(아래 옵션 B).

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: 모든 reason을 raw로 노출(필터 없음)
- 시스템 reason 포함 전부를 양쪽 화면에 그대로 표시.
- **거부.** 고객 화면에 `tossPaymentKey=...` 같은 내부 결제 키가 노출되어 정보 유출·스크린샷 위험. "적절한 표현"(고객 친화) 요구와 정면 충돌.

### 옵션 B: surface별 분리 — admin은 raw, 고객은 필터(audience prop)
- `BookingEventTimeline`에 `audience: "customer" | "admin"` prop을 받아 admin에선 raw reason, 고객에선 필터 적용.
- **보류(거부 아님).** 스코프 자체는 작으나(prop 1개 + admin 페이지에서 주입), 현재 데모 단계에서 admin이 raw reason을 꼭 봐야 하는 검증된 필요가 없다. *안전 기본값(둘 다 필터)*를 택하고, admin raw 노출이 실제로 필요해지면 그때 prop으로 분리 → 그 시점에 본 ADR을 갱신/supersede. 즉 "분리"는 지금 의도적으로 *안 한* 결정이다.

## Notes

- 정직성 주의: 이 결정을 "고객/admin 권한별 노출 분리"로 서술하면 *틀린다*. 현실은 공유 컴포넌트로 인한 *안전 수위 일원화*이며 admin은 raw를 못 본다.
- surface별 분리(옵션 B)를 도입하면: `BookingEventTimeline`에 audience prop 추가 + `(admin)/admin/bookings/[id]/page.tsx`에서 `audience="admin"` 주입. 그때 본 ADR을 supersede.
- 사람/시스템 구분 기준은 `ev.actor` 접두사(`system:` vs `user:`/`admin:`) — actor 포맷이 바뀌면 이 필터도 함께 점검.
