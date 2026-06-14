# ADR-0056: 결제 만료 cron 미구현 — known gap으로 박제

- **상태**: Accepted
- **결정일**: 2026-06-14
- **영향 범위**: `prisma/schema.prisma`(Booking.paymentDueAt), `src/app/api/cron/dispatcher/route.ts`, `src/features/checkout/ui/CheckoutForm.tsx`
- **관련 commit**: `31694ba` (paymentDueAt 컬럼 도입), `c19bf9b` (CheckoutForm 주석으로 미구현 명시), 인접 [ADR-0028] / [ADR-0034]

## Context (배경)

`Booking.paymentDueAt`은 "DEPARTURE_CONFIRMED 진입 시 set, 결제 만료 cron용"이라는 의도로 스키마에 존재한다. 미결제 예약이 좌석을 무기한 점유하지 않게 만료시켜 좌석을 환원하는 워커를 위한 자리다. 그러나 그 워커는 만들어지지 않았고, 컬럼은 set/read 없이 비어 있다. 이 "있어 보이지만 안 도는" 상태를 우연히 발견한 다음 작업자가 "버그/누락"으로 오해하지 않도록, *의도된 미구현*임을 박제한다.

## Decision (결정)

**결제 만료 자동취소·좌석환원 cron을 만들지 않는다.** 이 미구현을 *known gap*으로 명시한다.

코드 현실(grep 근거):

```
prisma/schema.prisma:311  paymentDueAt DateTime?  // 정의 (주석: "결제 만료 cron용")
prisma/schema.prisma:328  @@index([status, paymentDueAt])  // 인덱스
→ 전역 grep "paymentDueAt": set/read 실행 코드 0건.
   (src 매칭은 CheckoutForm.tsx:142 의 "paymentDueAt 미구현이라 TTL 카운트다운 안 만든다" 주석뿐)

src/app/api/cron/dispatcher/route.ts:19-22  워커 4종:
  refund(limit10) / email(limit10) / embedding(limit5) / rum-cleanup
→ 결제 만료 워커 없음.
```

즉 좌석 hold에는 TTL이 없다 — 좌석은 booking 행의 `bookedSeats` 카운터가 잡고, 미결제 만료로 자동 환원되지 않는다.

## Consequences (결과)

**얻은 것:**
- "paymentDueAt 컬럼/인덱스가 있는데 왜 안 도나"라는 미래의 혼란을 사전 차단 — 의도된 gap임을 문서로 못박음.
- 프론트가 가짜 TTL 카운트다운/타이머를 만들지 않는 근거 확보(`CheckoutForm.tsx:142`) — 백엔드에 만료 기준이 없으므로 카운트다운은 거짓이 된다.

**포기한 것 / 미해결:**
- 미결제 예약이 좌석을 무기한 점유. 활성 예약이 남아 있으면 출발 취소·좌석 회수에 수동 개입이 필요할 수 있음([ADR-0028]의 활성 예약 가드와 맞물림).
- "좌석 hold TTL 카운트다운"을 시그니처 UX로 만들 수 없음 — 이 gap이 선행 구현되어야 가능.

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: 지금 결제 만료 cron을 구현
- `paymentDueAt` 경과 booking을 dispatcher 워커가 픽업 → 취소 전이 + 좌석 환원.
- **보류(거부 아님).** (1) [NO-REAL-MONEY] 제약 하의 데모 단계라 실제 결제 압박(미결제 점유로 인한 매진 손실)이 발생하지 않아 데모 가치가 0. (2) 만료 취소는 단순 cron이 아니라 좌석 환원 보상 + 멱등 + 상태전이 가드가 얽힌 saga라 스코프가 크다([ADR-0028] 출발취소 cascade와 동형의 작업량). 라이브 트래픽이 생기면 이 옵션이 옳은 경로.

### 옵션 B: paymentDueAt 컬럼/인덱스를 제거
- 안 쓰는 컬럼을 스키마에서 삭제해 "있어 보이는데 안 도는" 혼란 자체를 없앤다.
- **거부.** 미래 구현의 자리를 의도적으로 보존한다. 컬럼+부분 인덱스의 보관 비용은 미미하고, 제거하면 만료 cron 구현 시 마이그레이션을 다시 해야 한다. 대신 본 ADR + 코드 주석으로 "의도된 미구현"을 명시해 혼란을 해소.

## Notes

- 이 gap을 닫는 작업(옵션 A)을 착수하면 본 ADR을 `Superseded by ADR-XXXX`로 마킹할 것.
- 관련 모니터링: 미결제 상태(DEPARTURE_CONFIRMED, 결제 PENDING)로 오래 머문 booking 수 — 트래픽이 생기면 이 지표가 옵션 A의 트리거.
- dispatcher 워커 목록은 [ADR-0034](cron dispatcher 통합)가 SSOT. 결제 만료 워커 추가 시 그 배열에 등록.
