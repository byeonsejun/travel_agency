# Phase 2 로드맵 — 인증·예약·결제·AI 검색

> **버전**: v1.0
> **작성일**: 2026-05-13
> **상위 문서**: [PRD](../../product/PRD.md), [ARCHITECTURE](../../technical/ARCHITECTURE.md)
> **선행 작업**: Phase 1(Product 표시 모듈) 완료 — `plans/done/2026-05-12-product-display.md`

---

## 0. 이 문서의 목적

Phase 2는 단일 spec으로 다루기에 너무 크다. 본 문서는 Phase 2의 **마스터 로드맵**으로서, 후속 모듈별 spec·plan이 따라야 할 다음 4가지를 확정한다:

1. 모듈 인벤토리와 **의존성 그래프**
2. **MVP 스코프**(범위/비범위)
3. **마일스톤 순서**(M1 → M4)
4. **리스크 레지스터** 및 후속 spec 발주 목록

세부 구현은 본 문서에 담지 않는다. 각 모듈은 별도 spec → plan으로 분리되어 발주된다.

---

## 1. Phase 2 목표 및 성공 지표

### 1.1 비즈니스 목표
사용자가 **상품 탐색 → 출발일 선택 → 결제 → 예약 확정**까지의 end-to-end 플로우를 완주할 수 있게 한다. AI 검색은 차별화 포인트로서 단순 키워드 검색을 넘어선 자연어 라우팅을 제공한다.

### 1.2 완료 정의 (Definition of Done)
- 비로그인 → 회원가입 → 로그인 흐름 작동(이메일+비밀번호)
- `/products/[id]`에서 출발일 선택 → 결제 → `/bookings/[id]` 확정 페이지 도달
- 토스페이먼츠 카드 결제 성공·실패 처리, 웹훅 멱등 처리
- 좌석 동시성 — 부하 시험에서 오버부킹 0건
- AI 자연어 검색이 `/search?q=...`에서 기존 키워드 검색 대비 의미 있는 결과 차이 노출
- 모든 새 페이지 typecheck·test 통과

### 1.3 비목표 (Phase 3로 이연)
- 소셜 로그인(카카오/구글) — Phase 2는 이메일+비밀번호만
- 다중 통화·다중 PG fallback — KRW + 토스페이먼츠 단일
- 부분 환불·포인트·기프트카드 — 전액 환불만
- 어드민 예약 관리 UI — 직접 DB 조회로 대체
- 실시간 추천·개인화 — 정적 추천(랜덤·최신·인기) 유지
- 모바일 앱 — 웹만

---

## 2. 모듈 인벤토리

| 코드 | 모듈 | 핵심 산출물 | 적용 스킬 |
|------|------|------------|----------|
| **M-AUTH** | 사용자 인증 | `entities/user`, `features/auth`, `/login`·`/signup` | enforce-fsd, clean-code-react |
| **M-BOOKING** | 예약 도메인 | `entities/booking`, 좌석 hold, 상태머신 | **booking-transaction-safety**, enforce-fsd |
| **M-PAYMENT** | 결제 연동 | 토스페이먼츠 SDK·웹훅, `entities/payment` | **booking-transaction-safety**, enforce-fsd |
| **M-CHECKOUT** | 체크아웃 UX | `features/checkout`, `/products/[id]/checkout`·`/bookings/[id]` | clean-code-react, enforce-fsd |
| **M-AI-SEARCH** | AI 검색 | pgvector 임베딩, 자연어 라우터, `/search` | clean-code-react |
| **M-CACHE** | 캐시 튜닝 | force-dynamic 해제, ISR/`revalidate` 도입 | clean-code-react |
| **M-OBS** | 관측·로깅 | 구조화 로그, 에러 트래킹, 결제·예약 이벤트 추적 | (모든 스킬) |

---

## 3. 의존성 그래프

```
M-AUTH ──────────┐
                 ▼
         ┌── M-BOOKING ──┐
         │               ▼
         │       M-PAYMENT (토스페이먼츠)
         │               │
         ▼               ▼
        M-CHECKOUT (UX 조합) ◄── 사용자 진입점
         │
         ▼
        M-OBS (예약·결제 이벤트 관측)

  M-AI-SEARCH ──┐  (독립, M-AUTH 무관)
                ▼
              /search 페이지

  M-CACHE ────► 모든 모듈 완료 후 마지막에 튜닝
```

### 핵심 제약
- **M-BOOKING은 M-AUTH에 의존**: booking 소유자가 user여야 함. 단, MVP는 게스트 예약 옵션 검토 가능(§5.1 참조).
- **M-PAYMENT는 M-BOOKING에 종속**: 결제는 항상 특정 booking에 attach.
- **M-CHECKOUT은 위 셋의 조합**: UX 레이어 통합.
- **M-AI-SEARCH는 완전 독립**: 병렬 진행 가능.
- **M-CACHE는 최후**: 캐시는 정합성 영향이 가장 크므로 다른 모듈 안정화 후.

---

## 4. 마일스톤 순서

### M1 — 인증 기반 (M-AUTH)
**선행조건**: 없음 (Phase 1 완료 후 즉시 시작)
**산출물**: 이메일+비밀번호 회원가입·로그인·로그아웃, 세션 쿠키, `/login`·`/signup` 페이지, RSC에서 `getCurrentUser()` 헬퍼 제공.
**완료 기준**: 비로그인 유저가 PDP 진입 시 "예약하려면 로그인" 안내 노출.

### M2 — 예약·결제 코어 (M-BOOKING + M-PAYMENT + M-CHECKOUT)
**선행조건**: M1 완료
**산출물**:
- `Booking`, `Payment`, `BookingEvent`, `PaymentEvent` Prisma 모델
- 좌석 hold(TTL 10분) + 2-phase 결제 흐름
- 토스페이먼츠 결제창 + 웹훅(`/api/payment/webhook`)
- 만료된 hold 정리 배치(cron 또는 on-demand)
- `/products/[id]/checkout` → 토스 결제창 → `/bookings/[id]` 확정 페이지
- 전액 환불 플로우(사용자 취소 → 자동 환불)
**완료 기준**: 동시 예약 부하 시험 통과(좌석 1개에 5명 동시 요청 → 1명 성공 + 4명 InsufficientCapacity).

### M3 — AI 검색 (M-AI-SEARCH)
**선행조건**: M2와 병렬 가능
**산출물**: `/search?q=...`, pgvector 기반 임베딩 검색, 자연어 라우터(가격대·기간·테마 추출), 결과 페이지 + 카드 리스트(Phase 1 컴포넌트 재사용).
**완료 기준**: "가족이랑 갈만한 동남아 휴양지 5박" 같은 쿼리가 의미 있는 결과를 반환.

### M4 — 캐시 튜닝 + 관측 (M-CACHE + M-OBS)
**선행조건**: M2, M3 완료
**산출물**:
- `/`, `/products`, `/products/[id]`의 `force-dynamic` 해제 → ISR(60s) 또는 `revalidateTag`
- 좌석 변동 시 `revalidateTag("product:{id}")` 호출
- 결제·예약 이벤트 구조화 로그(JSON), Sentry 또는 동급 도입
- 결제 실패율·hold 만료율 대시보드(외부 도구로 충분)
**완료 기준**: 평균 페이지 응답시간 측정 가능 + 결제 실패 발생 시 추적 가능.

---

## 5. MVP 스코프 (모듈별)

### 5.1 M-AUTH MVP
**범위**:
- 이메일+비밀번호 회원가입(zod 검증, bcrypt 해시)
- 로그인 → 세션 쿠키 (NextAuth.js v5 또는 iron-session)
- `getCurrentUser()` 서버 헬퍼 (RSC에서 호출)
- 로그아웃, 비밀번호 재설정(이메일 발송은 콘솔 로그로 대체)

**비범위**:
- 소셜 로그인 (Phase 3)
- 2FA, 이메일 인증 (Phase 3 — MVP는 가입 즉시 활성)
- 게스트 예약: **불허**. 모든 예약은 로그인 필수.
  - 결정 근거: 게스트 예약 도입 시 booking ownership 모델이 복잡해지고(`userId | guestEmail` union), 환불·문의 동선이 분기됨. MVP 단순성 우선.

### 5.2 M-BOOKING MVP
**범위**:
- 1 booking = 1 departure + N좌석(성인+아동 분리)
- 좌석 hold(`PENDING_PAYMENT` 상태, `holdExpiresAt = now + 10min`)
- 상태머신: `PENDING_PAYMENT → CONFIRMED → CANCELED | COMPLETED` + `PAYMENT_FAILED`, `EXPIRED`
- `assertTransition` 강제
- `BookingEvent` append-only 로그

**비범위**:
- 다중 상품 묶음 예약
- 좌석 지정(좌석 번호 없음, 카운트만 관리)
- 옵션·업셀(추가 식사·공항 픽업) — Phase 3

### 5.3 M-PAYMENT MVP
**PG**: 토스페이먼츠 (KRW 단일)
**범위**:
- 카드 결제만(가상계좌·간편결제 제외)
- 결제 승인 API 호출 + 웹훅 수신(`providerEventId` 멱등성)
- 전액 환불(`/api/payment/refund`, 관리자 수동 트리거 + 사용자 자동 취소)
- `Payment` 모델: `bookingId`, `tossPaymentKey`, `amount(Int, KRW)`, `status`, `approvedAt`, `failureReason`

**비범위**:
- 부분 환불, 분할 결제
- 정산 리포트 (외부 토스 대시보드로 대체)
- 다른 PG fallback

### 5.4 M-CHECKOUT MVP
**범위**:
- `/products/[id]/checkout?departureId=...&seats=...` — 결제 직전 요약 페이지(RSC)
- 토스 결제창 호출(`features/checkout/payment-widget.tsx`, `'use client'`)
- 결제 성공 콜백 → 서버 검증 → `/bookings/[id]/success`
- 결제 실패 → `/bookings/[id]/failed` + 재시도 링크
- `/bookings/[id]` 상세 페이지(본인 booking만 조회 가능)

**비범위**:
- 장바구니
- 예약 변경(날짜 이동, 인원 변경)

### 5.5 M-AI-SEARCH MVP
**범위**:
- `/search?q=...` 페이지(RSC)
- pgvector 컬럼 + `ProductEmbedding` 모델
- 임베딩 생성 배치(시드 단계에서 생성, 신규 상품 시 즉시 갱신)
- 자연어 라우터: LLM으로 `{destination?, themes[], maxBudget?, minDays?, maxDays?}` 추출
- 추출된 필터 + 코사인 유사도 검색 결합

**비범위**:
- 검색 결과 개인화(사용자 이력 기반)
- 음성 검색
- 대화형 검색(멀티턴) — 단발 쿼리만

### 5.6 M-CACHE MVP
**범위**:
- `/products`, `/`: ISR `revalidate = 60`
- `/products/[id]`: ISR `revalidate = 60` + `revalidateTag("product:{id}")` 트리거 (좌석 변동·상태 변경 시)
- `/bookings/*`, `/checkout/*`: `force-dynamic` 유지(개인화)

**비범위**:
- CDN edge 캐시(외부 인프라 결정)
- Redis 등 외부 캐시

### 5.7 M-OBS MVP
**범위**:
- `console.log`를 구조화 JSON 포맷 헬퍼(`shared/lib/logger.ts`)로 통일
- 결제·예약 상태 전이마다 `info`/`warn`/`error` 레벨 로깅
- 에러 트래킹: Sentry 또는 동급 1개 도입(env로 토글)

**비범위**:
- APM(트레이싱)
- 자체 대시보드

---

## 6. 리스크 레지스터

| ID | 리스크 | 영향 | 완화 |
|----|-------|------|------|
| R1 | 좌석 동시 예약 race condition | 오버부킹, 환불 분쟁 | `booking-transaction-safety` 스킬 R1 적용. updateMany 조건부 차감. M2 종료 전 부하 시험 필수 |
| R2 | 토스 웹훅 재전송 | 이중 차감/이중 알림 | `PaymentEvent.providerEventId` UNIQUE 인덱스 + 멱등성 검사 |
| R3 | 결제 성공·DB 실패 | 유령 결제(돈 받았으나 예약 없음) | 2-phase: DB hold 선행, PG 호출 후 결과 반영. 실패 시 보상 트랜잭션 |
| R4 | hold 만료 미정리 | 좌석 영구 점유 → 가용 좌석 0 | `holdExpiresAt < now` AND `status = PENDING_PAYMENT`인 booking을 EXPIRED로 전환하는 cron(5분 주기) |
| R5 | AI 검색 LLM 비용 폭주 | 운영비 급증 | 쿼리 캐시(같은 q는 1시간 캐시), rate limit, 무료 토큰 한도 모니터링 |
| R6 | pgvector 마이그레이션 | DB 확장 활성화 필요(권한·인프라) | 인프라 담당과 사전 확인. 실패 시 fallback으로 `ts_vector` 텍스트 검색 |
| R7 | 인증 도입 후 기존 페이지 회귀 | Phase 1 페이지 깨짐 | M1 PR에 회귀 테스트 추가. RSC에서 `getCurrentUser()` 미사용이면 영향 없음 |
| R8 | 캐시 도입 후 좌석 정합성 깨짐 | 매진 상품이 캐시로 살아남음 | `revalidateTag` 호출을 booking 트랜잭션 후처리에 hook |

---

## 7. 후속 spec·plan 발주 목록

본 로드맵 승인 후 작성될 문서들. 작성 순서는 §4 마일스톤을 따른다.

| 순서 | 문서 | 경로 | 다루는 내용 |
|------|------|------|------------|
| 1 | M-AUTH spec | `specs/2026-05-XX-auth-design.md` | NextAuth.js 선택, 세션 전략, Prisma 모델, 페이지 |
| 2 | M-AUTH plan | `plans/2026-05-XX-auth.md` | 태스크 분할, TDD 단위 |
| 3 | M-BOOKING + M-PAYMENT spec | `specs/2026-05-XX-booking-payment-design.md` | 좌석 hold, 상태머신, 토스 연동, 보상 트랜잭션 |
| 4 | M-BOOKING + M-PAYMENT plan | `plans/2026-05-XX-booking-payment.md` | (스코프 큼 → 2~3개 plan 분할 가능) |
| 5 | M-CHECKOUT spec | `specs/2026-05-XX-checkout-design.md` | 페이지·UX·결제창 통합 |
| 6 | M-CHECKOUT plan | `plans/2026-05-XX-checkout.md` | — |
| 7 | M-AI-SEARCH spec | `specs/2026-05-XX-ai-search-design.md` | pgvector, 임베딩 파이프라인, 자연어 라우터 |
| 8 | M-AI-SEARCH plan | `plans/2026-05-XX-ai-search.md` | — |
| 9 | M-CACHE plan | `plans/2026-05-XX-cache-tuning.md` | spec 생략 가능(단순) |
| 10 | M-OBS plan | `plans/2026-05-XX-observability.md` | spec 생략 가능 |

---

## 8. 적용 스킬 매핑 (CLAUDE.md §3 참조)

| 모듈 | 필수 스킬 | 비고 |
|------|----------|------|
| M-AUTH | enforce-fsd, clean-code-react | `entities/user` 신설 |
| M-BOOKING | **booking-transaction-safety**, enforce-fsd, clean-code-react | 좌석·상태머신 |
| M-PAYMENT | **booking-transaction-safety**, enforce-fsd, clean-code-react | 웹훅·멱등성·금액 정수 |
| M-CHECKOUT | enforce-fsd, clean-code-react | RSC + client 결제창 경계 주의 |
| M-AI-SEARCH | clean-code-react | LLM 호출은 서버에서, 키는 env |
| M-CACHE | clean-code-react | `revalidateTag` 호출 위치 명시 |
| M-OBS | (전체) | 로깅 헬퍼는 `shared/lib/` |

---

## 9. 기술 선택 (확정)

| 항목 | 선택 | 사유 |
|------|------|------|
| 인증 라이브러리 | **NextAuth.js v5 (Auth.js)** | Next.js 15 App Router 공식 지원, RSC 친화, 향후 소셜 로그인 확장 용이 |
| 토스페이먼츠 SDK | **v2** | 최신 안정 버전, App Router 친화 |
| 임베딩 모델 | **OpenAI `text-embedding-3-small`** | 비용 효율($0.02/1M tokens), 품질 충분 |
| 자연어 라우터 LLM | **Claude Haiku 4.5** | 빠르고 저렴, JSON 구조화 출력 우수 |
| DB 마이그레이션 정책 | **모듈별 분리** | 롤백 용이, 모듈 독립성 확보 |

미결정 / 후속 검토 항목:
- **에러 트래킹 도구**: Sentry 권장이나 M4(M-OBS) 진입 시 재검토
- **rate limiting**: AI 검색 비용 제어를 위한 redis/upstash 도입 여부는 M-AI-SEARCH spec에서 결정

---

## 10. 다음 액션

이 로드맵 승인 후 즉시 **M-AUTH spec**(`specs/2026-05-13-auth-design.md`) 작성에 착수한다. M-AUTH가 가장 짧은 critical path이며, 후속 모듈의 기반이 된다.
