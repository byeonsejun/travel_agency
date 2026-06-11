# ADR-0051: 자체 Postgres RUM 파이프라인 + 원시 이벤트 30일 보존(읽기시점 p75 집계) — 외부 SaaS 거부

- **상태**: Accepted
- **결정일**: 2026-06-11
- **영향 범위**: `src/features/rum`, `src/app/api/rum`, `src/entities/analytics/api/rum.ts`, `src/shared/lib/rum-cleanup`, `src/widgets/admin-dashboard/ui/PerformancePanel.tsx`, `prisma/schema.prisma`(`WebVitalEvent`)
- **관련 commit**: `c936436`(collector) · `b9d0cb1`(read-model) · `1a2a6f6`(reporter) · `f08ea9e`(cleanup) · `13b00e2`(panel)
- **연계**: Milestone 5 Phase 5-A. spec `docs/superpowers/specs/2026-06-11-rum-and-cache-modernization.md`. 후속 5-C(Cache Components 이전)가 이 baseline을 소비.

## Context (배경)

Milestone 5의 핵심은 6개 ADR([ADR-0009]/[ADR-0012]/[ADR-0015]/[ADR-0017]/[ADR-0018]/[ADR-0020])이 "PPR experimental"을 이유로 미뤄온 Cache Components 이전이다. 그런데 이 프로젝트는 **체감 성능(LCP/INP/CLS)을 한 번도 실측한 적이 없다** — 모든 캐시 정책이 *추정*에 기반한다. 캐시 이전은 본질적으로 성능 최적화인데, 계측기 없이 최적화하면 "체감상 빨라진 것 같다"는 보고로 귀결되어 [§5 QA] "이론적으로 동작" 금지 규칙과 충돌한다.

따라서 캐시 이전 *이전에* RUM(Real User Monitoring)을 먼저 구축해 baseline을 박제해야 한다. 문제는 두 가지 설계 결정이었다: **(1) 수집 데이터를 어디에 둘 것인가** — 이미 Sentry SDK([ADR-0021])가 깔려 있어 무임승차가 가능했다. **(2) 어떤 입도로 저장할 것인가** — 매 페이지 로드가 5개 메트릭을 보내므로 무한 성장과 분위 통계 정밀도 사이의 트레이드오프가 있었다.

## Decision (결정)

**(1) 자체 Postgres 파이프라인.** `WebVitalEvent` 테이블에 원시 적재 → `entities/analytics`의 `$queryRaw`가 `percentile_cont`로 집계 → 어드민 대시보드 "성능" 패널. 외부 SaaS 의존 0.

**(2) 원시 이벤트 + 읽기시점 집계 + 30일 cron 정리.** 사전 집계(롤업) 없이 원시 행을 보존하고, 조회 시점에 분위를 계산:

```sql
SELECT metric, percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75, COUNT(*)
FROM "WebVitalEvent" WHERE "createdAt" >= NOW() - INTERVAL '7 days' GROUP BY metric
```

`route`는 `normalizeRoute` 순수함수로 템플릿(`/products/[id]`)만 저장(cardinality 제어), PII(userId/IP)는 미저장.

## Consequences (결과)

**얻은 것:**
- **데이터 주권 + 상관분석**: 매출·취소·성능이 한 대시보드(`entities/analytics`)에 공존 → "캐시 변경이 LCP를 개선했나"를 우리 SQL로 직접 질의.
- **분위 통계 정밀도**: 원시 분포 보존 → p75/p95/임의 분위를 사후 자유롭게 재계산. Phase 5-C before/after 비교가 근사 오차 없이 정확.
- **외부 의존 0 + 재사용**: `next/web-vitals`(Next 내장)·기존 cron 디스패처([ADR-0005])·rate-limit hybrid([ADR-0022]/[ADR-0023])·Recharts 리프([ADR-0033]) 전면 재사용 → 신규 인프라 발명 0.
- **비가역 baseline 확보**: 캐시 이전 *전*의 실사용자 성능을 박제 — 한 번 지나가면 소급 불가한 자원을 선점.

**포기한 것 / 미해결:**
- 구축 비용(테이블+route+패널+cron)을 지불. 단 "측정 루프를 우리 시스템에 내재화"가 마일스톤의 목적이라 비용이 곧 가치.
- 데이터가 커지면 원시 풀스캔 `percentile_cont`가 느려질 수 있음 → 그 시점에 증분 롤업(별도 에픽) 도입 여지. 현재 저트래픽 + 30일 보존으로 충분.
- 성능 퇴행 자동 경보(Slack 등)는 미구현(후속 백로그).

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: Sentry로 Web Vitals 전송 (거부)
- 이미 깔린 Sentry SDK의 performance/Web Vitals로 전송 — 구축 최소.
- **거부 이유**: 데이터가 Sentry UI에 *분리 거주* → 대시보드 reporting 루프와 단절되어 "캐시 변경이 LCP를 개선했나"를 우리 SQL로 답할 수 없다. 파이프라인 소유/학습 가치 0, 벤더 종속. **역할 분리**로 정리: Sentry는 에러(예외적 사건) 도구로 계속 사용, 성능 분포(상시 집계)는 우리 대시보드가 담당.

### 옵션 B: Vercel Speed Insights (거부)
- `@vercel/speed-insights` 제로 빌드.
- **거부 이유**: 외부 SaaS 종속 + 데이터 우리 밖 + 무료 티어 한도/락인. "자체 파이프라인 구축"이라는 아키텍처 도약 목적과 정면 배치.

### 옵션 C: 사전 일별 롤업(증분 집계) (거부 — 조기 최적화)
- 수집 시 즉시 route×메트릭×일자 버킷으로 집계(t-digest/근사 p75). 테이블이 영구적으로 작음.
- **거부 이유**: p75는 **평균·합계로 역산 불가능한 분위 통계**라, 롤업이 분위를 버킷으로 근사하면 Phase 5-C에서 "LCP p75 2.8s→2.3s" 같은 미세 개선 판정 시 근사 오차가 신호를 삼킬 수 있다. 이 마일스톤의 *유일한 성공 판정 도구*인 RUM의 정밀도를 조기 최적화로 깎는 것은 본말전도. **원시 보존이 정밀도를, 30일 cron이 성장을** 각각 담당. 증분 롤업은 풀스캔이 실제로 느려질 때 도입할 별도 영역(책임 중복 회피, YAGNI).

## Notes

- **30일 선택 근거**: (a) Phase 5-A→5-B→5-C 전 구간(수 주)을 덮어 before/after 윈도우 확보. (b) 저트래픽에서 원시 30일은 풀스캔 `percentile_cont`를 빠르게 유지하는 상한. (c) PII 0이라 장기보관 규제 부담은 없으나 무한보관은 "정리 cron 부재" 방치와 동일 → 명시적 보존 정책으로 경계. `RETENTION_DAYS`는 노브가 아닌 상수(`rum-cleanup/worker.ts` 단일 지점).
- **value가 `Float`인 이유**: Web Vitals는 측정량(ms; CLS만 무차원). [§5] "가격·금액 float 금지"는 **돈에 한정**이며 계측값엔 무관(모델 주석 박제).
- **monitoring 지표**: `WebVitalEvent` 행 증가율, route 카디널리티(`/(other)` 버킷 비율이 높으면 `normalizeRoute` 규칙 누락 의심).
- **6개월 뒤 의심받을 점**: "왜 Sentry 두고 자체 구축?" → 역할 분리(에러 vs 성능 분포) + 대시보드 상관분석 주권. "왜 롤업 안 함?" → 분위 통계 정밀도 + YAGNI(옵션 C).
- 후속: Phase 5-C 완료 시 before/after 결과를 별도 ADR로 박제하며 보류 6개 ADR을 supersede 예정.
