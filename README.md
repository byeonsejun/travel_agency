# Nextour (넥스투어)

> AI가 찾아주는 맞춤형 패키지 여행 예약 플랫폼

자연어 검색으로 조건에 맞는 패키지 여행을 탐색하고, 여행사 도메인 규칙(최소 출발 인원·동적 가격·실시간 좌석 차감)이 그대로 반영된 예약 플로우를 제공합니다.

## 화면

![홈](./docs/screenshots/home.png)

<table>
  <tr>
    <td width="50%"><img src="./docs/screenshots/search.png" alt="AI 자연어 검색 결과" /><br/><sub><b>검색</b> — AI 자연어 하이브리드 랭킹 결과</sub></td>
    <td width="50%"><img src="./docs/screenshots/pdp.png" alt="상품 상세(PDP)" /><br/><sub><b>상품 상세(PDP)</b> — 일정·출발일·실시간 좌석</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="./docs/screenshots/checkout.png" alt="체크아웃" /><br/><sub><b>체크아웃</b> — 2-phase 결제 플로우</sub></td>
    <td width="50%"><img src="./docs/screenshots/admin-dashboard.png" alt="관리자 대시보드" /><br/><sub><b>관리자 대시보드</b> — 매출·점유율·취소율</sub></td>
  </tr>
</table>

---

## 무엇을 하는 서비스인가

- 🔎 **AI 자연어 검색** — 임베딩(pgvector) 기반 하이브리드 랭킹(벡터·키워드·지역·테마 가중합)으로 "조건에 맞는 여행"을 찾는다.
- 🧳 **여행사 도메인 규칙 반영** — 최소 출발 인원·출발일별 동적 가격·실시간 좌석 차감이 예약 플로우에 그대로 녹아 있다.
- 💳 **2-phase 결제 + 3-phase 환불 saga** — 외부 PG(토스) 호출을 DB 트랜잭션 바깥으로 격리하고, 웹훅 멱등성·좌석 안전(조건부 차감)으로 돈·좌석 무결성을 지킨다. (결제는 영구히 Mock/토스 샌드박스까지만 — 실거래 미구현)
- 🛠️ **관리자 CMS** — 상품·출발일 관리, 리뷰 모더레이션, 운영 대시보드(매출·점유율·취소율).

---

### 📐 먼저 읽어주세요 — 엔지니어링 판단 기록

> **▶ [코드는 AI가, 판단은 내가 — 일곱 개 결정의 회고](docs/engineering-judgment.md)**
>
> 프론트엔드 개발자가 AI로 검색 랭킹·결제 saga·인가·이벤트 소싱까지 닿을 때, 차별점은 코드 생성이 아니라 그 위에 내린 판단이다. 검색 가중치 튜닝 보류(과적합 회피), LLM-judge 반순환 라벨, 소유권 기반 인가(ID 비밀성 거부), 정직하게 남긴 갭, E2E rigor의 배치(돈·인증 경로에만), 틀린 요구의 재정의(출발취소 위약금 옵션 → 환불 원장 정합화) 등 **일곱 개 결정**을 수치와 코드로 회고한다.
>
> 결정 원본 전체: **[ADR 인덱스 (0001–0059)](docs/superpowers/adr/README.md)** — 모든 주장은 ADR → 커밋/코드 라인으로 추적된다.

---

## 아키텍처

### FSD 5-레이어 단방향 의존성

```mermaid
flowchart TD
    app["app — 라우팅·페이지<br/>(site) · (admin) · api"]
    widgets["widgets — 13 슬라이스<br/>entity UI 조합"]
    features["features — 20 슬라이스<br/>사용자 인터랙션 단위"]
    entities["entities — 10 슬라이스<br/>도메인 모듈 · product / booking / payment 등"]
    shared["shared — email · lib · types · ui<br/>도메인 무지 유틸·UI·db client"]

    app --> widgets --> features --> entities --> shared

    classDef layer fill:#eef2ff,stroke:#6366f1,color:#1e1b4b;
    class app,widgets,features,entities,shared layer
```

> *그림 1.* 상위 레이어만 하위 레이어를 import한다(역방향·동일 레이어 cross-slice import 금지). 강제 수단은 lint 플러그인이 아니라 **barrel `index.ts` 공개 API 컨벤션 + Architect 페르소나 자가 코드리뷰**(`docs/superpowers/skills/architect.md` R1/R2, `CLAUDE.md` §5). 외부 import는 항상 `@/entities/{name}` 형태의 barrel 경로만 사용한다.

### 결제·환불 3-Phase Saga (외부 IO를 DB 트랜잭션 밖으로)

```mermaid
flowchart TD
    start(["환불 요청"]) --> idem

    subgraph P1["Phase 1 · DB Tx — 멱등 게이트 + 예약(reserve)"]
        idem{"idempotencyKey 가진<br/>RefundJob 존재?"}
        idem -->|있음| noop(["멱등 no-op 종료"])
        idem -->|없음| reserve["reserveRefund · 원장 조건부 차감<br/>RefundJob = IN_PROGRESS enqueue"]
    end

    reserve --> toss

    subgraph P2["Phase 2 · 외부 IO — DB Tx 바깥"]
        toss["tossClient.cancel<br/>Idempotency-Key HTTP 헤더"]
    end

    toss -->|성공| settle
    toss -->|실패| defer["RefundJob = PENDING<br/>지수 백오프 nextRunAt"]
    defer -.->|cron worker 재시도 · refundRetry.ts| toss

    subgraph P3["Phase 3 · DB Tx — 정산(settle)"]
        settle["Payment = CANCELED / PARTIAL_CANCELED<br/>RefundJob = SUCCEEDED<br/>PaymentEvent providerEventId 적재<br/>EmailJob 아웃박스 enqueue"]
    end

    settle --> done(["환불 완료"])
```

> *그림 2.* 환불은 우리 DB와 Toss PG에 걸친 분산 트랜잭션이다([ADR-0003](./docs/superpowers/adr/0003-refund-saga-3-phase.md)). 외부 IO(Phase 2)를 DB Tx 밖으로 격리해 락 윈도우를 마이크로초로 줄이고, PG 실패는 `RefundJob = PENDING`으로 적재해 cron worker가 자가 치유한다(이 동안 booking 상태는 무결성을 유지). 3중 멱등성(HTTP `Idempotency-Key` + `RefundJob.idempotencyKey` 게이트 + `PaymentEvent.providerEventId`)으로 이중 환불을 차단한다.

## 기술 스택

| 분류 | 기술 |
|------|------|
| Frontend / Backend | Next.js 16 (App Router) + TypeScript |
| Database | PostgreSQL + pgvector + Prisma ORM (운영: Supabase / 로컬: Docker 격리) |
| AI | Anthropic Claude API + pgvector |
| 인증 | Auth.js v5 (이메일 매직링크 + 카카오) |
| 결제 | 토스페이먼츠 |
| 배포 | Vercel |

## 문서

- [제품 요구사항 (PRD)](./docs/product/PRD.md)
- [시스템 아키텍처](./docs/technical/ARCHITECTURE.md)
- [엔지니어링 판단 기록 (일곱 개 결정)](./docs/engineering-judgment.md)
- [ADR 인덱스 (설계 결정 기록)](./docs/superpowers/adr/README.md)
- [이미지 출처 / 크레딧](./docs/credits.md)
- [문서 목차](./docs/README.md)

---

# 셋업 & 로컬 개발

## 빠른 시작

> 🛑 **운영 DB 직결 금지.** 로컬 개발은 **반드시** 아래 Docker 로컬 PostgreSQL(샌드박스)에 연결한다.
> 운영(Supabase) 자격증명은 Vercel 환경변수가 SSOT이며, 로컬 `.env` 의 `DATABASE_URL` 은
> 절대 운영 호스트(`*.pooler.supabase.com`)를 가리켜선 안 된다. 마이그레이션·시드·`db push` 가
> 운영 데이터를 파괴할 수 있다. 자세한 이유와 셋업은 ▶ [로컬 개발 DB 셋업](#로컬-개발-db-셋업-docker--pgvector).

```bash
# 1) 의존성 설치
npm install

# 2) 로컬 개발 DB(Docker, pgvector) 기동
docker compose up -d

# 3) 환경변수: .env 생성 후 DATABASE_URL/DIRECT_URL 을 로컬 docker 로 지정
cp .env.example .env
#   DATABASE_URL="postgresql://nextour:nextour_local_dev@localhost:5432/nextour"
#   DIRECT_URL="postgresql://nextour:nextour_local_dev@localhost:5432/nextour"
#   ENCRYPTION_KEY 등 나머지 키 입력 (아래 셋업 섹션 참고)

# 4) 스키마 동기화 + 벡터 인덱스 + 시드
npm run db:push
docker exec -i nextour-local-db psql -U nextour -d nextour \
  < prisma/migrations/20260519000000_product_embedding_pgvector/migration.sql
npm run db:seed

# 5) 개발 서버 실행
npm run dev
```

## 로컬 개발 DB 셋업 (Docker / pgvector)

로컬 개발은 운영 Supabase 와 **완전히 격리된** Docker PostgreSQL 컨테이너를 사용한다.
구성은 [`docker-compose.yml`](./docker-compose.yml) 에 정의돼 있다.

**왜 Docker pgvector 인가?**
- 스키마가 `ProductEmbedding.vector = Unsupported("vector(1536)")` + ivfflat 인덱스를 쓰므로
  `pg_available_extensions` 에 `vector` 가 있는 **`pgvector/pgvector` 이미지**가 필수다.
  (순정 `postgres` 이미지로는 `CREATE EXTENSION vector` 가 실패한다.)
- 운영 DB 직결 시 실수 한 번(`db push --force-reset`, `migrate dev`)으로 실데이터가 날아간다.
  로컬 격리는 이 사고를 구조적으로 차단한다.

**마이그레이션 방식 주의 — `migrate deploy` 가 아니라 `db push`:**
이 프로젝트는 베이스라인 마이그레이션이 없는 `db push` 워크플로우다
(`prisma/migrations/` 에는 베이스 스키마 *이후* 변경분만 존재). 따라서 빈 DB 에
`prisma migrate deploy` 를 돌리면 `relation "Product" does not exist` 로 실패한다.
신규 로컬 환경은 위 빠른 시작 4단계(`db:push` → 인덱스 SQL → seed)를 따른다.
필요 시 `npx prisma migrate resolve --applied <name>` 으로 마이그레이션 히스토리를 baseline 할 수 있다.

| 작업 | 명령어 |
|------|--------|
| DB 기동 | `docker compose up -d` |
| DB 중지(데이터 유지) | `docker compose down` |
| DB 완전 초기화(볼륨 삭제) | `docker compose down -v` |
| 헬스 확인 | `docker inspect --format '{{.State.Health.Status}}' nextour-local-db` |
| psql 접속 | `docker exec -it nextour-local-db psql -U nextour -d nextour` |

| 로컬 DB 접속 정보 | 값 |
|------|------|
| host:port | `localhost:5432` |
| database | `nextour` |
| user / password | `nextour` / `nextour_local_dev` |

> `ENCRYPTION_KEY` 는 **로컬 전용 난수**를 쓴다 (운영 키와 격리 — 운영 암호문과 호환되지 않는 것이 정상).
> 생성: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

## 필수 환경변수

| 변수 | 설명 |
|------|------|
| `DATABASE_URL` | PostgreSQL 연결 URL — **로컬은 반드시 Docker(`localhost:5432`)**, 운영 직결 금지 |
| `DIRECT_URL` | 마이그레이션용 직결 URL (로컬은 `DATABASE_URL` 과 동일) |
| `ENCRYPTION_KEY` | PII 암호화 키(base64 32B). 로컬은 운영과 격리된 전용 난수 사용 |
| `AUTH_SECRET` | Auth.js 시크릿 (`openssl rand -base64 32`) |
| `RESEND_API_KEY` | 이메일 발송용 Resend API 키 |
| `RESEND_FROM_EMAIL` | 발신자 이메일 주소 |

전체 환경변수 목록은 [`.env.example`](./.env.example) 참고.

## 주요 npm 스크립트

| 명령어 | 설명 |
|--------|------|
| `npm run dev` | 개발 서버 실행 |
| `npm run build` | 프로덕션 빌드 |
| `npm run typecheck` | TypeScript 타입 검사 |
| `npm run test` | Vitest 테스트 실행 |
| `npm run db:migrate` | Prisma 마이그레이션 |
| `npm run db:studio` | Prisma Studio (DB GUI) |
| `npm run db:seed` | 시드 데이터 삽입 |
