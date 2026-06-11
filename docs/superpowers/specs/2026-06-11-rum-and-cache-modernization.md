# RUM & Cache Modernization — Milestone 5 종합 아키텍처 스펙

- **작성일**: 2026-06-11
- **상태**: Approved (설계 확정 — 구현 plan 도출 대기)
- **마일스톤**: Milestone 5 ("측정 → 현대화" — 캐시 코어 + 프레임워크 버전 도약)
- **관련 ADR(청산 대상, 보류된 PPR 결정)**: [ADR-0009] · [ADR-0012] · [ADR-0015] · [ADR-0017] · [ADR-0018] · [ADR-0020]
- **연계 인프라**: 분석 read-model([ADR-0032]/[ADR-0033]), cron 디스패처([ADR-0005]), Rate Limit hybrid([ADR-0022]/[ADR-0023]), Sentry([ADR-0021]), CSP 경로별 nonce([ADR-0025])
- **발행 예정 ADR(이 마일스톤이 낳을 결정)**: RUM 자체호스팅 vs SaaS 선택 / Next 16 + Cache Components 전환 / `unstable_cache`→`use cache` 무효화 태그 이관

---

## 0. 요약 (TL;DR)

이 프로젝트는 **PPR(Partial Pre-Rendering) 도입을 6개 ADR에 걸쳐 "experimental이라 보류"로 미뤄왔다.** Next가 Cache Components(`use cache` / `cacheLife` / `cacheTag` / PPR)를 stable로 승격시키면서 그 보류 사유가 소멸했다. 동시에, 우리는 **성능을 한 번도 실측한 적이 없다** — 모든 캐시 정책([ADR-0009]/[ADR-0020])이 *추정*에 기반한다.

Milestone 5는 이 둘을 한 번에 푼다. 단, **측정 없이 최적화하지 않는다**는 원칙에 따라 순서를 강제한다:

> **Phase 5-A (RUM, Next 15)** → **Phase 5-B (Next 16 업그레이드)** → **Phase 5-C (Cache Components 이전)**

RUM(Real User Monitoring)을 **먼저 Next 15에서** 구축해 현행 ISR/`force-dynamic` 모델의 실사용자 성능 **baseline**을 박제한 뒤, Next 16으로 올리고 Cache Components로 이전하며 **같은 계측기로 before/after를 정량 비교**한다. 이 문서는 그 당위성·시퀀싱·트레이드오프를 박제하고, **Phase 5-A**를 구현 가능한 수준까지 상세화한다 (5-B/5-C는 후속 spec에서 상세화).

---

## 1. 업데이트의 당위성 — 왜 지금, 왜 6개 ADR을 깨우나

### 1.1 보류의 역사와 그 전제의 소멸

PPR/Cache Components 도입은 다음 결정들에서 **매번 같은 이유로 거부**되었다:

| ADR | 맥락 | 거부 사유(요약) |
|---|---|---|
| [ADR-0009] | 페이지 캐시 정책 옵션 A | PPR experimental — 안정성 미보장 |
| [ADR-0012] | 위시리스트 island | 동일 |
| [ADR-0015] | PDP ISR | 동일 |
| [ADR-0017] | PDP 캐시 시리즈 | 동일 |
| [ADR-0018] | 위시리스트 ISR 보존 | 동일 |
| [ADR-0020] | 데이터 레이어 `unstable_cache` + 무효화 컨트랙트 SSOT | 동일 — "PPR stable 승격 시 시리즈 일괄 재논의" |

**[ADR-0020]은 명시적으로 "stable 승격 시 일괄 재논의"라는 트리거를 남겨두었다.** 그 트리거가 발동됐다. Cache Components는 더 이상 experimental이 아니며, `unstable_cache`는 공식적으로 **레거시 경로**가 되었다. 보류를 유지하는 것이 이제 *결정*이고, 그 결정은 기술 부채를 누적시킨다.

### 1.2 측정 부재 — 우리는 추정으로 캐싱해왔다

현행 캐시 정책은 정교하지만 **단 한 번도 실측되지 않았다**:
- 홈 ISR 5분 / PDP ISR 1시간 / 결제·예약·admin `force-dynamic` — 이 분배는 "안정성 민감 도메인은 dynamic"이라는 *원칙*에서 나왔지 *데이터*에서 나오지 않았다.
- 대시보드(`entities/analytics`)는 매출·취소·점유율은 측정하지만 **체감 성능(LCP/INP/CLS)은 사각지대**다.
- Sentry는 에러를 잡지만, 우리 대시보드의 reporting 루프와 분리돼 있어 "캐시 정책 변경이 실사용자 LCP를 개선했는가?"에 답하지 못한다.

Cache Components 이전은 본질적으로 **성능 최적화**다. 계측기 없이 최적화하면 "체감상 빨라진 것 같다"는 보고로 귀결된다 — 이는 [§5 QA Engineer] "이론적으로 동작할 것" 금지 규칙과 정면 충돌한다. **RUM은 이 마일스톤의 성공/실패를 판정하는 계측기다.**

### 1.3 타이밍 — 왜 하필 지금

- **검색 알고리즘 트랙이 닫혔다.** "일관성→문서화→알고리즘" 로드맵의 마지막 칸(하이브리드 검색 + 조건부 Haiku rerank + nDCG eval, [ADR-0045]~[ADR-0050])이 PR #24로 머지됐다. 다음 도약의 활주로가 비었다.
- **자산이 무르익었다.** 무효화 컨트랙트가 이미 `tagProductDetail` 같은 **태그 SSOT([ADR-0020])** 로 정리돼 있어, `unstable_cache` → `use cache` + `cacheTag` 이관의 매핑 대상이 코드에 명시돼 있다. 지금이 이관 비용이 가장 낮은 시점이다.
- **계측 인프라가 재사용 가능하다.** `entities/analytics`의 `$queryRaw` read-model([ADR-0032]) + Recharts client-leaf 격리([ADR-0033]) + cron 디스패처([ADR-0005])가 그대로 RUM 파이프라인의 뼈대가 된다 — 신규 인프라 발명 0.

---

## 2. 전략적 시퀀싱 — 의존성 제어와 RUM 선행의 논리

### 2.1 강제된 순서와 그 근거

```
Phase 5-A (RUM)              Phase 5-B (Next 16)         Phase 5-C (Cache Components)
Next 15 위에서 구축           메이저 업그레이드            unstable_cache/ISR → use cache + PPR
   │                            │                            │
   ▼                            ▼                            ▼
[BASELINE 박제]  ──────────▶  [업그레이드 안정화]  ────▶  [같은 계측기로 AFTER 측정]
실사용자 p75 LCP/INP/CLS                                   before/after 정량 비교 → ADR 박제
```

**왜 RUM이 Next 16 업그레이드보다 먼저인가 — 3가지 이유:**

1. **Baseline은 변경 *이전*에만 잡을 수 있다 (비가역성).** Next 16으로 올리고 Cache Components로 이전한 뒤에 RUM을 붙이면, 우리는 영원히 "개선 후"의 숫자만 갖게 된다. "이전 대비 얼마나 좋아졌나"는 측정 불가가 된다. **baseline은 한 번 지나가면 복원되지 않는 자원**이다. 따라서 RUM은 *가장 먼저* 박제되어야 한다.

2. **독립성 — RUM은 Next 16에 의존하지 않는다.** Web Vitals 수집은 Next 15의 `useReportWebVitals`(`next/web-vitals`)로 완결된다. RUM을 Next 16 *이후*로 미룰 기술적 이유가 없으며, 미루면 (1)의 baseline을 잃는다. 의존성 그래프상 RUM은 leaf이므로 가장 먼저 처리하는 것이 위상정렬상 옳다.

3. **리스크 격리.** Next 15→16 메이저 업그레이드는 회귀 표면이 넓다(전 라우트 재검토). RUM을 먼저 안정화하면, 업그레이드 도중·이후에 **회귀를 실시간으로 감지하는 안전망**이 이미 가동 중이다. 업그레이드로 LCP가 퇴행하면 RUM 패널이 즉시 드러낸다. 순서를 뒤집으면 업그레이드 회귀를 눈으로만 판단하게 된다.

### 2.2 각 Phase의 독립 사이클

각 Phase는 **독립 spec → plan → 구현 → 검증** 사이클을 갖는다. 이 문서는 Phase 5-A를 구현 가능 수준으로 상세화하고, 5-B/5-C는 **개략 설계 + 후속 spec 예고**만 담는다 (거대 단일 spec 분해 — 한 번에 하나의 검증 가능한 단위).

- **5-B/5-C를 지금 상세화하지 않는 이유**: Cache Components 이전의 구체 형태(어떤 라우트를 `use cache`로, 어떤 셸을 PPR 정적 프레임으로)는 **5-A가 수집한 baseline 데이터를 보고** 결정해야 한다. 데이터 없이 5-C를 상세화하면 또다시 추정 기반 설계가 된다 — 이 마일스톤이 깨려는 바로 그 안티패턴.

---

## 3. Phase 5-A — RUM 파이프라인 상세 설계

### 3.1 아키텍처 개요

```
[브라우저]                          [서버]                        [어드민]
useReportWebVitals (RSC layout)
   │ LCP/INP/CLS/TTFB/FCP
   ▼
normalizeRoute() + ratingFor()  ── 클라 순수함수 (cardinality 제어)
   │
   ▼ navigator.sendBeacon (fire-and-forget, unload-safe)
POST /api/rum ──▶ Zod 검증 + withRateLimit(fail-open) ──▶ db.webVitalEvent.create
                                                              │
                                                              ▼
                                              [Postgres] WebVitalEvent (raw, 30d)
                                                              │
                          entities/analytics 확장 ($queryRaw percentile_cont 0.75)
                                                              │
                                                              ▼
                                          admin /dashboard "성능" 패널
                                          (p75 카드 + 추이 차트 + route별 테이블)

[cron 디스패처] ──▶ rum-cleanup 워커: 30일 초과 이벤트 DELETE (멱등)
```

**설계 원칙 매핑**:
- 수집은 client island(`useReportWebVitals`)에 격리, `db` 접근은 서버 route handler에만 — server/client 경계 무손상.
- read-model은 `entities/analytics`가 **테이블만** `$queryRaw`로 조회(엔티티 모듈 import 0) — FSD 단방향 무손상([ADR-0032] 선례).
- 차트는 `'use client'` 리프에만, 서버가 집계한 plain 배열 props 주입([ADR-0033] 선례).

### 3.2 데이터 모델

```prisma
model WebVitalEvent {
  id        String   @id @default(cuid())
  metric    String   // "LCP" | "INP" | "CLS" | "TTFB" | "FCP"
  value     Float    // 측정값. ms 단위(CLS만 무차원 비율). ※ 금액 아님 — §5 float 금지는 돈에 한정, 계측값은 Float가 정확
  rating    String   // "good" | "needs-improvement" | "poor" (web-vitals 임계 기준)
  route     String   // 정규화된 경로 템플릿 (예: "/products/[id]") — 원시 pathname 저장 금지(cardinality 폭발)
  navType   String?  // "navigate" | "reload" | "back-forward" | "prerender"
  createdAt DateTime @default(now())

  @@index([metric, createdAt])         // p75 시계열 집계용
  @@index([route, metric, createdAt])  // route별 분해용
}
```

**모델 결정 박제**:
- `value`가 `Float`인 이유: Web Vitals는 측정량(ms, CLS는 무차원 누적 점수)이다. [§5] "가격·금액을 float로 표현 금지"는 **돈에 한정된 규칙**이며 계측값에는 적용되지 않는다(혼동 방지 — 명시 주석).
- `route`는 **정규화 템플릿만** 저장한다. `/products/abc123`, `/products/xyz789`를 그대로 저장하면 route 카디널리티가 상품 수만큼 폭발해 집계가 무의미해진다. 클라이언트가 `normalizeRoute(pathname)` 순수함수로 `/products/[id]`로 접어 보낸다.
- **PII 0**: userId·IP·세션을 저장하지 않는다. IP는 rate-limit에서 휘발적으로만 사용. RUM은 익명 집계 — CSP/보안 posture([ADR-0025]) 및 PII 암호화 원칙([ADR-0041])과 정합.

### 3.3 컴포넌트 분해

| 단위 | 위치(제안) | 책임 | 의존 |
|---|---|---|---|
| `WebVitalsReporter` (client island) | `src/features/rum/ui/` 또는 `widgets` | `useReportWebVitals`로 메트릭 수신 → 정규화 → sendBeacon | `next/web-vitals` |
| `normalizeRoute(pathname)` (순수) | `src/features/rum/model/` | 원시 pathname → route 템플릿. **SSOT, 단위테스트 대상** | 없음 |
| `ratingFor(metric, value)` (순수) | `src/features/rum/model/` | web-vitals 임계로 good/ni/poor 판정. **단위테스트 대상** | 없음 |
| `webVitalSchema` (Zod) | `src/features/rum/model/` | route handler 입력 검증 (별도 모듈 — "use server" async-only 규칙 회피) | zod |
| `POST /api/rum` (route handler) | `src/app/api/rum/route.ts` | Zod 파싱 + `withRateLimit` + `create`. 항상 `204`(fire-and-forget) | db, rate-limit |
| RUM read-model | `src/entities/analytics/api/` 확장 | `$queryRaw percentile_cont(0.75)` — p75/route별/추이. `unstable_cache(60s, tag:analytics:rum)` | db |
| `PerformancePanel` + 차트 리프 | `src/widgets/admin-dashboard/ui/` | p75 카드(Badge tone) + 추이(Recharts client leaf) + route 테이블(Table 프리미티브) | analytics barrel |
| `rum-cleanup` cron 워커 | cron 디스패처 확장 | 30일 초과 `deleteMany` (멱등) | db |

**경계 주의**: `WebVitalsReporter`는 client island이므로 `@/shared/lib/env` import 금지([feedback_client_safe_no_env_import]). `/api/rum` 엔드포인트 URL은 상대경로 고정이라 env 불요.

### 3.4 수집 전송 세부

- **트랜스포트**: `navigator.sendBeacon(url, body)` 우선 — 페이지 unload 중에도 전송 보장(INP/LCP는 종종 페이지 이탈 직전 확정). 미지원 시 `fetch(url, { keepalive: true })` 폴백.
- **배치**: `useReportWebVitals` 콜백은 메트릭별로 개별 발화 → 메트릭당 1 요청(저트래픽이라 배칭 불요, YAGNI). 추후 볼륨 증가 시 배칭은 후속.
- **샘플링**: 현 단계 **100% 수집**(저트래픽 포트폴리오). `RUM_SAMPLE_RATE` 같은 노브는 도입하지 않음(YAGNI) — 볼륨이 문제되면 그때 추가. 30일 cron 정리가 무한성장을 차단하므로 샘플링 불요.
- **CSP**: `/api/rum`은 same-origin이라 `connect-src 'self'`로 커버. 정적/동적 경로 분기([ADR-0025]) 무영향.

### 3.5 보안 / 남용 방지

`/api/rum`은 **공개·비인증 엔드포인트**이므로 남용 표면이다. 다층 방어:
1. **Zod 검증**: `metric`은 enum 5종, `value`는 유한 양수(CLS 상한 가드), `route`는 길이·패턴 제한, 미상 필드 거부.
2. **Rate Limit**: 기존 hybrid([ADR-0022]) 재사용 — `withRateLimit`로 IP당 관대한 한도(예: 60/min). Upstash 미설정 시 **fail-open 강등**([ADR-0023], 기존 패턴 동일).
3. **route 화이트리스트**: `normalizeRoute`가 알려진 템플릿 집합으로만 접으므로, 미상 경로는 `"/(other)"` 버킷으로 수렴 → 임의 문자열 저장 차단.
4. **응답 최소화**: 항상 `204 No Content`, 본문 없음 — 정보 노출 0, 클라는 응답을 기다리지 않음.

### 3.6 어드민 대시보드 "성능" 패널

- **p75 카드 3종**: LCP / INP / CLS의 p75 값 + good/needs-improvement/poor를 `Badge` tone(success/warning/destructive)으로 신호등 표시. (TTFB/FCP는 보조 지표 — 카드 아님, 테이블에만.)
- **추이 차트**: 일자별 p75 LCP/INP 라인(Recharts `'use client'` 리프 — [ADR-0033] 격리 준수). 기간 필터는 기존 대시보드 `DateRangePicker`(searchParams SSOT) 재사용.
- **route별 테이블**: route 템플릿 × 메트릭 p75 + 샘플 수, `shared/ui/table` 프리미티브(수제 `<table>` 금지, admin A1 규칙).
- **캐시**: `unstable_cache(revalidate:60, tags:["analytics:rum"])` — 기존 `TAG_DASHBOARD` 패턴 미러. Phase 5-C에서 `use cache`로 이관될 첫 후보.

### 3.7 cron 정리 (30일 보존)

- 기존 cron 디스패처([ADR-0005])에 `rum-cleanup` 잡 추가: `deleteMany({ where: { createdAt: { lt: now - 30d } } })`.
- **멱등**: 시간 기준 삭제라 재실행 안전(이미 삭제된 행은 no-op). 부분 실패 시 다음 tick이 수렴.
- 30일 선택 근거: §4 트레이드오프 참조.

### 3.8 테스트 전략 (TDD)

| 대상 | 유형 | 검증 |
|---|---|---|
| `normalizeRoute` | 순수 단위 | `/products/abc`→`/products/[id]`, 미상→`/(other)`, 동적 세그먼트 표 |
| `ratingFor` | 순수 단위 | web-vitals 임계 경계값(LCP 2.5s/4s, INP 200/500, CLS 0.1/0.25) |
| `webVitalSchema` | 단위 | enum 외 metric 거부, 음수/NaN value 거부, route 길이 초과 거부 |
| `POST /api/rum` | 통합 | 정상 204, 악성 payload 400, rate-limit 차단, Upstash 부재 fail-open |
| RUM read-model | 통합 | 시드 이벤트 → p75 정확도(percentile_cont), route별 분해 |
| `rum-cleanup` | 통합 | 30일 경계 삭제 + 멱등(2회 실행 동일 결과) |

순수함수 우선 TDD([§4] R5): `normalizeRoute`/`ratingFor`/스키마 → FAIL 확인 → 구현 → PASS.

---

## 4. 선택의 경로 및 트레이드오프 (Decision Records)

### 4.1 RUM 백엔드: 자체 Postgres vs Sentry vs Vercel Speed Insights

| 옵션 | 장점 | 거부/채택 사유 |
|---|---|---|
| **자체 Postgres 파이프라인 ✅채택** | 데이터가 우리 대시보드/read-model에 거주 → 매출·취소·성능을 *한 화면*에서 상관. 외부 의존 0. Phase 5-C before/after를 우리 SQL로 직접 질의. 인프라 100% 재사용([ADR-0032]/[ADR-0005]). | 구축 비용 존재(테이블+route+패널+cron). 그러나 이 마일스톤의 본질이 "측정 루프를 우리 시스템 안에" 내재화하는 것이라 비용이 곧 목적. |
| **Sentry로 전송 ❌거부** | 구축 최소(SDK 이미 존재). | 데이터가 Sentry UI에 *분리 거주* → 대시보드 reporting 루프와 단절, "캐시 변경이 LCP를 개선했나"를 우리 SQL로 답 못 함. 파이프라인 학습/소유 가치 0. 벤더 종속. |
| **Vercel Speed Insights ❌거부** | 제로 빌드(`@vercel/speed-insights`). | 외부 SaaS 종속 + 데이터 우리 밖. 자체 파이프라인 구축이라는 *아키텍처 도약* 목적과 배치. 무료 티어 한도/벤더 락인. |

**채택 결정**: 자체 Postgres. 이 선택의 핵심 트레이드오프는 **"구축 비용을 지불하고 데이터 주권·상관분석·파이프라인 소유를 얻는다"** — Sentry는 에러(예외적 사건) 도구, RUM은 분포(상시 집계) 도구로 **역할 분리**(Sentry는 에러 계속 담당, 성능 분포는 우리 대시보드). 이 결정은 ADR로 박제 가치 있음.

### 4.2 저장 입도: 원시 이벤트 + 읽기시점 집계 vs 사전 롤업

**채택: 원시 이벤트(메트릭당 1행) + 읽기시점 `percentile_cont(0.75)` 집계 + 30일 cron 정리.**

| 축 | 원시+읽기집계 ✅ | 사전 롤업 ❌ |
|---|---|---|
| **분포 보존** | 완전 — p75/p95/임의 분위 재계산 자유 | 손실 — 롤업 시 분위 고정(t-digest 근사). 사후 p95 질의 불가 |
| **before/after 정밀도** | 높음 — Phase 5-C가 동일 원천 분포로 정확 비교 | 낮음 — 근사 분위로 미세 개선 판별 어려움 |
| **구현 복잡도** | 낮음 — `$queryRaw` 한 줄(percentile_cont) | 높음 — 증분 집계기 + t-digest/버킷 머지 로직 |
| **테이블 성장** | 30일 cron으로 경계 (저트래픽이라 충분히 작음) | 영구 보관(작음) |
| **C 후보 중복** | 없음 | Candidate C(증분 롤업)와 책임 중복 — 조기 추상화 |

**트레이드오프 분석**: p75는 **평균/카운트로 재구성 불가능한 분위 통계**다. 사전 롤업이 p75를 버킷으로 근사하면, Phase 5-C에서 "LCP p75가 2.8s→2.3s로 개선"을 판정할 때 근사 오차가 신호를 삼킬 수 있다. 이 마일스톤의 *유일한 성공 판정 도구*가 RUM인데 그 정밀도를 조기 최적화로 깎는 것은 본말전도. **원시 보존이 정밀도를 주고, 30일 cron이 성장을 막는다** — 저트래픽 환경에서 원시 30일은 테이블이 작게 유지되므로 풀스캔 percentile도 실용 충분. 사전 롤업(증분 집계)은 *데이터가 커져 풀스캔이 느려질 때* 도입할 Candidate C의 영역이며, 지금 도입하면 YAGNI 위반 + 책임 중복.

**왜 30일인가**: (a) Phase 5-A→5-B→5-C 전 구간(수 주)을 덮어 before/after 비교 윈도우 확보. (b) 저트래픽에서 30일 원시는 풀스캔 percentile이 빠르게 유지되는 상한. (c) PII 0이라 장기 보관 규제 부담은 없으나, 무한 보관은 "정리 cron 부재" 방치와 동일하므로 명시적 보존 정책으로 경계. 30일은 노브가 아닌 상수(필요 시 단일 지점 변경).

---

## 5. Phase 5-B / 5-C 개략 (후속 spec 예고 — 지금 상세화하지 않음)

### 5-B. Next 15 → 16 메이저 업그레이드 (후속 spec)
- 공식 마이그레이션 가이드 + codemod 적용. `next.config.mjs`·Sentry 래퍼·미들웨어 호환성 점검.
- 회귀 안전망: 5-A의 RUM 패널이 업그레이드 전후 LCP/INP 퇴행을 실시간 감지.
- 검증: typecheck/test/build 그린 + RUM baseline 대비 무퇴행 확인.

### 5-C. Cache Components 이전 (후속 spec — 5-A 데이터 기반 설계)
- `unstable_cache` → `use cache` + `cacheTag` 이관. 무효화 SSOT([ADR-0020] 태그 맵)를 새 모델로 1:1 이관.
- 결제·예약 `force-dynamic` 셸을 PPR 정적 프레임 + 동적 hole로 재구성(체감 LCP 개선 목표).
- **before/after**: 5-A baseline 대비 RUM p75로 개선 정량화 → 결과를 ADR로 박제(보류 6개 ADR을 supersede).
- 상세 설계는 **5-A가 수집한 실데이터를 본 뒤** 별도 spec에서.

---

## 6. 비범위 (Out of Scope)

- Phase 5-B/5-C의 구현 상세 (각 후속 spec).
- RUM 알림/임계 경보(성능 퇴행 시 Slack 등) — 후속 백로그.
- 사용자 단위 성능 추적·세션 리플레이 — PII 0 원칙상 의도적 배제.
- 샘플링 노브, 배치 전송 최적화 — 볼륨이 문제될 때까지 YAGNI.
- 증분 롤업(Candidate C) — 풀스캔이 느려질 때까지 도입 안 함.

---

## 7. 리스크 & 완화

| 리스크 | 완화 |
|---|---|
| 공개 `/api/rum` 남용 | Zod + rate-limit(fail-open) + route 화이트리스트 + 204 최소응답 (§3.5) |
| route 카디널리티 폭발 | `normalizeRoute` 순수함수로 템플릿 접기 + 단위테스트 (§3.2) |
| client island env 누수 | `@/shared/lib/env` import 금지, 상대경로 URL ([feedback_client_safe_no_env_import]) |
| 테이블 무한 성장 | 30일 cron 정리(멱등) (§3.7) |
| Next 16 업그레이드 회귀 | RUM 선행으로 실시간 감지 안전망 가동 (§2.1-3) |
| baseline 유실 | RUM을 *가장 먼저* 박제 — 비가역 자원 (§2.1-1) |

---

## 8. 성공 기준 (Phase 5-A)

1. 실사용자 페이지 로드가 LCP/INP/CLS/TTFB/FCP를 `/api/rum`으로 전송하고 `WebVitalEvent`에 적재된다 (런타임 증거: curl/DB row).
2. 어드민 `/dashboard` "성능" 패널이 route별 p75를 신호등으로 표시한다.
3. `normalizeRoute`/`ratingFor`/스키마/route handler/read-model/cron 정리가 모두 테스트 그린.
4. typecheck/test/lint/build 그린, FSD·server/client 경계 위반 0.
5. **baseline 데이터가 누적되기 시작** — Phase 5-C의 before 측정값으로 사용 가능.

---

## 9. ADR 후보 (이 마일스톤이 박제할 결정)

- **RUM 자체호스팅 vs SaaS** (§4.1) — 데이터 주권/역할분리 결정. Phase 5-A 완료 시 발행 권고.
- **Next 16 + Cache Components 채택** — 보류 6개 ADR supersede. Phase 5-C 완료 시 발행.
- **원시 30일 + 읽기시점 집계** (§4.2) — Candidate C(롤업)와의 책임 경계. 5-A ADR에 포함 가능.
