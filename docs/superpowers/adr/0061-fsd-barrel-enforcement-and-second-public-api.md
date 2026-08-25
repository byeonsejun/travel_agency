# ADR-0061: FSD R2(배럴 공개 API)를 lint로 강제 — 예외 목록 대신 "두 번째 공개 API" 설계

- **상태**: Accepted
- **결정일**: 2026-08-25
- **영향 범위**: `eslint.config.mjs`, `src/features/auth/server.ts`(신규), `src/widgets/{product-card-list,product-detail}/index.ts`(신규), `src/features/rum/index.ts`, deep import 42곳, `docs/superpowers/skills/architect.md`
- **관련 commit**: `e924f09`(위젯 배럴), `824a9c7`(auth/server 서브배럴), `97bd8c3`(타입 import), `2b8806a`(잔여 9건), `56a6188`(lint 강제), `1d2797d`·`9cf9fed`(architect.md), merge `1356476`·`bd05c3e`

## Context (배경)

`architect.md` R2는 "슬라이스는 배럴(`@/{layer}/{slice}`)로만 소비한다, 깊은 경로 import 금지"를 규정한다. 그런데 이 저장소가 **그 규칙이 지켜지지 않는다는 것을 스스로 증명하고 있었다.**

`architect.md`의 Action 출력 샘플(`:96-99`)은 `[Major] R2 - Barrel 우회`의 예시로 이렇게 적고 있었다:

```
- file: src/app/(site)/products/page.tsx:8
- problem: '@/widgets/product-card-list/ui/ProductCardList' 깊은 import
- fix: '@/widgets/product-card-list'
```

이 예시는 가상 사례가 아니라 **실제 코드였고, 문서에 위반 예시로 박제된 채로 그대로 남아 있었다.** 페르소나 문서가 매 작업마다 로드되도록 설계돼 있었음에도(§3.2 매트릭스) 위반은 해소되지 않았다. 즉 **문서 규칙 + 자가 리뷰만으로는 경계가 유지되지 않는다** — 이것이 이 ADR의 출발점이다.

실측(`no-restricted-imports` 초안을 임시 config로 실행):

```
총 위반 50건
  33건 @/features/auth/server/auth        ← 단일 경로에 66% 집중
   2건 @/entities/booking/client          ← 문서화된 client-safe 서브배럴(의도)
   3건 @/features/rum/model/*             ← 배럴이 심볼을 노출하지 않아 불가피
  12건 나머지(배럴에 이미 있는데 깊은 경로로 감 — 습관)
```

핵심은 **33건이 게으름이 아니었다**는 점이다. `features/auth/index.ts`는 `auth()`와 함께 `'use client'` 아일랜드 5종(`OAuthLoginButtons`/`LogoutButton`/`UserNavIsland`/`SessionPoll`/`AuthSuccessClient`)을 re-export한다. RSC page·route handler·Server Action이 `auth()` 하나 때문에 배럴을 쓰면 **쓰지도 않는 client 그래프가 서버 모듈에 딸려온다.** 개발자들은 그걸 피해 깊은 경로로 내려간 것이다 — 규칙을 어긴 게 아니라 **규칙을 지킬 방법이 없었다.**

## Decision (결정)

**33건을 lint 예외 목록에 넣지 않고, `features/auth/server.ts`를 정식 "두 번째 공개 API"로 승격했다.** 이미 존재하던 `entities/booking/client.ts`와 정확히 대칭인 반대 방향 엔트리다.

```
entities/booking/client.ts : client 코드가 server 그래프를 끌어오지 않게 하는 엔트리
features/auth/server.ts    : server 코드가 client 그래프를 끌어오지 않게 하는 엔트리
```

```ts
// src/features/auth/server.ts — 헤더에 제약 근거를 명시(booking/client.ts 동형)
export { auth, handlers, signIn, signOut } from "./server/auth";
```

그 위에서 lint 규칙을 켰다. 예외는 **이름이 아니라 패턴** 두 개뿐이며, 둘 다 "회피구"가 아니라 선언된 계약이다:

```js
// eslint.config.mjs
"no-restricted-imports": ["error", { patterns: [{
  group: [
    "@/entities/*/*", "@/features/*/*", "@/widgets/*/*",
    "!@/entities/*/client",   // client → server 그래프 차단 엔트리
    "!@/features/*/server",   // server → client 그래프 차단 엔트리
  ],
  message: "FSD R2: 슬라이스 배럴(@/{layer}/{slice})로 import하세요. …",
}]}]
```

**작업 순서가 이 결정의 본질이다:**

1. 규칙을 **지킬 수 있게** 만든다 — 배럴 신설 3개(위젯 2 + auth/server), rum 배럴 확장.
2. 위반을 **0으로 만든다** — 50 → 0.
3. 그제서야 규칙을 **강제한다** — lint error.

순서가 반대였다면(먼저 규칙을 켜고 걸리는 것을 예외 처리) `@/features/auth/server/auth` 33건이 그대로 예외 목록에 들어가 **규칙에 66%짜리 구멍**을 내고 시작했을 것이다.

## Consequences (결과)

**얻은 것:**
- R2가 문서 규칙에서 **lint 게이트**로 승격 — 새 위반은 편집기에서 즉시 빨간 줄, CI에서 error.
- 슬라이스가 용도별 공개 API를 갖는 패턴이 **대칭으로 확립** — `client.ts`/`server.ts` 쌍은 이제 관용구다.
- 깊은 경로 import 50 → **0건**. 도메인 로직 0줄 변경, 렌더 모드 **49/49 무변경**.
- `architect.md`에 강제 주체를 명시(`1d2797d`) + R2 샘플을 "과거 실재 위반, 현재 해소"로 표기(`9cf9fed`) — 규칙이 강제되는지 아닌지를 다음 사람이 구분할 수 있다.

**포기한 것 / 미해결 (known gap):**
- **`tests/`·`scripts/` 미린트** — `eslint.config.mjs`의 `ignores: ["**/*", "!src/**"]` 때문에 lint 범위가 `src/`뿐이다. E2E 헬퍼가 슬라이스를 깊은 경로로 파고들어도 잡히지 않는다.
- **상대경로 cross-slice import 미탐지** — 규칙은 `@/` alias만 본다. `../../features/x/ui/y` 형태는 통과한다(R6 위반이지만 미탐지). 현재 그런 코드는 0건이지만 구조적으로 열려 있다.
- 두 gap 모두 **패턴 매칭이 아니라 레이어 그래프를 아는 도구**(옵션 B/C)라야 닫힌다. 의도적으로 열어둔 채 다음 단계로 넘긴다.

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: `@/features/auth/server/auth`를 예외 목록에 추가 (기각)
- 가장 빠른 길. lint 규칙에 그 경로 한 줄만 `!`로 뚫으면 33건이 즉시 해소된다.
- **거부 이유: 그건 규칙에 구멍을 내는 것이지 규칙을 세우는 게 아니다.** 예외가 위반 건수의 66%를 차지하면 "배럴로만 import한다"는 규칙은 사실상 무의미해진다. 더 나쁜 것은 선례다 — 다음에 불편한 경로가 나오면 또 예외를 추가하게 되고, 예외 목록은 단조증가한다.
- 결정적으로, 33건은 **정당한 필요**(server가 client 그래프를 안 끌어오려는 것)에서 나왔다. 정당한 필요는 예외가 아니라 **API로 승격**시켜야 한다. 예외는 그 필요를 문서화되지 않은 채로 방치하지만, `server.ts`는 헤더 주석으로 제약 근거를 박제한다.
- 참고로 "배럴을 쓰면 빌드가 깨지나?"는 **실측했다** — route handler 1곳을 배럴 import로 바꿔 `npm run build`를 돌린 결과 정상 컴파일. 즉 하드 제약이 아니라 그래프 위생 문제였고, 그래서 더더욱 "예외"가 아니라 "설계"로 다룰 사안이었다.

### 옵션 B: `eslint-plugin-boundaries` 즉시 도입 (보류)
- element type 매핑을 선언하면 R1(레이어 역방향·동일 레이어 cross-slice)까지 잡는다. 표현력은 우리가 채택한 규칙보다 명백히 위다.
- **보류 이유: 도입 자체가 지연될 위험.** 요소 타입 매핑 설계 + 기존 코드와의 충돌 조정에 학습비용이 든다. 그 논의가 끝날 때까지 R2는 계속 강제되지 않은 채 남는다 — 지금 막을 수 있는 50건을 "더 좋은 도구"를 기다리며 방치하는 것은 나쁜 거래다.
- 단계적 도입으로 간다: 지금 R2를 0비용으로 막고(의존성 0, 설정 30줄), R1까지 강제가 필요해지면 그때 도입한다. 위 known gap 2건이 그 트리거다.

### 옵션 C: `dependency-cruiser` (후순위)
- 규칙 표현력 최상(순환참조·고아 모듈까지) + 그래프 시각화 + CI 단독 실행.
- **후순위 이유: 편집기 즉시 피드백이 없다.** 별도 실행 단계(`npm run depcruise`)라 개발자는 커밋/CI 시점까지 위반을 모른다. 규칙의 목적이 "위반을 애초에 못 쓰게 하는 것"이라면 타이핑하는 순간 빨간 줄이 뜨는 쪽이 우선이다. CI 게이트로 **병행**할 가치는 있으므로 폐기가 아니라 후순위.

### 옵션 D: `steiger`(FSD 전용 린터) (보류)
- 이 프로젝트 아키텍처에 정확히 대응하는 전용 도구.
- 생태계 규모·성숙도 편차가 있고, 우리 관습(서브배럴 2종 예외)을 표현할 수 있는지 미검증. 옵션 B가 먼저다.

## Notes

- **검증(음성 대조군)**: 위반이 0건일 때 "규칙이 잘 도는 것"과 "규칙이 아무것도 매칭 못 하는 것"은 출력이 동일하다. 그래서 임시 프로브 파일로 규칙 발동을 직접 확인했다(확인 후 삭제):
  ```
  @/widgets/product-card-list/ui/ProductCardList → error   (차단됨)
  @/features/auth/server                         → 통과    (예외 동작)
  @/entities/booking/client                      → 통과    (예외 동작)
  ```
- **롤아웃**: 33곳을 한 번에 바꾸지 않고 3곳 → build 확인 → 나머지 30곳 순으로 진행. 단계마다 `npm run build`로 렌더 모드(홈 `○` 5m / PDP `◐` / `/api/rum` `ƒ`)가 바뀌지 않는지 확인했다 — 번들 그래프에 구조적 변화가 없다는 가장 직접적인 신호.
- **`vi.mock` 주의**: 15개 테스트가 `vi.mock("@/features/auth/server/auth")`로 **하부 모듈**을 mock한다. 서브배럴이 그 모듈을 re-export하므로 mock은 그대로 관통한다(테스트 1324 green이 증거). mock 경로를 서브배럴로 올리지 말 것 — 하부 모듈을 잡아야 재-export 경로 전부가 커버된다.
- **6개월 뒤 의심받을 부분**: "왜 auth만 `server.ts`가 있지? 다른 feature도 만들어야 하나?" → 아니다. `server.ts`/`client.ts`는 **배럴이 양쪽 그래프를 섞어 노출할 때만** 만든다. 섞이지 않은 슬라이스는 `index.ts` 하나로 충분하다. 예외 패턴(`@/features/*/server`)이 열려 있다고 해서 관성적으로 만들 이유는 없다.
- 연계: [ADR-0048](./0048-admin-design-tokens-and-domain-tone-separation.md)(FSD 경계 수호 — shared는 도메인 enum을 모른다), [ADR-0053](./0053-next16-cache-components-global-migration.md)(client→배럴→`use cache` 누출 15건 — 배럴이 그래프를 섞을 때 무슨 일이 생기는지 보여준 선례).
