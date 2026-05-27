# Rate Limit Architecture — Phase 3 B2-C Design Spec

> 작성일: 2026-05-28
> 상태: Proposed (사용자 승인 대기 — §9 Decision Gate)
> 범위: Nextour 전체 API/페이지·서버 액션의 속도 제한 인프라 구축
> 페르소나: 🏛️ Architect · ⚙️ Backend Expert · 💳 Domain Booking · 🔬 QA Engineer

---

## 1. Context — 왜 지금 Rate Limit인가

Phase 3 B2-A(Sentry SDK, [ADR-0021])와 B2-B(CSP/HSTS, 5a54d85)이 `main`에 병합되어 운영성·브라우저 보안 경계는 갖추어졌다. 그러나 **서버 자원·외부 비용·도메인 무결성을 노리는 트래픽 폭주 방어선은 비어 있다**:

- **공격 표면**: Toss 결제 confirm, AI 검색(Anthropic LLM + OpenAI embedding), OAuth 로그인은 *호출당 외부 IO 비용 + 도메인 invariant 위험*을 가지는 비대칭 비싼 경로다. 단일 자동화 클라이언트가 분당 1k회 호출만 해도 (a) AI API 비용 폭증, (b) PG 호출 throttle 트리거, (c) 정합성 보호 비용(N-times CAS Claim) 누적.
- **공격 시나리오** (실제 운영 환경에서 관측되는 패턴):
  - **Credential stuffing**: 유출된 ID/PW dict를 `/login`에 회전 — IP 분산 + UA 위장
  - **Card testing**: 도난 카드 BIN range를 결제 확인 엔드포인트로 검증
  - **AI cost burn**: 검색창에 임의 쿼리 폭주 — 1회 ~$0.001 × 100k = $100/일
  - **Volumetric DoS**: 무작위 path scan — 함수 cold start × 콜드웨어로 비용 증폭
- **기존 방어선의 한계**:
  - NextAuth 자체에는 시도 제한 없음. provider half-config 차단([ADR-0014])은 *설정 오류* 방어용.
  - 결제 confirm은 [ADR-0014] 화이트리스트 + `domain-booking R6` Zod 가드를 통과한다는 가정 — 즉 **유효 요청 형식이라면 매번 도메인 진입**.
  - Vercel 플랫폼 자체 DDoS 보호는 *볼륨 임계*에서만 발동. 응용 계층(per-user, per-endpoint) 제한은 우리 책임.
  - [ADR-0013] Toss 웹훅 transmission-id 멱등성 — 멱등 ≠ 폭주 차단. 멱등 키만으로는 정상 응답을 *N번 생성하는 비용*을 막지 못한다.

→ **목적**: 정상 사용자 영향 0, 자동화 클라이언트는 명시적 한도에서 차단되는 다계층 sliding-window 속도 제한을 도입한다.

---

## 2. Goals · Non-Goals

### 2.1 Goals
1. 인증/결제/AI/일반 4계층 sliding-window 제한, 각 tier 독립 limit/window 튜닝.
2. 위반 시 표준 응답(`429 Too Many Requests` + `Retry-After` + RateLimit 헤더), 정상 응답엔 헤더 박제로 디버깅·튜닝 가시화.
3. **Fail-open** 강등 — Upstash 미설정·장애 시 요청을 죽이지 않는다([feedback-dev-external-io] + 캐시 graceful 강등 선례). 단 운영 환경에선 미설정/장애 양쪽 모두 Sentry 경고.
4. FSD 단방향 의존성 유지 — `shared/lib/rate-limit/`에 모든 wrapper·식별자 helper 격리.
5. Edge 미들웨어 글로벌 baseline + Route/Server Action 단위 tier-specific wrapper의 **하이브리드 통합**(§4).
6. `RATE_LIMIT_MODE=shadow`(로그만) ↔ `enforce`(차단) 토글로 점진 롤아웃, [ADR-0021] Sentry envelope · CSP_MODE 패턴 재사용.

### 2.2 Non-Goals (이번 PR 범위 밖)
- 분산 Bot management(captcha, JS challenge) — Vercel BotID GA 도입은 별 PR.
- IP allowlist/denylist UI — 운영 도구 단계에서 후속.
- 좌석 hold 발급(`POST /api/booking/holds`) tier별 추가 — 현재 좌석 도메인은 폴링 채널([ADR-0008])이고 hold 생성은 결제 흐름 내부. tier `payment` 또는 `auth` 카테고리에 포함됨.
- 라이브 실거래 경로 — 🛑 NO-REAL-MONEY([ADR-0014]) 영구 제약 유지.
- 사용자별 plan tier(유료/무료 차등) — 현재 단일 사용자 등급.

---

## 3. Multi-Tier 제한 카탈로그

> 식별자(identifier) = `<scope>:<value>` 형식. `user:<userId>` 또는 `ip:<remote-ip>`. 결정 규칙은 §5.

| Tier | 적용 위치 | Limit / Window | 식별자 우선순위 | 근거 |
|------|-----------|----------------|------------------|------|
| `global` | 미들웨어(Edge) `/api/*`(웹훅·헬스·CSP 제외) | **100 req / 10s** | `user → ip` | 함수 콜드스타트 비용 폭증·볼륨 DoS 차단. 정상 SPA는 burst 30~50 req/10s, x2 안전 마진. |
| `auth` | 로그인 Server Action(`signInWithProvider`) + 회원 액션 일체 | **5 req / 1min** | `ip` 고정 (인증 전) | Credential stuffing 차단. OWASP ASVS V2.2.1 권고치(시도 ≤ 5/min) 일치. |
| `payment` | `/api/payments/confirm` route handler | **10 req / 1min** | `user` 고정 (인증 후) | Card testing + 사용자 더블탭 방어. 한 booking confirm은 자연스럽게 1~3회 안.<br>**예외**: `/api/payments/webhook/toss`는 외부 파트너 + `transmission-id` 멱등([ADR-0013]) → rate-limit 미적용. |
| `ai-search` | `searchProducts()` 호출부 (Server Action / route) | **20 req / 1min** | `user → ip` | AI API 비용 방어. 정상 사용자는 분당 ≤ 5회 검색. 자동화는 즉시 컷. |

### 3.1 Bypass List (rate-limit 자체를 적용하지 않음)

| Path / 호출 | 사유 |
|-----|------|
| `/api/payments/webhook/toss` | 외부 파트너; signature + `tosspayments-webhook-transmission-id` 멱등([ADR-0013]/[ADR-0016])이 진짜 게이트. 합법적 재시도 폭주를 떨어뜨리면 결제 데이터 무결성에 더 큰 위험. |
| `/api/cron/process-refunds` | 내부 워커, `CRON_SECRET` 인증. cron 스케줄 자체가 자연 제한([ADR-0005]). |
| `/api/csp-report` | 브라우저 자동 보고; 한도 초과 시 위반 로그 손실. envelope-first 디자인([ADR-0021] 정신)으로 noise 필터가 이미 존재. |
| `/api/health` | 운영자 uptime 모니터; 절대 `429` 반환 금지. |
| `_next/static`, `_next/image`, `favicon.ico` | 정적 자산. 기존 middleware matcher가 이미 제외. |

### 3.2 Algorithm — Sliding Window 채택

**Sliding Window** (`Ratelimit.slidingWindow(limit, window)`):
- 시간 윈도우 경계에서의 *수퍼버스트* 회피 (Fixed Window의 weakness).
- 짧은 burst는 흡수, 지속 폭주는 부드럽게 감쇄 — credential stuffing·card testing 패턴에 부합.
- Upstash 공식 권장 기본값.

**거부한 대안**:
- **Token Bucket** — 단발 burst 허용은 페이먼트/AI에 부적합(공격자가 매분 max burst 소비).
- **Fixed Window** — 윈도우 경계에서 2× burst 가능, sliding보다 약함.

ADR 후보: 본 결정은 단순 알고리즘 선택이지만 §4(통합 위치)와 함께 `ADR-0022 — Rate Limit 다계층 + Hybrid 통합` 단일 박제 권장.

---

## 4. 통합 포인트 — Hybrid (권장)

> **결정 (Proposed)**: Edge 미들웨어가 `global` baseline을, 각 route handler / Server Action wrapper가 `auth | payment | ai-search` tier-specific 제한을 적용한다. **둘 다 사용한다**.

### 4.1 옵션 비교

#### Option A — 미들웨어 단일 통합 (글로벌 Edge 게이트)

```ts
// src/middleware.ts (개념도)
export default auth(async (req) => {
  const id = await identifyClient(req);  // user → ip
  const tier = pickTierByPathname(req.nextUrl.pathname);
  const verdict = await enforce(tier, id);
  if (!verdict.ok) return reject429(verdict);
  return /* CSP nonce + traceId 박제는 기존 그대로 */;
});
```

| (+) Pro | (−) Con |
|---|---|
| 모든 `/api/*` 진입 차단 → Function 콜드스타트 비용 발생 전 컷 | tier 판정이 **pathname 매칭**에 의존 — 새 라우트 추가 시 매칭 누락 위험 |
| 단일 진입점, 누수 없음 | Server Actions는 페이지 path에 POST → middleware에서 tier 식별 모호 (form data 안 봐야 함) |
| Edge runtime 친화 (`@upstash/ratelimit` REST 호환) | tier별 식별자 다름(`auth`=ip, `payment`=user) → middleware에 복잡 분기 |
| | 미들웨어 한 줄 버그가 *전 서비스* 차단 폭발 반경 |

#### Option B — 라우트/액션 개별 통합

```ts
// src/app/api/payments/confirm/route.ts (개념도)
export const POST = withObservedRoute("payments.confirm",
  withRateLimit("payment", async (req) => {
    /* 기존 로직 */
  })
);
```

| (+) Pro | (−) Con |
|---|---|
| tier·식별자 선언이 *call site에 명시* — 새 라우트는 자체 결정 | 새 라우트가 wrapper 호출 잊으면 보호 누락 |
| Server Actions(`features/*/server/actions.ts`)도 동일 패턴 | 볼륨 DoS 시 Function 콜드스타트 비용 100% 발생 |
| middleware는 CSP/auth/nonce만 담당 — 책임 분리 | 운영자가 `/api/*` 단일 검토로 보호 범위 파악 불가 |

#### Option C — **Hybrid** (채택)

```ts
// src/middleware.ts — global baseline 만
export default auth(async (req) => {
  if (isRateLimitablePath(req.nextUrl.pathname)) {
    const id = await identifyClient(req);  // user → ip
    const verdict = await enforce("global", id);
    if (!verdict.ok) return reject429(verdict);
  }
  /* 기존 CSP nonce + traceId 박제 그대로 */
});

// src/app/api/payments/confirm/route.ts — tier-specific
export const POST = withObservedRoute("payments.confirm",
  withRateLimit("payment", { idStrategy: "userOnly" }, handler)
);
```

| 책임 | 위치 | tier |
|------|------|------|
| 볼륨 DoS 컷오프 (콜드스타트 절약) | middleware | `global` 100/10s |
| 도메인별 정밀 한도 (auth/payment/ai) | route + Server Action wrapper | `auth` 5/min, `payment` 10/min, `ai-search` 20/min |

**왜 Hybrid가 옳은가**:
- middleware는 *식별자만 알면 충분*한 1차 게이트 — pathname 분기를 단순 bypass list만 검사.
- tier 식별의 복잡도(`auth`=ip-only, `payment`=user-only, `ai-search`=user→ip)는 call site의 wrapper 인자로 *명시 선언*. 검토 시 한 줄 grep으로 보호 여부 확인 가능.
- 미들웨어 한 줄 버그 폭발 반경 제한 — `global` tier만 영향, 도메인 tier는 격리.
- Edge runtime 호환: `@upstash/ratelimit`은 REST API 기반이라 미들웨어·Node 함수 양쪽 동작.

**거부 사유 (Option A)**: tier 판정을 pathname에 묶으면 `/api/payments/webhook/toss`(bypass) vs `/api/payments/confirm`(tier=payment) 같은 미세 분기가 middleware에 누적 → 회귀 위험. Server Action은 더 모호.

**거부 사유 (Option B)**: 볼륨 DoS 시 모든 함수가 호출되어 비용·콜드스타트 폭증. middleware Edge 컷이 *비용 방어선*으로서 가치 있음.

### 4.2 Server Action 처리

Server Action(`signInWithProvider`, `signOutAction`)은 페이지 경로에 POST되므로 middleware에서 tier 식별이 불가능. **wrapper helper로 감싼다**:

```ts
// src/features/auth/server/actions.ts
import { withRateLimitAction } from "@/shared/lib/rate-limit";

export const signInWithProvider = withRateLimitAction(
  "auth",
  { idStrategy: "ipOnly" },
  async (formData: FormData) => { /* 기존 로직 */ }
);
```

- 위반 시 `redirect("/login?error=RATE_LIMITED")` — `AuthError` 분기와 정합.
- AI 검색 Server Action(`features/search/server/search.ts`) 동일 적용.

---

## 5. 식별자 (Identifier) 전략

### 5.1 우선순위

```ts
// shared/lib/rate-limit/identifier.ts (개념)
type IdStrategy = "userFirst" | "ipOnly" | "userOnly";

function identify(req: NextRequest, strategy: IdStrategy): string {
  if (strategy !== "ipOnly") {
    const userId = req.auth?.user?.id;  // middleware: req.auth (NextAuth wrapper)
    if (userId) return `user:${userId}`;
  }
  if (strategy === "userOnly") {
    throw new Error("UNAUTHENTICATED");  // 401로 즉시 응답
  }
  return `ip:${getClientIp(req)}`;
}
```

### 5.2 IP 추출 — 신뢰 가능한 헤더만

Vercel 환경에서 클라이언트 IP는 **Vercel이 정규화해 박는 헤더만 신뢰**:

```ts
function getClientIp(req: NextRequest): string {
  // 1) Vercel: x-vercel-forwarded-for (정규화된 첫 hop)
  // 2) 표준: x-forwarded-for의 첫 항목 (proxy chain의 leftmost = 클라이언트)
  // 3) fallback: x-real-ip
  // 4) 절대 fallback: "unknown" → 모두 같은 버킷에 들어가므로 운영 시 경고
  const xvff = req.headers.get("x-vercel-forwarded-for");
  if (xvff) return xvff.split(",")[0].trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}
```

**왜 첫 hop인가**: proxy chain은 *왼쪽 = 클라이언트, 오른쪽 = 마지막 proxy*. Vercel 앞단의 X-Forwarded-For는 클라이언트가 임의 주입 가능하지만, **Vercel이 그 위에 정규화된 `x-vercel-forwarded-for`를 덮어쓴다**. 그래서 Vercel 헤더 우선.

**`unknown` 버킷의 위험**: 모든 알 수 없는 IP가 한 버킷에 들어감 → 정상 사용자 1명이 한도 소비 시 다른 unknown 사용자도 차단. dev 환경 외엔 `unknown` 발생 시 Sentry warn breadcrumb.

### 5.3 tier별 strategy 매핑

| Tier | Strategy | 이유 |
|------|----------|------|
| `global` | `userFirst` | 인증된 사용자는 user-bucket(IP 변화 영향 없음), 익명은 IP |
| `auth` | `ipOnly` | 인증 전이므로 user-id 없음. 브루트포스는 IP가 자연 식별자 |
| `payment` | `userOnly` | 결제는 반드시 인증 후. 401 명시적 응답 가능 |
| `ai-search` | `userFirst` | 비용 방어 — 익명 검색도 IP로 제한 |

---

## 6. 응답 컨벤션

### 6.1 정상 응답 (모든 요청에 헤더 박제)

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1717000123  // epoch seconds
```

> 디버깅·튜닝·운영자가 응답만 보고 남은 quota 확인. 정상 사용자도 자기 quota를 알 수 있음.

### 6.2 차단 응답 (`enforce` 모드)

```
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1717000180
Retry-After: 47

{
  "error": "RATE_LIMITED",
  "tier": "payment",
  "retryAfterSeconds": 47,
  "traceId": "abc123def456..."
}
```

- `traceId`는 기존 미들웨어가 박은 값 재사용.
- 응답 본문 메시지는 i18n 대상 — 일단 영문 코드만 노출, 클라이언트가 messages.json으로 매핑.
- Server Action 시: `redirect("/login?error=RATE_LIMITED&retryAfter=47")`.

### 6.3 Shadow 모드 (`RATE_LIMIT_MODE=shadow`)

- 한도 초과 감지하지만 **차단하지 않음**. `X-RateLimit-Limit` 헤더만 박고 `429` 대신 정상 응답 통과.
- 로그: `logger.warn("rate_limit.shadow.exceeded", { tier, identifier: hash(id), traceId })`.
- Sentry breadcrumb (level=warning) — 점진 롤아웃 중 정상 사용자 영향 측정.
- 운영 안정화 후 `enforce`로 전환. CSP_MODE 패턴([Phase 3 B2-B] 5a54d85·543707c) 그대로.

---

## 7. Fail-Open 강등 정책

> **원칙: 보안 게이트가 *우연한 미설정/장애*로 정상 사용자를 차단하면 안 된다.**
> 이는 [feedback-dev-external-io]("미설정=강등") 정신과 동일.

| 상태 | 동작 | 로그 레벨 |
|------|------|----------|
| Upstash env 미설정 (`UPSTASH_REDIS_REST_URL` 또는 `UPSTASH_REDIS_REST_TOKEN` 부재) | rate-limit 비활성, `enforce(tier)` = `{ok: true, remaining: -1}` 반환 | `info` 1회 부팅 시 (운영자 인지용) |
| Upstash 응답 timeout (>500ms) | 해당 요청 통과, 후속 요청에 영향 없음 | `warn` + Sentry breadcrumb |
| Upstash 예외 (네트워크/HTTP 5xx) | 해당 요청 통과 | `warn` + Sentry breadcrumb |
| 정상 차단 (`429`) | 차단 + Retry-After | `info` (운영 추세 분석용) |

**근거 / 거부한 대안**:
- *Fail-closed* 거부: 캐시 graceful 패턴([feedback-dev-external-io] · `cacheGet/cacheSet`) 선례 + 정상 사용자 영향(서비스 다운)이 공격 통과(웹훅 멱등 + 결제 화이트리스트 + auth 가드 등 *downstream gate가 살아있음*)보다 큰 손실.
- 운영 환경 *boot-fail* 거부: B2-C가 Upstash 프로비저닝보다 먼저 머지될 수 있음. 미설정은 `info` 로그로 발견 가능. 운영 환경에서 Upstash *required* 격상은 별 ADR(0023 후보) — Phase 3 B2-D 이후.

**테스트 시나리오** (QA Engineer R1):
1. `unset UPSTASH_REDIS_REST_URL && curl /api/payments/confirm` → 200 (rate-limit 비활성)
2. 잘못된 토큰 주입 + curl 11회 → 모두 200 (장애 강등 — 차단되지 않음을 *증거*로 확인)
3. 정상 Upstash + curl 11회 → 11번째 `429` + `Retry-After` 헤더 검증

---

## 8. 인프라 / 환경 변수

### 8.1 신규 의존성

```json
"@upstash/ratelimit": "^2.0.5"   // dependencies 추가
// @upstash/redis 는 이미 ^1.38.0 설치됨 (M-CACHE [ADR-0004])
```

`@upstash/ratelimit`는 `@upstash/redis` 클라이언트를 받아 동작. 기존 `src/shared/lib/cache/redis.ts`의 lazy singleton 패턴 재사용 — *동일 클라이언트 인스턴스를 cache + rate-limit가 공유*. 연결 풀·콜드스타트 비용 1회.

### 8.2 환경 변수

`src/shared/lib/env.ts`에 추가:

```ts
// Phase 3 B2-C: Rate limit 모드.
// 'shadow'   — 한도 초과를 로그만 남기고 차단하지 않음 (점진 롤아웃).
// 'enforce'  — 한도 초과 시 429 차단.
// 미설정 시 middleware/wrapper가 'enforce'를 기본으로 사용 (안전 기본값).
RATE_LIMIT_MODE: z.enum(["shadow", "enforce"]).optional(),
```

`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`은 **이미 존재**(M-CACHE), 별도 추가 불필요. Upstash 인스턴스 1개로 cache + rate-limit 양쪽 운영(접두어 prefix로 키 충돌 차단).

**CSP_MODE 패턴 정합**: B2-B의 `CSP_MODE=enforce|report-only`와 동일 형태. 운영자가 한 패턴만 익히면 됨.

### 8.3 Redis 키 네임스페이스

```
ratelimit:v1:<tier>:<identifier>
  예: ratelimit:v1:payment:user:cm7xz...
  예: ratelimit:v1:auth:ip:203.0.113.42
```

- 버전 prefix `v1` — tier 카탈로그 변경 시 무리 없이 마이그레이션.
- cache 키(`search:v1:`, M-CACHE)와 prefix 충돌 없음.
- Upstash analytics가 prefix별 hit/miss 가시화.

### 8.4 `.env.example` 추가

```dotenv
# Phase 3 B2-C: Rate limit (속도 제한)
# 'enforce' (기본/권장) — 한도 초과 시 429 응답
# 'shadow'              — 한도 초과를 로그만 남기고 차단하지 않음 (점진 롤아웃)
# 미설정 = 'enforce'
RATE_LIMIT_MODE=enforce
```

---

## 9. FSD 모듈 구조

```
src/shared/lib/rate-limit/
  index.ts              # barrel: enforce, withRateLimit, withRateLimitAction, RATE_LIMIT_TIERS
  tiers.ts              # TIER_CATALOGUE: { global, auth, payment, "ai-search" } → {limit, window, idStrategy}
  identifier.ts         # identify(req, strategy), getClientIp(req), hashIdForLog(id)
  client.ts             # lazy singleton: Ratelimit instance per tier, shared @upstash/redis client
  enforce.ts            # enforce(tier, id) → {ok, limit, remaining, reset} (primitive — middleware 직사용)
  withRateLimit.ts      # route handler wrapper (NextRequest → NextResponse)
  withRateLimitAction.ts# Server Action wrapper (FormData | args → result | redirect)
  responseHeaders.ts    # buildRateLimitHeaders(verdict) → Record<string,string>
  __tests__/
    tiers.test.ts             # 카탈로그 회귀(values + idStrategy 매핑)
    identifier.test.ts        # IP 추출 우선순위·strategy 분기
    enforce.test.ts           # 모의 Upstash로 한도 도달·shadow·fail-open 시나리오
    withRateLimit.test.ts     # route handler 통합 (헤더·429·통과)
    withRateLimitAction.test.ts # Server Action 통합 (redirect on RATE_LIMITED)
```

### 9.1 단방향 의존성

- `shared/lib/rate-limit` — 다른 shared/lib·외부 패키지만 의존(env, logger, observability, @upstash/*).
- `app/api/**/route.ts`, `features/**/server/actions.ts`가 import.
- `entities/**`, `widgets/**` 직접 import 금지 (도메인 무지).

### 9.2 미들웨어 통합 (Edge runtime)

```ts
// src/middleware.ts (개념도 — 기존 CSP/nonce/traceId 로직 위에 추가)
import { enforce, identify, RATE_LIMIT_BYPASS } from "@/shared/lib/rate-limit";

export default auth(async (req) => {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const isBypass = RATE_LIMIT_BYPASS.some(p => pathname.startsWith(p));

  if (isApi && !isBypass) {
    const id = identify(req, "userFirst");
    const verdict = await enforce("global", id);
    if (!verdict.ok) {
      const res = NextResponse.json(
        { error: "RATE_LIMITED", tier: "global", retryAfterSeconds: verdict.retryAfter, traceId },
        { status: 429 }
      );
      Object.entries(buildRateLimitHeaders(verdict)).forEach(([k, v]) => res.headers.set(k, v));
      res.headers.set("Retry-After", String(verdict.retryAfter));
      res.headers.set("x-trace-id", traceId);
      return res;
    }
  }

  /* 기존 CSP nonce + redirect + auth-required 로직 그대로 */
});
```

- **Edge 호환성**: `@upstash/ratelimit`은 REST 기반이라 `fetch`만 사용. ALS/Prisma 불필요 (`backend-expert R2-4` 준수).
- **부트 비용**: 클라이언트 lazy singleton → 첫 호출에만 인스턴스 생성. 이후 함수 재사용.

---

## 10. 테스트 전략 (TDD — QA Engineer R5)

### 10.1 단위 테스트

| 파일 | 검증 사항 |
|------|-----------|
| `tiers.test.ts` | TIER_CATALOGUE의 4개 tier 존재, limit/window 양수, idStrategy enum 유효. 회귀 가드. |
| `identifier.test.ts` | x-vercel-forwarded-for > x-forwarded-for > x-real-ip 우선순위, `unknown` 폴백. strategy `userOnly`에서 인증 없을 시 throw. |
| `enforce.test.ts` | Upstash mock으로 (1) 한도 내 통과, (2) 한도 초과 차단, (3) Upstash 예외 시 fail-open, (4) shadow 모드 동작. |
| `withRateLimit.test.ts` | route handler가 정상 응답에 헤더 박제, 429 시 본문/Retry-After 검증. |
| `withRateLimitAction.test.ts` | Server Action이 한도 초과 시 redirect("/login?error=RATE_LIMITED&retryAfter=N"). |

### 10.2 통합 테스트 (런타임 증거 수집 — QA R8)

```bash
# 1) tier별 한도 검증 (`enforce` 모드)
for i in $(seq 1 11); do
  curl -s -o /dev/null -w "%{http_code} " \
    -X POST http://localhost:3000/api/payments/confirm \
    -H "Cookie: $SESSION" -H "Content-Type: application/json" \
    -d '{"orderId":"x","paymentKey":"y","amount":1000}'
done
# 기대: 200×10, 429×1 → 11번째에 X-RateLimit-Remaining=0, Retry-After 헤더 박힘

# 2) bypass 검증
curl -i http://localhost:3000/api/health      # 헤더 X-RateLimit-* 없음
curl -i -X POST http://localhost:3000/api/payments/webhook/toss ... # 동일

# 3) fail-open 검증
unset UPSTASH_REDIS_REST_URL
for i in $(seq 1 200); do curl -s -o /dev/null -w "%{http_code} " /api/products; done
# 기대: 200×200 (모두 통과 — rate-limit 강등)

# 4) shadow 모드
RATE_LIMIT_MODE=shadow npm run dev
# 11번째 요청도 200, 로그에 "rate_limit.shadow.exceeded" 1회
```

### 10.3 ADR 후보 메모

- **ADR-0022** — Rate Limit 4-tier + Hybrid 통합 (Edge baseline + route wrapper)
- **ADR-0023** — Fail-open 정책 (운영 환경 boot-required 거부, B2-D에서 재검토)
- (선택) **ADR-0024** — `unknown` IP 버킷 처리 — Sentry breadcrumb로 가시화만, 분리 버킷화 거부

---

## 11. 단계별 롤아웃 계획 (Plan 작성 시 가이드)

1. **T1** — `@upstash/ratelimit` 설치 + `env.ts`에 `RATE_LIMIT_MODE` 추가 (`.env.example` 동시 갱신).
2. **T2** — `shared/lib/rate-limit/{tiers,identifier,client,enforce,responseHeaders}.ts` + 단위 테스트 (TDD: 테스트 → 구현).
3. **T3** — `shared/lib/rate-limit/{withRateLimit,withRateLimitAction}.ts` + 단위 테스트.
4. **T4** — 미들웨어 통합 — `global` tier만, **`RATE_LIMIT_MODE=shadow` 기본**으로 점진 롤아웃.
5. **T5** — `auth` tier 적용 (`signInWithProvider`).
6. **T6** — `payment` tier 적용 (`/api/payments/confirm`).
7. **T7** — `ai-search` tier 적용 (`searchProducts`).
8. **T8** — `.env.example`/CLAUDE.md §8 업데이트, ADR-0022 박제.
9. **T9** — `RATE_LIMIT_MODE=enforce` 승격 (사용자 승인 게이트). QA Engineer R8 증거 첨부.

각 Task는 별도 PR / commit, plan에 체크박스로 박제 (CLAUDE.md §4.1 / §4.2 절대 규칙).

---

## 12. Decision Gate — 사용자 승인 대기

본 스펙은 다음 결정을 박제 후보로 제안한다 (사용자 승인 시 ADR-0022로 정식 박제):

1. **Tier 카탈로그 — 4 tier (global/auth/payment/ai-search)** + bypass 5종 (§3, §3.1)
2. **Sliding Window 알고리즘 채택** (§3.2)
3. **Hybrid 통합** — Edge middleware (global) + route/action wrapper (tier-specific) (§4 Option C)
4. **Fail-open 강등** + 운영 환경 boot-required 거부 (§7)
5. **`RATE_LIMIT_MODE=shadow|enforce` 토글로 점진 롤아웃** (§6.3, §11)

승인 시 다음 단계: `superpowers:writing-plans` 스킬로 실행 가능한 체크박스 plan 작성(`docs/superpowers/plans/2026-05-28-rate-limit.md`).

---

## 참조

- [feedback-dev-external-io] — 미설정 = 강등, NODE_ENV 분기 없이
- [ADR-0004] — 캐시 2-layer (M-CACHE Upstash Redis)
- [ADR-0005] — Cron Worker 멱등성
- [ADR-0009] / [ADR-0014] — NO-REAL-MONEY env 강제
- [ADR-0013] / [ADR-0016] — Toss webhook v2 envelope + cross-check 검증
- [ADR-0020] — 캐시 무효화 컨트랙트 + force-dynamic audit
- [ADR-0021] — Sentry SDK 채택
- CLAUDE.md §5 — Non-negotiable 절대 규칙
- CLAUDE.md §6.1 — ADR 발행 기준
- OWASP ASVS V2.2 — Authentication Rate Limiting
- Upstash Ratelimit docs — Sliding Window 알고리즘
