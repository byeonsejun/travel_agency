# ADR-0009: NO-REAL-MONEY 경계의 코드 강제 — env Zod superRefine

- **상태**: Accepted
- **결정일**: 2026-05-20
- **영향 범위**: `src/shared/lib/env.ts`, `src/shared/lib/__tests__/env.test.ts`, `vitest.setup.ts`, `vitest.config.ts`
- **관련 commit**: 본 ADR과 동반 커밋
- **연결**: [CLAUDE.md §5 NO-REAL-MONEY](../../../CLAUDE.md), [feedback_no_real_money](../../../../../.claude/projects/-Users-apple-Desktop-coding-travel/memory/feedback_no_real_money.md)

## Context (배경)

`CLAUDE.md §5`의 **NO-REAL-MONEY** 제약은 "라이브 실거래(`live_` 키 + 운영 토스 API) 절대 구현 금지"를 명시한 사용자 영구 결정사항이다. 그러나 이 규칙은 지금까지 **문서**에만 존재했다 — 즉:

- 향후 작업자(인간/AI)가 CLAUDE.md를 읽지 않거나 잘못 해석하면 `.env`에 `live_ck_…`를 적어 부팅이 가능해진다.
- 테스트 환경(`NODE_ENV=test`)에서 누군가 `PAYMENT_FORCE_REAL=1` + 운영 토스 도메인 조합을 실험하면 `feedback_dev_external_io` 원칙(테스트는 항상 Mock)이 깨지고, 무의식 중에 외부 토스 호출이 발생할 수 있다.
- 기존 `envSchema.superRefine`은 `TOSS_CLIENT_KEY`/`TOSS_SECRET_KEY`의 `live_` prefix만 차단했고 `TOSS_WEBHOOK_SECRET`은 누락(대칭성 결여), 테스트 환경의 외부 결제 IO도 검사하지 않았다.

ADR README의 *향후 후보 0009* 라인이 이 갭을 정확히 지목했다. 본 ADR은 문서 규칙을 **코드 invariant**(부팅 자체를 막는 검증)로 격상한다.

## Decision (결정)

`src/shared/lib/env.ts`의 Zod `envSchema.superRefine` 본문에 3가지 invariant를 추가하고 `envSchema`를 export하여 단위 테스트로 박제한다.

```ts
// (1) live_ 키 부팅 차단 — client/secret/webhook 3종 대칭
for (const key of ["TOSS_CLIENT_KEY", "TOSS_SECRET_KEY", "TOSS_WEBHOOK_SECRET"] as const) {
  const val = env[key];
  if (val && val.startsWith("live_")) {
    ctx.addIssue({ code: "custom", path: [key], message: `${key}: live(실거래) 키는 금지됩니다 (NO-REAL-MONEY). test_ 샌드박스 키만 허용.` });
  }
}

// (2) NODE_ENV=test에서 외부 결제 IO 차단
if (env.NODE_ENV === "test") {
  if (env.PAYMENT_FORCE_REAL) {
    ctx.addIssue({ code: "custom", path: ["PAYMENT_FORCE_REAL"], message: "PAYMENT_FORCE_REAL: NODE_ENV=test에서는 활성화 불가 (테스트는 Mock 폴백만 허용 — NO-REAL-MONEY)." });
  }
  if (/(^|\/\/)([^/]+\.)?tosspayments\.com($|\/)/i.test(env.TOSS_API_BASE_URL)) {
    ctx.addIssue({ code: "custom", path: ["TOSS_API_BASE_URL"], message: "TOSS_API_BASE_URL: NODE_ENV=test에서는 운영 토스 도메인 호출 금지 (localhost Mock만 허용)." });
  }
}
```

`envSchema`는 모듈 export로 노출되어 11건의 시나리오 테스트(`env.test.ts`)에서 `safeParse`로 검증된다.

## Consequences (결과)

**얻은 것:**
- **코드 레벨 fail-fast**: `live_` 키나 test 환경 외부 호출 조합이 `.env`에 들어오면 앱이 **부팅 자체가 실패**한다. 우회 불가.
- **문서·메모리·코드 3중 방어**: CLAUDE.md(문서) → feedback_no_real_money(메모리) → envSchema(코드)로 동일 invariant가 박제됨. 어느 한 채널이 휘발돼도 다른 채널이 잡는다.
- **대칭성 복원**: webhook secret이 처음으로 검사 대상에 포함됨.
- **테스트 신뢰성**: NODE_ENV=test는 항상 Mock 호출만 가능하다는 게 *환경 단위*로 보장된다. `feedback_dev_external_io` 원칙이 빌드 타임에 강제됨.
- **회귀 방지**: 11건 단위 테스트가 향후 변경 시 invariant 깨짐을 즉시 감지.

**포기한 것 / 미해결:**
- **vitest setupFile 의존**: 모듈 import 시점에 `envSchema.parse(process.env)`가 실행되므로 vitest용 dummy env(`vitest.setup.ts`) 폴백이 필요해졌다. CI에서 `.env` 자동 로드 안 되는 환경에서 한 번 노출되는 작은 부채.
- **production 환경에서도 `test_` 키만 허용**(우리 정책)은 ADR-0009에서 명시적 차단까지는 안 함 — production 키 자체가 not-required → required가 superRefine에서 검사되므로, 별도 invariant는 추가하지 않았다. 향후 운영 배포 시점에 ADR-0012(가칭)으로 격상 검토.
- **`PAYMENT_FORCE_REAL` 정의 변경 없음**: dev 환경에서는 여전히 토스 샌드박스 실거래 테스트 옵션으로 허용(`.env:PAYMENT_FORCE_REAL="1"` 현 상태 유지). NO-REAL-MONEY는 *실거래(live)*만 금지하지 *샌드박스*는 상한임을 재확인.

## Alternatives Considered (대안)

### 옵션 A: pre-commit hook으로 .env 스캔
- 파일 시스템 수준에서 `live_ck_`, `live_sk_` grep → block.
- **거부 이유**: hook은 우회 가능(`--no-verify`)하고, CI/CD 환경마다 다르게 구성됨. 또 `.env`가 아닌 다른 경로(`.env.local`, Vercel dashboard 시크릿 등)에서 주입되면 못 잡는다. **부팅 시점 invariant**가 우회 불가능한 단일 지점.

### 옵션 B: middleware/route handler에서 매 요청 검사
- `/api/payments/*` 진입 시점에 `process.env.TOSS_CLIENT_KEY.startsWith("live_")` 확인 후 403.
- **거부 이유**: (a) 매 요청 오버헤드, (b) 결제 외 경로(seed, script, cron)는 검사 누락, (c) 부팅 자체는 통과하므로 "이미 잘못된 키로 빌드된 이미지"가 만들어진다 — fail-fast 원칙에 어긋남.

### 옵션 C: Git pre-receive hook(서버 측)
- 원격 저장소가 `live_` 문자열을 거부.
- **거부 이유**: GitHub 단독 운영에선 서버 측 hook 사용 불가. Self-hosted Gitea/GitLab 전제. 인프라 종속.

### 옵션 D: 런타임 환경변수 검증을 별도 모듈로 분리(`shared/lib/envInvariant.ts`)
- 책임 분리.
- **거부 이유**: envSchema와 invariant가 *같은 source*에서 정의되어야 단일 진실 공급원이 유지된다. 분리 시 import 순서·circular dependency·"어디서 호출했는가" 불확실성 증가. superRefine은 이미 zod의 표준 확장점.

## Notes

- **부수 효과**: vitest 실행 시 `.env`를 자동 로드하지 않으므로 `vitest.setup.ts`에 dummy env 폴백 추가됨. 다른 테스트들은 기존 `vi.mock("@/shared/lib/env", …)` 패턴으로 모듈 자체를 모킹하므로 무영향.
- **확장 후보 (잠재 ADR)**:
  - 0010: `isCancelableByUser` SSOT (이미 향후 후보)
  - 0011: dev_mock 키 reconcile 스크립트 (이미 향후 후보)
  - 0012(가칭): production 환경에서도 test_ 키만 허용 — 운영 배포 시점에 발행 검토
- **6개월 뒤 의심받을 가능성**:
  - "왜 webhook secret까지 차단하는가?" → 대칭성과 운영 webhook을 dev/test에 흘려보낸 사고 차단 (실제 webhook 호출 가능 환경이므로 동일 레벨 invariant 필요)
  - "왜 dev는 PAYMENT_FORCE_REAL 허용하고 test만 차단?" → dev는 *개인 토스 샌드박스 실거래 검증* 의도된 경로(test_ 키 + 운영 도메인 = 토스 샌드박스). test는 *외부 IO 0* 원칙 — 다른 목적, 다른 invariant.
