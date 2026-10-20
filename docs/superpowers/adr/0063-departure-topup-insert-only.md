# ADR-0063: 데모 출발일 노후화는 "보충(INSERT-only)"으로 복구 — 기존 출발편 0건 수정, 미래 예약가능 출발편 없는 PUBLISHED 상품에만 신규 Departure 생성

- **상태**: Accepted
- **결정일**: 2026-10-20
- **영향 범위**: `scripts/ops/topup-departures.ts`, `scripts/__tests__/topup-departures.test.ts` (앱 런타임 코드·`src/entities/{booking,payment}` 무변경)
- **관련 commit**: (이 ADR 과 같은 커밋)

## Context (배경)

배포 사이트 특가가 전부 "출발일 미정"으로 보이는 증상은 코드 버그가 아니라 **데이터 노후화**다. 시드 출발일은 적재 시점 기준 상대일(`addDays(today, N)`)이라 시간이 지나면 전부 과거가 되고, `ProductCard` 는 `departureDate >= today AND status != CANCELED` 출발편이 없으면 배지를 띄운다(PDP 의 "예약하기"도 사라짐).

2026-10-15 에는 `scripts/ops/shift-departures.ts`(모든 Departure 를 같은 일수만큼 이동)로 복구했다. 그러나 이 방식은:

1. **예약이 달린 출발편의 날짜까지 움직인다** — 로컬 기준 43건 중 13건이 `bookedSeats > 0`. 이미 결제된 예약의 여행 일정이 소리 없이 바뀌고, 결제·이벤트 스냅샷(예약 시점 날짜)과 어긋난다.
2. **출발편이 원래 없는 상품은 못 고친다** — 관리자가 만든 상품 중 Departure 0건인 상품(로컬: "세부 가족여행 4박5일")은 이동할 대상이 없어 계속 "출발일 미정".
3. 몇 달마다 반복 실행해야 하고, 실행할 때마다 전체 이력이 다시 이동한다.

## Decision (결정)

**기존 행은 한 건도 수정하지 않고, 부족한 상품에만 미래 출발편을 INSERT 한다.**

- 대상: `PUBLISHED` 상품 중 오늘(UTC 자정) 이후 **예약 가능한**(`SCHEDULED`/`CONFIRMED`) 출발편이 0건인 상품. 기준을 카드 배지(`!= CANCELED`)보다 엄격하게 잡아 `CLOSED`(마감)만 남은 상품도 예약 가능한 일정이 생기게 한다.
- 템플릿: 가장 최근의 비-CANCELED 출발편에서 가격·좌석·최소인원·위약금 정책 키·여행 기간을 승계. 출발편이 아예 없으면 상품 폴백(성인=아동=`basePriceAdult`, 유아 0, 좌석 20/최소 8 — 로컬 데이터 최빈값).
- 일정: 오늘+`lead`(기본 7일)부터 `interval`(기본 14일) 간격 `count`(기본 4)건. 기존 출발일과 겹치면 건너뛰어 `@@unique([productId, departureDate])` 충돌을 피한다.
- 실행: 기본 DRY-RUN, `--apply` 시 **단일 Tx 안에서 재조회 → 재계획 → `createMany({ skipDuplicates: true })`**. 미래 출발편이 생긴 상품은 다음 계획에서 빠지므로 재실행은 0건(멱등).
- 계획 로직은 순수 함수 `planTopUp`/`hasBookableFuture` 로 분리해 단위 테스트가 SSOT.

```ts
const plan = planTopUp(await loadPublished(tx), now, opts); // 미래 예약가능 출발편 없는 상품만
await tx.departure.createMany({ data: plan.map(toRow), skipDuplicates: true });
```

로컬 실행 실적(2026-10-20): PUBLISHED 20건 중 해당 1건(폴백 경로) → 4건 생성 → "오늘 이후 예약가능 출발편 0건 PUBLISHED 상품" **1 → 0**, 재실행 시 "보충할 상품 없음".

## Consequences (결과)

**얻은 것:**
- 예약·결제가 달린 출발편과 그 일정이 불변 — 좌석(`bookedSeats`)·금액 스냅샷·booking/payment 도메인에 접촉 0.
- 출발편이 0건인 상품까지 복구.
- 과거 출발편 이력이 그대로 남아 리뷰·예약 내역의 시간축이 보존된다.
- 신규 행은 `bookedSeats=0`/`SCHEDULED` 라 정상 예약 경로(`reserveSeats` 조건부 차감)를 그대로 탄다.

**포기한 것 / 미해결:**
- 과거 출발편은 계속 쌓인다(데모 데이터 규모라 무시 가능).
- 폴백 가격은 아동=성인 동일가(할인율을 지어내지 않음). 실제 운영 상품이라면 관리자가 Departure CMS 에서 조정해야 한다.
- 여전히 수동 실행이다. 다음 노후화 시점(마지막 보충일 + 간격×건수 ≈ 2개월)에 재실행 필요.
- `DRAFT`·`CLOSED` 상품은 사이트 미노출이라 의도적으로 제외 — 이들의 "미래 출발편 0건" 수치는 0이 되지 않는 것이 정상.

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: shift-departures.ts(전체 이동) 계속 사용
- 모든 Departure 날짜를 같은 일수만큼 미룸.
- 거부: 예약이 달린 출발편 일정까지 바뀌고(실서비스였다면 고객 여행일 무단 변경), 출발편 0건 상품은 복구 불가. 스크립트는 원복 수단으로 남겨 두되 1순위 복구 절차는 보충으로 교체.

### 옵션 B: 재시드(`npm run db:seed`)
- 거부: 비-시드 상품·예약·임베딩을 지운다(CLAUDE.md §8 노트에 이미 금지로 박제).

### 옵션 C: 앱 런타임에서 자동 롤링(cron 으로 매일 보충, 또는 조회 시 가상 출발편 생성)
- 거부: 가상 출발편은 좌석·결제 무결성(실재하는 Departure 행에 대한 조건부 차감)과 충돌. cron 자동 생성은 "데모 데이터 유지"라는 운영 편의를 제품 도메인 로직으로 끌어들이는 것이고, 실제 여행사라면 출발편 개설은 사람의 상품 결정이다. 수동·명시적 스크립트가 맞는 계층.

### 옵션 D: `ProductCard` 배지 조건 완화(과거 출발편 가격도 표시)
- 거부: 증상만 가리고 예약 불가는 그대로. 존재하지 않는 일정을 판매하는 것처럼 보이게 만든다.

## Notes

- 운영 실행 절차는 shift-departures 와 동일(CLAUDE.md §8 "데모 출발일 노후화" 노트): env pull → Session pooler URL 직접 기입 → dry-run 으로 `DB host` 확인 → `--apply` → env 파일 삭제. 에이전트가 운영 DB 에 직접 붙지 않는다.
- 되돌리기: 출력된 상품·날짜의 신규 Departure 를 삭제(예약이 붙기 전이라면 안전). 예약이 붙은 뒤에는 일반 출발 취소 cascade([ADR-0028]) 경로를 탈 것.
- 반영 지연: 홈 ≤5분, PDP ≤1시간(`use cache`), 체크아웃 즉시.
