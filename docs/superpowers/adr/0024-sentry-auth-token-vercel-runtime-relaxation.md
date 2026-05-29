# ADR-0024: SENTRY_AUTH_TOKEN runtime 차단 invariant — Vercel 예외 분기

- **상태**: Accepted
- **결정일**: 2026-05-29
- **영향 범위**: `src/shared/lib/env.ts`, `src/shared/lib/__tests__/env.test.ts`
- **관련 commit**: (이 ADR과 동반)
- **선행 ADR**: ADR-0021 (Sentry SDK 채택 — runtime 차단 invariant 최초 도입)
- **보완 관계**: ADR-0021 의 "Vercel 운영 체크리스트: `SENTRY_AUTH_TOKEN` scope = Build only" 항목이 *Vercel UI 에 해당 scope 가 존재한다는 잘못된 가정* 위에 박혔다. 본 ADR 이 그 가정을 수정한다.

## Context (배경)

ADR-0021 이 채택한 `env.ts` `superRefine` 의 SENTRY_AUTH_TOKEN runtime 차단:

```ts
if (env.SENTRY_AUTH_TOKEN && process.env.NEXT_PHASE !== "phase-production-build") {
  // 부팅 차단 → sourcemap upload token leak 방어
}
```

는 `NEXT_PHASE` 가 *빌드 단계에만* `phase-production-build` 라는 사실에 의존했다. 가정: Vercel UI 에 "Build only" scope 가 있어 token 을 빌드 phase 에만 주입하면 runtime 에서는 token 부재 → 차단 발동 안 함.

**실제 Vercel UI 는 Build-only scope 가 없다.** Production / Preview / Development scope 셋만 존재하며, Production 을 선택하면 *빌드와 런타임 양쪽에 같은 값* 이 주입된다. 첫 production 배포(2026-05-29) 에서:

1. 사용자가 SENTRY_AUTH_TOKEN 을 Production + Preview scope 로 등록 (Build-only 옵션 부재)
2. middleware (Edge runtime) 호출 시 `envSchema.parse(process.env)` 가 token 존재 + `NEXT_PHASE` 부재 조합으로 zod 검증 실패
3. 매 요청 `MIDDLEWARE_INVOCATION_FAILED` (HTTP 500) — 전 사이트 down

ADR-0021 의 가정 자체가 틀렸으므로 invariant 를 그대로 둘 수 없다. 동시에 *비-Vercel 배포 환경* (Docker / bare metal / 외부 CI runner) 에서는 원래의 token leak 방어선이 여전히 가치 있다.

## Decision (결정)

`env.ts` superRefine 의 SENTRY_AUTH_TOKEN 차단 분기에 **Vercel runtime detection 예외** 를 추가한다.

```ts
const isBuildPhaseForAuth =
  process.env.NEXT_PHASE === "phase-production-build";
const isVercelRuntime =
  process.env.VERCEL === "1" && !isBuildPhaseForAuth;

if (env.SENTRY_AUTH_TOKEN && !isBuildPhaseForAuth && !isVercelRuntime) {
  // 비-Vercel runtime 노출 → 차단 유지
}
```

- `process.env.VERCEL === "1"` 은 Vercel 이 모든 빌드/런타임 환경에서 자동 주입하는 sentinel.
- 빌드 phase 가 *아니면서* Vercel runtime 이면 → token 통과 허용 (차단 skip).
- 보안은 다층 방어선으로 대체:
  - **(a)** Sentry **org token scope = `org:ci`** (sourcemap upload 권한 한정 — DSN/이슈/사용자 데이터 접근 0)
  - **(b)** Vercel **"Sensitive" 옵션** (대시보드 UI 마스킹, 다른 팀원 노출 차단)
  - **(c)** 런타임 코드의 token 참조 0건 (`withSentryConfig` 가 빌드 phase 만 사용 — `errorTracker.ts` / SDK config 어디서도 `env.SENTRY_AUTH_TOKEN` 참조 X)

## Consequences (결과)

**얻은 것:**
- Vercel production 배포가 정상 동작 — middleware/Edge 부팅 차단 해소.
- ADR-0021 의 "Build only scope" 잘못된 가정 정정 — 후속 작업자가 같은 실수 반복 안 함.
- 비-Vercel 환경의 token leak 방어선은 *그대로 유지* — Docker / bare metal / 외부 CI 에서 runtime 노출 시 여전히 fail-fast.
- ADR-0021 의 후속 작업("Sentry sourcemap 복구") 완결 — runtime crash 없이 sourcemap upload pipeline 재가동 가능.

**포기한 것 / 미해결:**
- Vercel runtime 에서 `process.env.SENTRY_AUTH_TOKEN` 이 *읽기 가능* 한 상태로 남는다. 코드가 의도적으로 참조하지 않아도, **악의적 third-party dependency** 가 `process.env` 전체를 dump 한다면 token 누출 가능.
  - 완화: scope 가 `org:ci` 로 제한되어 손상 범위는 sourcemap upload 만 (이슈 조회, DSN 변경, 사용자 데이터 접근 불가).
  - 완화: Sentry 대시보드에서 token rotation 즉시 가능 (1-click).
- Vercel UI 가 향후 "Build only scope" 를 도입한다면 본 예외는 *더 엄격한 원래 invariant 로 복귀* 가 가능 — `isVercelRuntime` 분기 제거하고 ADR-0024 를 `Superseded` 처리.

## Alternatives Considered (대안)

### 옵션 A: Vercel runtime 예외 분기 ✅ 채택
- 채택 이유: ADR-0021 의 *원래 방어선 의도* (비-Vercel 환경에서의 token leak 방어) 를 보존하면서 Vercel 의 platform 한계만 우회. 코드 변경 4줄, 테스트 추가 1건. 다층 방어선으로 보안 손실 제한적.

### 옵션 B: SENTRY_AUTH_TOKEN runtime 차단 invariant 전면 제거
- 어떤 방식: ADR-0021 의 superRefine 블록 자체 삭제. token 이 어디서 노출되든 부팅 통과.
- 거부 이유: 비-Vercel 환경 (Docker / bare metal / 외부 CI) 의 방어선까지 함께 잃는다. 본 프로젝트가 향후 self-host 옵션으로 옮길 가능성을 0 으로 가정할 수 없음. ADR-0021 의 *원래 invariant* 가치를 부분이라도 보존하는 게 합리적.

### 옵션 C: Vercel runtime 에서 SENTRY_AUTH_TOKEN 을 강제 `undefined` 로 strip (zod `.transform()`)
- 어떤 방식: superRefine 통과 후 `.transform()` 으로 env 객체에서 `SENTRY_AUTH_TOKEN` 키 자체를 제거.
- 거부 이유: `process.env.SENTRY_AUTH_TOKEN` 은 여전히 읽기 가능 (Node `process.env` 는 zod schema 와 분리). 코드 차원 보호 효과 *환상* — 어떤 dependency 가 `process.env` 를 dump 하면 그대로 노출. 복잡도 증가 대비 실효 0. 옵션 A 가 트레이드오프 측면에서 더 솔직.

### 옵션 D: Vercel CLI `vercel env add --scope=build` 같은 CLI escape hatch 사용
- 어떤 방식: Vercel CLI 에 향후 "Build only" 옵션이 추가되기를 가정하고 그때까지 미해결로 둔다.
- 거부 이유: Vercel CLI 2026-05 시점 기준 Build only scope 미지원. 사이트 down 을 풀지 못함. 가설적 외부 변화 대기 = 운영 정지.

### 옵션 E: SENTRY_AUTH_TOKEN 을 Vercel 에 등록하지 않고 sourcemap upload 포기
- 어떤 방식: token 미등록 → `withSentryConfig` 가 sourcemap upload 시도 skip → 빌드 통과 (단, runtime 정상). production 에러 발생 시 minified stack trace 만 노출.
- 거부 이유: Phase 3 B2 의 *관측 기반* 목표 (ADR-0021 의 핵심 동기) 와 정면 충돌. production debug 효율성 큰 손실. *임시* 회피로는 가능 (현재 사이트 동작 확인 단계에서 실제로 적용했음), 영구 해결책으로는 부적합.

## Notes

- **운영 체크리스트 갱신** (ADR-0021 의 잘못된 항목 정정):
  - ~~`SENTRY_AUTH_TOKEN` scope = Build only~~ ❌
  - ✅ `SENTRY_AUTH_TOKEN` scope = Production + Preview, **Sensitive 옵션 ON**, token type = **Organization Token (`org:ci`)**.
- **token rotation 절차** 박제: 누출 의심 시 Sentry → Settings → Developer Settings → Organization Tokens → 해당 token Revoke → 신규 생성 → Vercel env 갱신 → Redeploy. 절차 < 5분.
- **6개월 뒤 의심받을 가능성**:
  - Vercel 이 "Build only" scope 도입 시 본 ADR 의 예외 분기는 *불필요* — 그때 ADR-0021 의 원래 invariant 복귀하고 본 ADR 을 Superseded 처리.
  - `process.env.VERCEL` sentinel 이 향후 다른 값으로 바뀌면 (예: `"true"`) 분기가 무용지물. Vercel docs 의 환경변수 spec 변경 감시 필요.
  - 비-Vercel 자체 배포로 이전한다면 (예: Cloudflare Workers, AWS Lambda) 본 분기는 자동으로 *원래 invariant 동작* 으로 회귀 — `process.env.VERCEL` 미설정 → `isVercelRuntime=false` → 차단 발동.
