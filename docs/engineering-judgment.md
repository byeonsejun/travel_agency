# 코드는 AI가, 판단은 내가 — 일곱 개 결정의 회고

나는 프론트엔드 개발자다. 이 프로젝트에서 나는 검색 랭킹(pgvector 가중합), 2-phase 결제 saga, 인가 경계, 이벤트 소싱 타임라인까지 닿았다. 그 구현의 상당 부분을 AI로 빠르게 만들었다 — sweep eval 하네스, judge 라벨러, 환불 워커. 숨길 이유가 없다.

**차별점은 거기가 아니다.** AI는 옵션과 구현과 측정 도구를 빠르게 내놓는다. 하지만 *무엇을 만들고 무엇을 안 만들지*, *어디에 덫이 있는지*, *무엇을 정직하게 갭으로 남길지*는 내가 결정했다. 코드는 빠르게 닿되, 그 위의 판단은 내가 했다.

이 글은 그 판단 일곱 개를 관통한다. 각 결정은 ADR로 박제돼 있고(E2E는 ADR 없이 커밋으로), ADR은 다시 커밋·코드 라인으로 추적된다 — 주장이 아니라 사실 위에 서도록.

> 사슬: **이 글 → ADR → 커밋/코드 라인**. 모든 수치는 커밋 본문이나 코드에서 확인된 것이다.

---

## 1. 만들 수 있었지만, 안 만든 것

만드는 건 쉽다. 안 만드는 데에 판단이 든다.

### 검색 가중치 — sweep "1등"을 운영에 박지 않은 이유

검색 점수는 `vector 0.5 / keyword 0.2 / geo 0.2 / theme 0.1` 4축 가중합이다. AI로 286개 가중치 격자를 전수 평가하는 nDCG sweep 하네스를 금방 짰고, sweep 1등 설정(벡터를 0.1로 굶긴 조합)으로 바꾸는 건 상수 한 줄이었다.

안 바꿨다. 근거가 빈약했기 때문이다.

- golden 10쿼리는 nDCG가 다수 1.000으로 **포화**돼 가중치 우열을 변별하지 못했다.
- 1등의 이득은 **+0.0099(상대 1.1%)** — 작은 라벨셋의 측정 노이즈에 묻힌다.
- 결정적으로, top 동률 4건이 *전부 벡터를 굶긴* 방향이었다. 코퍼스가 실제 지지하는 차원만 자극하는 45쿼리 카탈로그로 측정을 확장하자 그 **동률 4 → 0**으로 사라졌다. "1등"은 작은 셋에 과적합된 신호였다.

대신 *측정 도구*를 확장했다(baseline 순위 **64/286 → 120/286**, pure-semantic 슬라이스 **0.61**로 벡터 약점이 비로소 노출). 가중치 SSOT(3중 미러)는 **0줄** 변경. 코퍼스 20건 = 카탈로그 전체라는 대표성 한계도 알고 적었다 — 측정은 했으나 교정은 보류.

판단: *작은 라벨셋의 1등을 운영에 박는 것은 최적화가 아니라 과적합이다.* AI가 1등을 가리켜도, 그 1등이 믿을 만한지는 내가 판단한다.

→ [ADR-0054: 검색 가중치 튜닝 보류](./superpowers/adr/0054-search-weight-tuning-deferred.md)

### 결제 만료 cron — 안 만든 것을 "있어 보이게" 두지 않았다

`Booking.paymentDueAt` 컬럼과 인덱스가 스키마에 있다. 미결제 예약을 만료시켜 좌석을 환원하는 워커를 위한 자리다. 그 cron을 짜는 건 어렵지 않다.

안 만들었다. 결제가 실거래까지 가지 않는 데모 단계라(NO-REAL-MONEY) 미결제 점유로 인한 매진 손실 압박이 0이고, 만료 취소는 단순 cron이 아니라 *좌석 환원 보상 + 멱등 + 상태전이 가드*가 얽힌 saga라 스코프가 크다(출발취소 cascade와 동형).

중요한 건 **안 만든 걸 숨기지 않은 것**이다.

- 전역 grep으로 `paymentDueAt`의 set/read 실행 코드가 **0건**임을 확인.
- cron dispatcher의 워커는 **4종**(refund / email / embedding / rum-cleanup) — 결제 만료 워커는 없다.
- 그래서 좌석 hold에는 TTL이 없다. 이걸 *known gap*으로 ADR에 박제했고, 프론트에 **가짜 TTL 카운트다운도 만들지 않았다** — 백엔드에 만료 기준이 없으니 카운트다운은 거짓이 되기 때문이다.

판단: *미구현을 기능처럼 위장하지 않는다.* 컬럼은 미래의 자리로 보존하되, "왜 안 도는가"를 문서가 답하게 했다.

→ [ADR-0056: 결제 만료 cron 미구현 — known gap](./superpowers/adr/0056-payment-expiry-cron-known-gap.md)

**같은 결의 작은 결정 하나 더 — SMS/카카오 알림.** 이건 *사업자등록 + 발신번호 사전등록 + 건당 과금*이 전제라, 데모 환경에선 실제 발송이 동작함을 증명할 수 없고 데모 가치도 0이다. 그래서 의도적으로 뺐다 — 0054(가중치)·0056(cron)과 같은, *제약을 모르고 빠뜨린 게 아니라 제약을 알고 스코핑한다*는 패턴이다.

---

## 2. 미묘한 덫을 알아본 설계

AI가 만들어주는 코드는 종종 *그럴듯하게 틀린* 함정을 품는다. 함정을 알아보는 게 일이다.

### LLM-judge가 자기 점수를 베끼지 못하게

45쿼리 카탈로그에는 수동 라벨이 없다. 라벨을 LLM에 맡기는 건 쉽다 — 그리고 거기에 덫이 있다.

judge가 임베딩 코사인 유사도(=점수공식의 핵심 입력)를 보고 라벨을 매기면, 그 라벨로 잰 nDCG는 *"점수공식이 자기 자신을 얼마나 잘 맞히나"*를 재는 **자기참조 지표**로 전락한다. 그러면 가중치 비교 자체가 무의미해진다.

그래서 judge를 상품 *속성*(태그·목적지·기간·가격)만 보게 두고, `임베딩/embedding/코사인/cosine/벡터/vector/유사도` 어휘를 프롬프트·payload에서 금지했다. 이 반순환성을 **단위 테스트로 강제**한다:

```ts
// judgeRubric.test.ts:17-18 — 프롬프트에 점수공식 어휘가 없음을 강제
const forbidden = /임베딩|embedding|코사인|cosine|벡터|vector|유사도/i;
expect(JUDGE_SYSTEM_PROMPT).not.toMatch(forbidden);
// :38 — judge에 건네는 후보에 embedding 속성 부재
expect(payload.candidates[0]).not.toHaveProperty("embedding");
```

judge↔수작업 라벨 일치도는 **within1 81.3% / exact 37.5%** (등급 척도 보수성 차이 — 순위 변별용으로 충분).

판단: *AI가 만든 라벨이 측정을 오염시키는 순환을 구조적으로 차단한다.* 편의를 위해 유사도를 judge에 건네는 순간 측정은 거짓말이 된다.

→ [ADR-0055: LLM-judge 반순환 라벨링](./superpowers/adr/0055-llm-judge-non-circular-labeling.md)

### 인가는 ID 비밀이 아니라 소유권이다

마이페이지 예약 카드에 CUID 뒤 8자리(`orl83p21`)가 "예약 ID"로 보인다. 덫: 이 짧은 값이 조회 키라면, 짧은 식별자의 추측·열거가 보안 경계가 된다 — 전형적인 *security by obscurity*.

코드로 확정했다. 잘린 ID는 `slice(-8)` **표시용 라벨**이고, 라우트와 조회는 전체 CUID에 **소유권 스코프**를 건다:

```ts
// queries.ts — 고객 조회는 전부 userId 스코프
getBookingById / getBookingForRetry / getBookingDetail : where { id, userId }
listMyBookings                                          : where { userId }
// admin 은 의도적으로 userId 를 빼고 역할 게이트에 의존
getAdminBookingDetail                                   : where { id }
```

타인 예약 접근은 *"ID를 못 맞혀서"*가 아니라 *"`userId` 스코프가 그 행을 안 돌려줘서"* 막힌다. 상세·후기 링크는 전체 CUID를 쓰고, 잘린 suffix를 조회 키로 쓰는 곳은 0건이다.

판단: *인가는 "누가 요청했나"로 판단하고, 식별자는 표시로 둔다.* 짧은 ID를 비밀처럼 다루는 모델을 거부했다 — 로그·스크린샷으로 새는 순간 그게 곧 접근권이 되니까.

→ [ADR-0057: 접근통제 = 소유권 인가(ID 비밀성 아님)](./superpowers/adr/0057-access-control-ownership-not-id-secrecy.md)

---

## 3. 정직하게 남긴 갭

가장 어려운 판단은, 잘한 것을 과장하지 않는 것이다.

### admin도 raw reason을 못 본다 — "분리"가 아니라 "일원화"

예약 상태 타임라인의 `reason`에는 두 종류가 섞인다: 사람이 입력한 것(고객·관리자 취소 사유)과, 시스템이 기록한 내부 문자열(`tossPaymentKey=...` 같은 결제 키). 후자를 고객 화면에 노출하면 내부 식별자가 샌다.

그래서 시스템 actor의 reason을 숨겼다:

```ts
// BookingEventTimeline.tsx:37
const showReason = ev.reason && !ev.actor.startsWith("system:");
```

여기서 **정직해야 할 부분**이 있다. 이 타임라인은 (site) 고객 상세와 (admin) 상세가 **공유하는 단일 컴포넌트**다. 그래서 고객용 필터가 admin에도 그대로 걸린다 — **admin도 현재 raw 시스템 reason을 보지 못한다.**

이건 "고객/admin 권한별 노출 분리"가 **아니다.** 노출 수위가 두 갈래로 나뉜 게 아니라, 둘 다 *안전 기준 하나로 일원화*된 상태다. surface별 분리(audience prop)는 의도적으로 보류했다 — 데모에서 admin이 raw를 꼭 봐야 할 검증된 필요가 없어 *안전 기본값*을 택했다.

나는 이걸 "권한별 노출 분리를 구현했다"고 쓰지 않는다. ADR Notes에 *"그렇게 서술하면 틀린다"*고 못박아 뒀다. 포트폴리오에서 한 일을 부풀리는 건 쉽지만, 코드와 어긋나는 서술은 신뢰를 통째로 깎는다.

판단: *정직한 갭은 위장한 완성보다 강하다.* 무엇이 일원화고 무엇이 분리인지를, 코드 그대로 적는다.

→ [ADR-0058: 이벤트 reason 노출 — 안전 수위 일원화(분리 아님)](./superpowers/adr/0058-event-reason-exposure-unified-safe-level.md)

---

## 4. 어디에 견고함을 쓸지, 무엇이 진짜 문제인지

rigor는 비싸다. *어디에* 쓸지 정하는 절제와, 받은 요구가 *진짜* 문제인지 되묻는 것 — 둘 다 판단이다.

### E2E — 망라가 아니라 돈·인증 경로에만

단위테스트 **1298개**가 전부 통과하는 상태에서도, 홈 히어로의 패럴랙스가 죽는 버그는 **수동으로** 발견됐다. 원인은 stale `requestAnimationFrame` ref였다 — cleanup이 `cancelAnimationFrame`만 하고 `frame.current`를 `null`로 리셋하지 않아, 재마운트(Strict Mode 더블 인보크 / PDP 왕복 네비) 시 다음 effect가 non-null ref를 물려받고 `frame.current === null` 게이트가 영구 차단됐다. pointermove·scroll은 fire하지만 apply가 한 번도 안 불린다. 순수 함수엔 강한 단위테스트가 rAF·remount 같은 런타임 DOM 거동은 못 잡는다는 걸 코드로 본 순간이었다.

대응은 *모든 걸 E2E로 덮는 것*이 아니었다. 틀리면 가장 비싼 경로 — **돈(결제)과 인증** — 에만 Playwright 스모크 2개를 깔았다.

- `checkout.spec`: 홈 → PDP → 체크아웃 → 결제(devFallback) → confirm(Mock 토스 200) → 예약 **PAID**.
- `auth-gate.spec`: 미인증 `/mypage` → `/login` 리다이렉트.

그것도 멱등·**자기정리**다. 테스트가 만든 예약을 여행자 마커(`ETESTSMOKE`)로 결정적 식별해 teardown(`purgeE2EBookings`)에서 딸린 행과 함께 회수하고, 점유한 좌석은 `reserveSeats`가 `+N` 한 만큼 `release = -N`으로 정확히 **역분개**한다 — 전체를 다시 세는 snapshot-recompute가 아니라(그러면 시드 phantom 점유까지 지워진다). `GREATEST(0, …)` floor로 하한을 막아, 실행 전후 43개 departure 좌석이 **net-zero**다. src·스키마 diff 0. 그리고 이 작업에서 처음으로 prod 빌드 검증(홈 `○` — 완전 정적)까지 닫았다.

판단: *rigor는 망라가 아니라 배치다.* 비싼 경로에 집중하고, 그 테스트가 dev DB를 오염시키지 않게 역분개로 닫는다.

→ 커밋 `468d91e`(스모크 추가) · `1cedefc`(자기정리 teardown) · `398af0a`(패럴랙스 stale-rAF fix) · `tests/e2e/{checkout,auth-gate}.spec.ts`

### cascade — "위약금 옵션"을 "원장 정합화"로 재정의

시작은 단순한 요구였다: *"출발취소에 위약금 옵션을 추가해달라."* 조사하니 그게 도메인적으로 틀렸다. 출발취소(`startDepartureCancellation`)는 **사업자 귀책** 취소라 고객 **전액환불**이 옳고, 위약금은 고객 *자가취소* 경로에만 적용된다. 즉 위약금 인프라(`computePenalty`, `RefundJob.penaltyAmount`)를 의도적으로 **우회하는 cascade의 기존 설계는 옳았다** — 여기엔 고칠 게 없었다.

진짜 결함은 숨어 있었다: **원장 비대칭.**

saga 환불 경로(`refund.ts:65`)는 enqueue Phase 1에서 `reserveRefund`로 `Payment.refundedAmount`를 환불액만큼 미리 예약한다. 그런데 cascade의 `enqueueRefundJob`은 이 reserve를 **건너뛰고** `RefundJob` 행만 만들었다 → 전액환불이 끝나도 `refundedAmount`가 **0에 머물렀다.**

여기에 잠복 버그가 있었다. cron 영구실패 경로(`refundRetry.ts:185`)는 `releaseRefund(job.amount)`로 예약을 되돌린다. reserve를 한 적 없는데 release만 실행되면 `refundedAmount`가 `0 → 음수`로 떨어져 불변식 `0 ≤ refundedAmount ≤ amount`를 깬다. **reserve=차변 / release=대변, 복식부기처럼 둘은 반드시 짝을 이뤄야 하는데 cascade는 대변만 있는 한쪽 장부였다.**

고침은 enqueue Tx 안(PG 호출 전)에 `reserveRefund` **한 곳**을 추가해 saga Phase 1을 그대로 미러한 것이다. 잔여 환불가능액(`payment 총액 − refundedAmount`)만 예약하므로 정상 케이스(`refundedAmount=0`)는 전액과 동일 → **환불 결과 불변**(전액환불·`CANCELED`·좌석 환원), 부분환불 잔액이 있으면 잔여만 예약해 **과환불도 차단**. settle·좌석 환원·전이·`releaseRefund`는 **0줄** 변경 — reserve가 생겨 release와 비로소 짝이 맞는다. TDD red→green으로, 회귀 가드 `cascadeRefundLedgerSymmetry.test.ts`가 "reserve 없는 release = 음수"를 명시적으로 박제하고 reserve(전액)→release(전액)=0(음수 아님) 대칭을 고정한다.

판단: *받은 요구를 그대로 구현하지 않는다.* "위약금 옵션"은 도메인적으로 틀린 출발점이었고, 진짜 문제는 그 조사 과정에서 드러난 원장 비대칭이었다. 요구를 올바른 작업으로 재정의하는 것이 일이다.

→ [ADR-0059: cascade 환불 원장 비대칭 해소(saga Phase 1 reserve 미러)](./superpowers/adr/0059-cascade-refund-ledger-symmetry.md)

---

## 마무리

일곱 결정의 공통점은 하나다. **AI로 옵션·구현·측정 도구를 빠르게 만들되, 무엇을 채택·보류·거부하고 어디에 덫이 있는지의 판단은 내가 내렸다.**

- 만들 수 있었지만 안 만들었다 — sweep 1등(과적합)도, 결제 만료 cron(스코프·데모 가치)도, SMS/카카오 알림(증명 불가)도.
- 그럴듯한 함정을 알아봤다 — judge의 자기참조 순환도, ID 비밀성이라는 잘못된 보안 모델도.
- 잘한 것을 과장하지 않았다 — "일원화"를 "분리"로 부르지 않았다.
- 어디에 견고함을 쓸지 정하고, 틀린 요구를 진짜 문제로 재정의했다 — E2E는 돈·인증 경로에만, cascade는 "위약금 옵션"이 아니라 원장 정합화로.

프론트엔드 개발자가 AI로 검색 랭킹·인가·인프라까지 닿는 일은 점점 흔해진다. 그것 자체는 차별점이 아니다. 차별점은 *그 위에 판단을 얹을 수 있는가* — 측정이 거짓인지 알아보고, 안 만들 것을 정하고, 갭을 정직하게 남기는 능력이다. 코드는 빠르게 닿되, 책임지는 판단은 사람이 한다.

이 글의 모든 주장은 ADR로, ADR은 커밋과 코드 라인으로 이어진다.

→ **[전체 결정 기록: ADR 인덱스 (0001–0060)](./superpowers/adr/README.md)**
