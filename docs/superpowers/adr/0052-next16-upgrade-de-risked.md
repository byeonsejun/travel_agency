# ADR-0052: Next.js 16 업그레이드 — 배선만 교체, 캐시 재설계는 분리 (de-risked)

- **상태**: Accepted
- **결정일**: 2026-06-12
- **영향 범위**: `next.config.mjs`, `src/middleware.ts`, `package.json`, `src/features/**/server/actions.ts`, `eslint.config.mjs`
- **관련 commit**: `ccd5395` (Sentry 10 선행), `4483548` (Next 16 bump), `4e7b5a4` (revalidateTag), `1a96796` (Turbopack build), `d7a1e33` (ESLint 9)

## Context (배경)

Phase 5-B는 Next.js 15 → 16 메이저 범프다. 이 범프에는 두 개의 큰 변화가 동시에 얽혀 있다:

1. **프레임워크 버전 자체** — Turbopack 기본 빌드, `revalidateTag` 2-arg 강제, `middleware.ts` deprecation, `next lint` 제거, async params 표준화.
2. **캐시 철학 전환** — `unstable_cache` → Cache Components(`'use cache'` 지시어) 패러다임 이동.

이 두 변화를 한 번에 묶으면 "프레임워크 버전이 깨뜨린 것인지, 캐시 재설계가 깨뜨린 것인지"를 분리 진단할 수 없다. 롤백 단위도 비대해진다.

추가 외부 제약: `@sentry/nextjs@8`의 peer range가 `next ^15`까지만이라 Next 16 설치 즉시 peer conflict가 발생한다.

## Decision (결정)

**세 가지를 독립된 관심사로 분리하고 순서화한다.**

1. **`middleware.ts` 유지 (proxy.ts 거부)** — Next 16이 `middleware.ts`를 deprecated 처리하고 `proxy.ts`를 권장하지만, proxy는 Node.js 런타임에 고정된다. 우리의 미들웨어는 `next-auth@5 beta`(`auth()`), Upstash rate-limit, CSP nonce 생성을 Edge 런타임에서 실행한다. proxy 전환은 이 모든 Edge 실행 보장을 재검증해야 하므로 이번 범프 범위 밖이다. deprecation 경고는 의도적으로 수용한다.

2. **Cache Components 이연 (revalidateTag 2-arg만 방어)** — `unstable_cache` 37곳의 전면 재설계는 Phase 5-C로 격리한다. 이번엔 Next 16에서 TS 컴파일 에러를 유발하는 `revalidateTag(tag)` 단일인자 9곳만 `revalidateTag(tag, 'max')`로 교체한다. `'max'`는 stale-while-revalidate 프로파일로, 우리 캐시 레이어의 "약간의 지연 허용" 성격과 정합한다. 즉시성이 필요한 경우는 같은 Server Action의 `revalidatePath`가 병렬 보완한다.

3. **`@sentry/nextjs` 8 → 10을 Next 15 baseline에서 먼저 격리 업그레이드** — Sentry 10의 peer range는 `^13 || ^14 || ^15 || ^16`으로 양쪽을 지원한다. Next 15 상태에서 Sentry 10을 올리고 typecheck/test/build 그린을 확인한 뒤 Next 16을 범프하면, 이후 문제 발생 시 "Sentry 탓 vs Next 탓"을 즉시 분리할 수 있다.

## Consequences (결과)

**얻은 것:**
- Turbopack 기본 빌드가 Sentry 10 플러그인과 호환됨(`--webpack` 폴백 불요).
- Edge 미들웨어(`next-auth@5 beta`)가 Next 16에서 클린 컴파일.
- typecheck 0 errors / 1170 tests pass / lint 0 errors(10 pre-existing warnings) / build 그린.
- dev 스모크: `home 200` / `login 200` / `api-cron 401`(미인증 의도된 값) — 서버 부팅 및 미들웨어 라우팅 정상.
- ESLint 9 flat config 전환으로 `next lint` 제거(Next 16 breaking) 대응.
- `@sentry/nextjs` 8의 제거된 `hideSourceMaps` 옵션 정리.

**포기한 것 / 미해결:**
- `middleware.ts` deprecation 경고 잔존 — 의도적 수용. proxy.ts 마이그레이션은 Phase 5-C 이후 별도 에픽.
- `revalidateTag(tag, 'max')`는 stale-while-revalidate이므로 강한 즉시 일관성이 필요한 경우 `revalidatePath` 병행 의존. `updateTag`(read-your-writes) 전환은 Phase 5-C에서 Cache Components 도입 시 재논의.
- `next-auth@5 beta`의 공식 peer range가 아직 Next 16을 포함하지 않음 — `package.json` `overrides`로 `next-auth.next = $next` 핀 고정. next-auth beta가 Next 16 peer를 공식 지원하면 overrides 제거.
- `react-hooks@7` 신규 규칙 14개를 기존 baseline 유지 목적으로 비활성(`eslint.config.mjs`). `rules-of-hooks`·`exhaustive-deps` 클래식 규칙은 활성 유지. 재활성화는 Phase 5-C 별도 정리 태스크.

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: proxy.ts 마이그레이션 포함
- Next 16 마이그레이션 가이드가 `middleware.ts`를 `proxy.ts`로 교체하도록 권장.
- proxy는 Node.js 런타임에 고정 → `auth()`(Edge JWT 검증), Upstash Redis 클라이언트, CSP nonce(`crypto.getRandomValues`)의 Edge 실행을 전부 재검증해야 함.
- 이번 "배선만 교체" 목표를 벗어나고 Edge 보안 경계 재검증 비용이 커 거부.

### 옵션 B: Cache Components 지금 채택
- `'use cache'`로 `unstable_cache` 37곳을 교체하는 것은 캐시 전략 재설계 수준.
- 버전 범프와 섞이면 "버전 문제인가, 캐시 재설계 문제인가" 진단이 불가능해짐.
- 롤백 단위도 비대해져 리스크 격증. Phase 5-C로 격리 거부.

### 옵션 C: Sentry 9를 경유한 단계별 업그레이드 (8 → 9 → 10)
- 중간 상태(Sentry 9)에서의 검증이 추가 단계를 요구하며 상태가 애매해짐.
- Sentry 9가 Next 16 peer를 보장하지 않아 경유 의미가 없음.
- v8 → v10 직접 점프로 대체, 거부.

### 옵션 D: updateTag (read-your-writes) 즉시 채택
- `revalidateTag` 2-arg 마이그레이션 대신 `updateTag`로 더 강한 일관성 보장.
- Cache Components가 도입되지 않은 상태에서 `updateTag` 단독 도입은 과설계.
- `'max'` SWR 프로파일 + `revalidatePath` 병행으로 충분, Phase 5-C와 함께 재논의 거부.

## Notes

- **Phase 5-C 후속 작업**: Cache Components(`'use cache'`) 마이그레이션 + `updateTag` 채택 + `react-hooks@7` 신규 규칙 재활성화 + proxy.ts 마이그레이션 재논의.
- **next-auth 모니터링**: beta가 Next 16 peer를 공식 지원하면 `package.json` `overrides`의 `next-auth.next` 핀을 제거.
- **middleware deprecation**: Next 16 릴리스 노트에 timeline이 명시되면 proxy.ts 전환 에픽 선행 스케줄링 필요.
- ADR-0051(자체 RUM 파이프라인)과 번호 충돌 주의 — 이 ADR은 0052이다. `src/middleware.ts`의 주석이 Task 2에서 실수로 `ADR-0051`로 기재됐으나 Task 6에서 `ADR-0052`로 정정됨.
