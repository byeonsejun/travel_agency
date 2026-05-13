# 🏗️ Nextour 시스템 아키텍처

> PRD v0.2 기반. 결정된 스택: Next.js (App Router) + TypeScript + PostgreSQL + Prisma + pgvector + Claude API + Auth.js + 토스페이먼츠 + Supabase + Vercel

---

## 1. 시스템 개요

```
                ┌────────────────────────────────────────────────┐
                │              Browser (고객 / 어드민)            │
                └───────────────┬────────────────────────────────┘
                                │ HTTPS
                                ▼
        ┌────────────────────────────────────────────────────┐
        │                 Next.js (Vercel)                   │
        │  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
        │  │ App Router   │  │ Route        │  │ Server   │  │
        │  │ (RSC + UI)   │  │ Handlers     │  │ Actions  │  │
        │  │ /(site)      │  │ /api/*       │  │          │  │
        │  │ /(admin)     │  │              │  │          │  │
        │  └──────┬───────┘  └──────┬───────┘  └────┬─────┘  │
        └─────────┼─────────────────┼───────────────┼────────┘
                  │                 │               │
        ┌─────────▼─────┐  ┌────────▼────────┐ ┌────▼─────────┐
        │  Auth.js      │  │ Claude API      │ │ Toss         │
        │ (이메일/카카오)│  │ (LLM, 요약)     │ │ Payments     │
        └───────────────┘  └────────┬────────┘ └──────┬───────┘
                                    │ embeddings      │ webhook
                                    ▼                 ▼
        ┌────────────────────────────────────────────────────┐
        │                  Supabase                          │
        │  ┌──────────────────────────┐  ┌──────────────┐   │
        │  │ PostgreSQL + pgvector    │  │ Storage      │   │
        │  │ - 도메인 테이블           │  │ - 상품 이미지 │   │
        │  │ - product_embedding      │  │ - E-ticket   │   │
        │  └──────────────────────────┘  └──────────────┘   │
        └────────────────────────────────────────────────────┘
```

핵심 원칙:
- **단일 레포 / 단일 배포**: 고객 사이트, 어드민, API가 모두 한 Next.js 앱.
- **DB가 진실의 원천**: 좌석·예약·결제 상태는 모두 Postgres 트랜잭션으로 일관성 보장. 캐시는 보조 수단.
- **LLM은 항상 보조 역할**: AI는 쿼리 해석/요약/추천 코멘트만 담당. 가격·재고·정책은 절대 LLM이 결정하지 않음.

---

## 2. 도메인 모델

엔티티 단위로 책임을 분리한다. (Prisma 스키마로 옮기기 전 개념 정의)

### 2.1 사용자

| 엔티티 | 핵심 필드 | 설명 |
|--------|-----------|------|
| `User` | id, email, name, phone, role(`customer`/`admin`), provider | 고객·어드민 공용. role로 분기 |
| `PassportProfile` | userId, lastNameEn, firstNameEn, gender, birthDate, passportNo, expireDate | 여권 정보. 민감정보, 별도 테이블로 격리 |

### 2.2 상품 (Product)

| 엔티티 | 핵심 필드 | 설명 |
|--------|-----------|------|
| `Product` | id, title, summary, destination, durationNights, durationDays, heroImage, status(`draft`/`published`/`closed`) | 패키지 상품 마스터 |
| `ProductTag` | productId, tag (`#노쇼핑`, `#출발확정`, `#가족`…) | 검색/필터/카드 노출 |
| `Inclusion` | productId, kind(`included`/`excluded`), label, note | 포함/불포함 항목 |
| `ItineraryDay` | productId, dayNumber, title, accommodation, meals(JSON: breakfast/lunch/dinner) | N일 차 |
| `ItineraryStop` | itineraryDayId, order, time, place, description | 1일 차 안의 방문지들 |
| `ProductEmbedding` | productId, vector(1536), modelVersion, updatedAt | pgvector. 상품 요약+태그+일정을 합쳐 임베딩 |

### 2.3 출발 / 재고 (Departure & Inventory)

| 엔티티 | 핵심 필드 | 설명 |
|--------|-----------|------|
| `Departure` | id, productId, departureDate, returnDate, priceAdult, priceChild, minPax, capacity, status(`scheduled`/`confirmed`/`closed`/`canceled`) | 출발일별 인스턴스. **동적 가격은 여기에 직접 저장** |
| `SeatLedger` | departureId, bookedSeats, holdSeats, version | 잔여 좌석 계산용. `version`은 낙관적 락 |

> **재고는 `Departure` 자체에 들고**, 변경 이력은 `BookingItem` + 상태로 추적한다. 별도 좌석별 행은 만들지 않음(좌석번호 개념 없음 — 단순 카운트).

### 2.4 예약 & 결제

| 엔티티 | 핵심 필드 | 설명 |
|--------|-----------|------|
| `Booking` | id, userId, departureId, pax(성인/아동/유아 수), totalPrice, status(상태머신), createdAt | 예약 단위 |
| `Traveler` | bookingId, passportProfileId? OR 직접입력 필드들, role(`booker`/`traveler`) | 예약 1건당 N명 |
| `BookingTerms` | bookingId, termVersion, agreedAt | 약관 동의 기록 (감사용) |
| `Payment` | id, bookingId, amount, method(`card`/`virtual_account`), tossPaymentKey, tossOrderId, status(`pending`/`paid`/`canceled`/`failed`), paidAt | 토스페이먼츠 결제 1건 |

---

## 3. 예약 상태 머신

PRD의 마이페이지 진행률 바와 동일한 흐름을 DB 상태로 그대로 매핑한다.

```
                      [고객]                                [어드민/시스템]
  ┌──────────────┐  예약 신청  ┌────────────────┐  최소 인원 미달 ┌────────────────┐
  │  (시작)      │ ──────────▶ │ RECEIVED       │ ──────────────▶ │ AWAITING_GROUP │
  │              │             │ (예약 접수)     │                 │ (출발 대기)     │
  └──────────────┘             └────────┬───────┘                 └────────┬───────┘
                                        │                                  │
                                        │ 인원 충족 / 어드민 확정             │ 인원 충족
                                        ▼                                  ▼
                                ┌────────────────┐                ┌────────────────┐
                                │ DEPARTURE_     │  결제 요청 발송  │ DEPARTURE_     │
                                │ CONFIRMED      │ ◀────────────── │ CONFIRMED      │
                                │ (출발 확정)     │                │                 │
                                └────────┬───────┘                └────────────────┘
                                         │ 토스페이먼츠 결제 완료 (webhook)
                                         ▼
                                ┌────────────────┐
                                │ PAID           │
                                │ (결제 완료)     │
                                └────────┬───────┘
                                         │ 출발 D-7 / 어드민 발급
                                         ▼
                                ┌────────────────┐
                                │ READY          │
                                │ (여행 준비, 발권)│
                                └────────┬───────┘
                                         │ 출발일 경과
                                         ▼
                                ┌────────────────┐
                                │ COMPLETED      │
                                └────────────────┘

  취소 분기 (어디서든 가능, 단 환불 규정 적용):
    RECEIVED/AWAITING_GROUP → CANCELED_BY_USER (수수료 없음 또는 약관 기준)
    DEPARTURE_CONFIRMED/PAID → CANCELED_BY_USER (특별약관 수수료)
    어드민/모객 실패          → CANCELED_BY_AGENCY (전액 환불)
```

상태 전이는 **DB 트랜잭션 안에서만** 발생. 각 전이는 `BookingEvent` 테이블에 한 줄로 기록(감사 로그).

---

## 4. 좌석 동시성 처리 전략

> "한 팀이 예약을 진행하는 순간, 실시간으로 잔여석 차감" — PRD 핵심 룰.

### 4.1 채택 전략: 트랜잭션 내 행 단위 비관적 락

```sql
-- 예약 생성 시 (의사 SQL)
BEGIN;
  SELECT * FROM "Departure" WHERE id = :dep FOR UPDATE;        -- 행 잠금
  -- bookedSeats + 요청pax <= capacity 검증
  UPDATE "Departure"
     SET "bookedSeats" = "bookedSeats" + :pax
   WHERE id = :dep AND "bookedSeats" + :pax <= "capacity";
  -- 영향행 0이면 ROLLBACK + 사용자에게 "방금 마감" 안내
  INSERT INTO "Booking" (...) VALUES (...);
COMMIT;
```

Prisma에서는 `$transaction` + `$queryRaw`로 `SELECT … FOR UPDATE`를 발급.

**왜 비관적 락인가**: 패키지 여행은 트래픽 폭주가 적고 인원 단위(2~10명)로 한 번에 차감되므로 충돌 시 재시도 비용보다 락이 단순하고 안전.

### 4.2 보류(Hold) 옵션 — Phase 2

결제까지 시간이 걸리는 흐름을 안전히 다루려면:

- 예약 입력 시작 시 `holdSeats`에 카운트 잡고 TTL 15분.
- 만료되면 잡(cron 또는 Vercel Cron) 으로 해제.
- MVP에서는 *접수 즉시 booked로 카운트*하기로 함(결제 무관, 무결제 대기 모델이므로).

### 4.3 최소 출발 인원 처리

매일 자정 + 결제 트리거 시점에 `Departure`별로:

```
if status == 'scheduled' and bookedSeats >= minPax:
    status = 'confirmed' → 해당 Departure의 모든 RECEIVED 예약을 AWAITING_GROUP→DEPARTURE_CONFIRMED로
```

→ Vercel Cron + 어드민 수동 트리거 둘 다 지원.

---

## 5. AI 시맨틱 검색 파이프라인

### 5.1 색인 (Indexing) — 어드민이 상품 등록/수정 시

```
[Admin] Product 저장
   └─▶ buildEmbeddingInput(product) =
         title + summary + tags + 일정 요약 + 포함/불포함 키워드
   └─▶ Claude (또는 OpenAI text-embedding-3) 호출 → vector
   └─▶ ProductEmbedding upsert (pgvector)
```

> 임베딩 모델은 1개로 고정하고 `modelVersion` 컬럼 기록. 모델 교체 시 일괄 재색인.

### 5.2 검색 (Query) — 고객이 자연어로 검색

```
[User] "내년 3월 오사카 3박 4일 커플, 숙소 좋고 쇼핑 X"
   │
   ▼
[1] Claude 1차 호출 — Query 구조화
     입력: 자연어
     출력(JSON): {
       destination: "오사카",
       startMonth: "2027-03",
       durationNights: 3,
       theme: ["couple", "premium_stay"],
       avoid: ["shopping"]
     }
   │
   ▼
[2] 하드 필터 (SQL): destination, 출발월 ± 7일, 박수 일치
   │
   ▼
[3] 벡터 유사도 (pgvector):
     embedding <=> embed("숙소 좋고 쇼핑 없는 커플 여행")
     상위 N개 (예: 20)
   │
   ▼
[4] 비즈니스 룰 리랭킹:
     - 출발 확정 우선
     - 잔여석 있는 것 우선
     - 가격 vs 평균 가격 편차로 가성비 점수
   │
   ▼
[5] Claude 2차 호출 — 카드별 추천 코멘트 1줄, 페이지 상단 요약
   │
   ▼
[Cards] 결과 노출
```

**비용/지연 관리**:
- 1차 구조화는 짧은 system prompt + JSON 출력 모드.
- 2차 코멘트는 상위 5개 카드만 일괄 1콜에 묶어 처리.
- 동일 쿼리 캐싱(Redis 또는 in-memory) — Phase 2.

### 5.3 PDP의 "AI 3줄 요약"

상품 저장 시점에 **사전 생성**해서 `Product.aiSummary`에 저장(런타임 호출 0). 어드민이 일정/내용 변경 시 자동 재생성.

---

## 6. 결제 흐름 (토스페이먼츠)

PRD 정책: **접수는 무결제 대기, 출발 확정 시 전액 결제.**

```
[1] 예약 접수 (RECEIVED)
      → 결제 미발생. Booking + 좌석 차감만.

[2] 어드민(또는 시스템)이 출발 확정 → DEPARTURE_CONFIRMED
      → 고객에게 결제 요청 메일/SMS (결제 URL 포함)

[3] 고객이 결제 페이지 진입
      → POST /api/payments/intent
        - tossOrderId 생성 (booking_{id}_{nonce})
        - Payment row(status=pending) 작성
      → 토스 위젯 SDK로 결제 진행

[4] 토스 → 서버 successUrl 콜백 + Webhook 동시 처리
      → /api/payments/confirm (서버에서 amount 검증 후 confirm 호출)
      → status=paid 로 트랜잭션 갱신
      → Booking.status = PAID

[5] D-7 자동 잡: E-ticket 생성 → Storage 업로드 → Booking.status = READY
```

**보안 포인트**:
- 금액 검증은 항상 서버에서 (`Booking.totalPrice`와 토스 응답 amount 비교).
- 멱등성: `tossOrderId`는 unique. webhook 중복 호출에도 안전하도록 `Payment.status`로 가드.
- 환불은 `Payment.tossPaymentKey`로 토스 cancel API 호출 → `BookingEvent`에 기록.

---

## 7. 권한 / 라우팅

```
app/
├── (site)/                ← 비로그인+고객 라우트
│   ├── page.tsx           ← 홈 + AI 검색
│   ├── search/page.tsx
│   ├── products/[id]/page.tsx   (PDP)
│   ├── booking/[id]/...
│   └── mypage/...
├── (admin)/               ← /admin/* — role=admin만
│   ├── products/...
│   ├── departures/...
│   ├── bookings/...
│   └── customers/...
├── api/
│   ├── auth/[...nextauth]/route.ts
│   ├── search/route.ts          (AI 시맨틱 검색)
│   ├── bookings/route.ts        (POST: 예약 생성 + 좌석 차감)
│   ├── payments/intent/route.ts
│   ├── payments/confirm/route.ts
│   └── payments/webhook/route.ts (토스 webhook)
└── middleware.ts          ← /admin/*는 role=admin 강제
```

---

## 8. 폴더 구조 (FSD — Feature-Sliced Design)

> Next.js App Router와의 충돌을 최소화한 FSD 적용.
> `pages/` 레이어는 Next.js `app/` 디렉토리가 대체. 나머지 레이어는 FSD 표준을 따름.

### FSD 레이어 임포트 규칙
```
app → widgets → features → entities → shared
(상위 레이어는 하위 레이어만 import 가능. 같은 레이어 간 import 금지)
```

```
src/
├── app/                          ← [Next.js] 라우팅 + FSD pages 레이어 역할
│   ├── (site)/                   ← 고객 라우트 (비로그인 포함)
│   │   ├── page.tsx              ← 홈 + AI 검색
│   │   ├── login/
│   │   │   ├── page.tsx          ✅ 완료
│   │   │   └── verify/page.tsx   ✅ 완료
│   │   ├── search/page.tsx
│   │   ├── products/[id]/page.tsx
│   │   ├── booking/[id]/
│   │   └── mypage/
│   ├── (admin)/                  ← role=ADMIN 전용
│   │   ├── products/
│   │   ├── departures/
│   │   ├── bookings/
│   │   └── customers/
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts  ✅ 완료
│   │   ├── search/route.ts
│   │   ├── bookings/route.ts
│   │   └── payments/
│   │       ├── intent/route.ts
│   │       ├── confirm/route.ts
│   │       └── webhook/route.ts
│   ├── globals.css
│   └── layout.tsx
│
├── widgets/                      ← 페이지 단위 복합 UI 블록
│   ├── home/
│   ├── product-card-list/
│   ├── product-detail/
│   ├── booking-funnel/
│   └── admin-dashboard/
│
├── features/                     ← 사용자 인터랙션 단위 (서버 로직 포함)
│   ├── auth/
│   │   └── server/
│   │       └── auth.ts           ✅ 완료 (Auth.js 설정)
│   ├── search/                   ← AI 검색 파이프라인
│   │   └── server/
│   │       ├── searchPipeline.ts
│   │       └── embed.ts
│   ├── booking/                  ← 예약 생성·취소·상태머신
│   │   └── server/
│   │       ├── createBooking.ts
│   │       ├── stateMachine.ts
│   │       └── confirmDeparture.ts
│   ├── payment/                  ← 토스 결제 플로우
│   │   └── server/
│   │       ├── toss.ts
│   │       └── handleWebhook.ts
│   └── notify/                   ← 이메일 알림
│       └── server/
│           └── sendEmail.ts
│
├── entities/                     ← 비즈니스 엔티티 (타입·상수·기본 UI)
│   ├── product/
│   ├── departure/
│   ├── booking/
│   └── user/
│
├── shared/                       ← 의존성 없는 공용 레이어
│   ├── lib/
│   │   ├── db.ts                 ✅ 완료 (Prisma Client)
│   │   └── env.ts                ✅ 완료 (환경변수 검증)
│   ├── ui/                       ← Button, Input 등 기본 컴포넌트
│   ├── api/                      ← fetch 헬퍼
│   └── types/
│       └── next-auth.d.ts        ✅ 완료
│
└── middleware.ts                  ✅ 완료 (어드민·인증 라우트 보호)

prisma/
├── schema.prisma                  ✅ 완료
└── migrations/
```

---

## 9. 부가 결정사항 (확정)

| 항목 | 결정 | 메모 |
|------|------|------|
| 상품 시드 | 공개 샘플/팜플릿 기반 **가상 상품 30~50건** | `prisma/seed.ts`. 검색·예약 전 플로우 검증용 |
| 다국어 | **한국어 단일** | 여권 필드(`firstNameEn`, `lastNameEn`, `passportNo` 등)만 영문 강제 — zod schema에서 정규식 검증 |
| 이미지 | **Supabase Storage + next/image** | 별도 CDN 도입은 Phase 2. `next.config`에 Supabase 도메인 remotePatterns 등록 |
| 알림 | **이메일만 (Resend)** | 예약 접수 → 출발 확정 → 결제 요청 → 결제 완료 → E-ticket. 카카오 알림톡은 Phase 2 |
| 관측 | **Vercel Logs로 시작 → 결제 구현 직전 Sentry 도입** | 결제·좌석 트랜잭션은 반드시 Sentry로 추적 |
| 테스트 | **Vitest로 구조 세팅 + 핵심 경로만** | 단위: 가격 계산, 상태머신 전이. 통합: 좌석 동시성, 토스 webhook 멱등성. Playwright는 Phase 2 |

### 9.1 영문 여권 필드 검증 규칙 (참고)

```ts
firstNameEn: z.string().regex(/^[A-Z\s]+$/, "여권에 표기된 영문 대문자로 입력하세요"),
passportNo:  z.string().regex(/^[A-Z]{1,2}[0-9]{7,9}$/),
```

### 9.2 이메일 트리거 매트릭스 (Resend)

| 트리거 (BookingEvent) | 수신자 | 템플릿 |
|----------------------|--------|--------|
| `→ RECEIVED` | 고객 | 예약 접수 확인 |
| `→ DEPARTURE_CONFIRMED` | 고객 | 출발 확정 + 결제 요청 URL |
| Payment `→ PAID` | 고객 | 결제 완료 영수증 |
| `→ READY` | 고객 | E-ticket 첨부 (Storage signed URL) |
| `→ CANCELED_BY_*` | 고객 | 취소 확인 (+ 환불 일정 안내) |
| 신규 `RECEIVED` | 어드민 | 새 예약 접수 알림 |

이메일 발송 자체는 `features/notify/server/sendEmail.ts` 1개 모듈에 격리, 도메인 코드는 이벤트만 publish.
