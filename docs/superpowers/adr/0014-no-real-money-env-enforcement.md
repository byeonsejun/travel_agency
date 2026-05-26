# ADR-0014: NO-REAL-MONEY env 강제 — `test_` 화이트리스트 격상 (블랙리스트 → 화이트리스트)

- **상태**: Accepted
- **결정일**: 2026-05-26
- **영향 범위**: `src/shared/lib/env.ts`, `src/shared/lib/__tests__/env.test.ts`
- **관련 commit**: 본 ADR과 동반 커밋
- **연결**: [ADR-0009](./0009-no-real-money-env-invariant.md) (블랙리스트 도입), [CLAUDE.md §5 NO-REAL-MONEY](../../../CLAUDE.md), [feedback_no_real_money](../../../../../.claude/projects/-Users-apple-Desktop-coding-travel/memory/feedback_no_real_money.md)

## Context (배경)

ADR-0009는 `TOSS_CLIENT_KEY` / `TOSS_SECRET_KEY` 가 `live_` prefix로 시작하면 부팅을 차단하는 **블랙리스트** invariant를 도입했다. 그러나 ADR-0009의 *미해결* 항목과 ADR README의 *향후 후보 0014(가칭)* 라인이 이미 갭을 지목해 두었다:

- 블랙리스트는 `live_` 단일 prefix만 차단한다 — `prod_…`, `real_…`, prefix가 아예 없는 raw 키, Toss 외 PG의 운영 키, placeholder 문자열 등이 무방비로 통과한다.
- CLAUDE.md §5의 정확한 표현은 *"허용 상한은 토스 샌드박스 테스트 키(`test_`) 까지"* — 즉 정책 자체가 화이트리스트인데 코드는 블랙리스트로 인코딩되어 표현 차이가 있었다.
- 운영 배포(production) 시점에 누군가 `live_` 가 아닌 다른 prefix로 운영 키를 주입하면 ADR-0009 invariant를 우회한다. fail-fast 의도가 손상된다.

운영 배포가 가시권에 들어왔으므로, "허용 상한 = `test_`" 정책을 그대로 코드에 박제하는 *화이트리스트* 로 격상한다.

## Decision (결정)

`src/shared/lib/env.ts`의 `envSchema.superRefine` 안 NO-REAL-MONEY 블록을 블랙리스트(`startsWith("live_")`)에서 **화이트리스트(`!startsWith("test_")`)** 로 전환한다. 키가 설정되어 있으면(truthy) 반드시 `test_` 로 시작해야 부팅을 통과한다. (optional 부재는 기존대로 통과 — production 의 required 강제는 동일 superRefine 의 다른 블록이 담당.)

```ts
for (const key of ["TOSS_CLIENT_KEY", "TOSS_SECRET_KEY"] as const) {
  const val = env[key];
  if (val && !val.startsWith("test_")) {
    const prefixHint = val.startsWith("live_") ? "live(실거래) 키" : `'${val.slice(0, 8)}…'`;
    ctx.addIssue({
      code: "custom",
      path: [key],
      message:
        `${key}: test_ 샌드박스 키만 허용됩니다 (NO-REAL-MONEY, ADR-0014). ` +
        `현재 ${prefixHint} — live_ 등 운영/임의 prefix는 부팅에서 차단됩니다.`,
    });
  }
}
```

`envSchema` 단위 테스트가 18 → 21 건으로 확장된다 (신규 3건: `prod_` prefix 거부 / prefix 없는 raw 키 거부 / `NODE_ENV=production` 에서도 `test_` 외 prefix 차단).

## Consequences (결과)

**얻은 것:**
- **표현 일치**: 정책(*test\_ 까지만*) 과 코드(*test\_ 화이트리스트*) 가 동일 방향으로 인코딩됨. 6개월 뒤 코드만 보고도 정책이 자명함.
- **공격면 축소**: `live_` 외 임의 prefix(`prod_`, `real_`, 키 자체)도 모두 fail-fast. PG 변경/실수성 운영 키 주입을 단일 invariant로 흡수.
- **운영 배포 안전성**: production 빌드에서도 `test_` 강제 — 이게 곧 *NO-REAL-MONEY*의 코드 invariant 완성. ADR-0009 미해결 항목 해소.
- **오류 메시지 진단성**: 차단된 prefix가 `live_` 인지 그 외인지 메시지에 노출 — 운영자가 즉시 어떤 키가 잘못 주입됐는지 판별.
- **회귀 0건**: 21 테스트 (18 기존 + 3 신규) GREEN, 전체 511 테스트 GREEN.

**포기한 것 / 미해결:**
- **자체 사인 키 호환성 상실**: 향후 토스 외 PG(예: 카카오페이, 이니시스) 도입 시 `test_` prefix 가정이 깨진다. PG별 키 패턴 매트릭스가 필요해지면 화이트리스트가 PG별 분기로 확장돼야 함 — 별도 ADR로 격상 검토.
- **prefix 매칭의 취약성**: Toss가 향후 키 포맷을 바꾸면 (`tk_test_…` 같은 형태) 이 invariant가 깨질 수 있다. 단, 그 변경은 깨지는 순간 부팅이 막혀 즉시 가시화되므로 *silent* 실패는 아님.
- **production 환경의 실제 가동 시점**: 본 ADR은 코드 invariant만 박제. 실제 production 배포 인프라(Vercel, 환경변수 주입 채널)에서 운영 키 차단은 별도 배포 절차로 보장 필요.

## Alternatives Considered (대안)

### 옵션 A: 블랙리스트 확장 — `live_`, `prod_`, `real_` 다중 prefix 거부
- 차단할 운영 prefix들을 명시적으로 enumerate.
- **거부 이유**: 미래 추가될 운영 prefix(`mainnet_`, `lv_`, …)를 사전에 모두 알 수 없다. 누락 1건이 곧 우회 경로 1건. *"무엇을 허용할지"* 명시가 *"무엇을 금지할지"* 나열보다 본질적으로 안전(deny-by-default).

### 옵션 B: production 환경에서만 화이트리스트, 그 외 환경은 블랙리스트 유지
- `NODE_ENV === "production"` 일 때만 `test_` 강제.
- **거부 이유**: 환경 분기 자체가 invariant 신뢰도를 떨어뜨린다. dev/test에서도 `prod_…` 키가 통과되는 경로가 있으면 누군가 그 경로로 우회 가능. 모든 환경에서 동일 invariant가 가장 단순하고, *실제 부담* 도 없다 — 어차피 모든 환경의 키는 `test_` 다.

### 옵션 C: regex 화이트리스트 — `/^test_(ck|sk)_/`
- 키 종류(ck/sk)와 prefix를 동시에 검증.
- **거부 이유**: 토스 키 포맷의 상세 패턴이 향후 변경될 가능성이 있고, 검증 책임이 *invariant*(NO-REAL-MONEY)와 *포맷 적합성*(토스 키 모양) 두 가지로 섞이면 한쪽 변경이 다른 쪽을 깨뜨린다. 본 ADR은 NO-REAL-MONEY 단일 책임만 강제하고, 포맷 검증은 토스 SDK/API 응답이 fail-fast로 처리하도록 위임.

### 옵션 D: 별도 invariant 모듈로 분리 — `shared/lib/paymentKeyInvariant.ts`
- envSchema 외부에서 독립 검증.
- **거부 이유**: ADR-0009 alternatives D 와 동일 — envSchema 가 단일 source of truth. 분리 시 import 순서/circular 위험, 호출 누락 가능성, 부팅 fail-fast 약화.

## Notes

- **연쇄 ADR**: 본 ADR은 ADR-0009의 미해결 항목 (*"production 환경에서도 test_ 키만 허용 — 향후 ADR-0012(가칭)으로 격상 검토"*) 의 후속. 단, 실제 번호는 0012가 PDP 작업에 선점되어 0014로 부여.
- **README 인덱스 처리**: `docs/superpowers/adr/README.md` 의 *향후 후보 0014(가칭)* 라인을 *인덱스* 로 승격, *향후 후보* 섹션에서 해당 항목 제거.
- **6개월 뒤 의심받을 가능성**:
  - "왜 webhook secret은 빠졌나?" → ADR-0016 cross-check 채택으로 env 자체 제거됨. 본 ADR 시점에 검증할 대상이 아님.
  - "왜 dev 환경에서도 test\_ 강제?" → dev = 개인 토스 샌드박스 검증 환경 (test\_ 키 + 운영 도메인 = 토스 샌드박스 응답). dev에서 운영 키를 쓰는 시나리오 자체가 NO-REAL-MONEY 위반이므로 환경 분기 불필요.
  - "Toss 외 PG 도입 시 어떻게?" → 위 Consequences 참조. 그 시점에 PG별 화이트리스트 매트릭스로 확장 후 새 ADR.
