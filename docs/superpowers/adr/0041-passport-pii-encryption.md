# ADR-0041: 여권번호(PII) 컬럼 단위 AES-256-GCM 암호화 + `enc:v1:` envelope lazy 마이그레이션 (Phase 12)

- **상태**: Accepted
- **결정일**: 2026-06-06
- **영향 범위**: `src/shared/lib/crypto/`, `src/shared/lib/env.ts`, `src/features/passport-profile/server/actions.ts`, `src/entities/user/api/queries.ts`, `src/entities/booking/api/mutations.ts`, `src/shared/lib/observability/pii.ts`, `scripts/encrypt-passports.ts`
- **관련 commit**: `33e8ac1` `72bc63c` `306c62c` `fed4f87` `551f598` `e38cacc` `7a1916a`

## Context (배경)

`PassportProfile.passportNo`(마이페이지 여권)와 `Traveler.passportNo`(예약 동행자 여권)가 DB에 **평문으로 저장**되고 있었다. 코드·스키마에 "운영 전 암호화 필요" TODO만 박혀 있던 보안 부채. 여권번호는 단독으로도 민감 PII이며, DB 덤프·백업 유출 시 즉시 노출된다. 이미 운영 데이터(평문 row)가 존재할 수 있으므로 **무중단 전환**이 필요했고, 새 컬럼 추가/스키마 마이그레이션 없이 기존 컬럼을 그대로 쓰면서 점진 전환할 방법이 요구됐다.

조사 결과 `passportNo`는 **검색·유니크 검사에 전혀 사용되지 않는다**(쓰기 후 마스킹 읽기만 존재). 따라서 결정적(deterministic) 암호화나 blind index가 불필요 → 랜덤 IV 기반 비결정적 암호화가 안전하게 가능.

## Decision (결정)

- **알고리즘**: AES-256-GCM. 12바이트 랜덤 IV(호출마다 새로), 16바이트 auth tag. 저장 포맷 `enc:v1:` + base64(`iv || authTag || ciphertext`). (`src/shared/lib/crypto/passport-crypto.ts`)
- **버전드 envelope + lazy 마이그레이션**: `decrypt()`는 `enc:v1:` prefix가 없으면 평문으로 간주해 **그대로 반환**한다. 배포 직후 평문 row도 읽기가 정상 동작하고, 다음 쓰기 때 자동으로 암호화로 수렴한다.
- **멱등 백필**: `scripts/encrypt-passports.ts`가 기존 평문을 일괄 암호화. `isEncrypted()` 스킵 + `encrypt()` 자체 idempotency 가드 이중 방어로 재실행 안전, per-row 에러 격리.

```ts
export function encrypt(plaintext: string): string {
  if (isEncrypted(plaintext)) return plaintext;          // 이중 암호화 방지(멱등)
  const iv = randomBytes(IV_LENGTH);                      // 호출마다 새 IV
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv, { authTagLength: TAG_LENGTH });
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ENC_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}
export function decrypt(value: string): string {
  if (!isEncrypted(value)) return value;                 // 레거시 평문 passthrough(하위 호환)
  /* ...iv/tag/ciphertext 분해 후 GCM 복호화... */
}
```

- **키 관리**: 단일 `ENCRYPTION_KEY`(base64, 디코드 시 32바이트). `env.ts`에서 (a) production 필수 (b) 포맷(32바이트) 검증. crypto 모듈은 lazy + memoized 로더로 첫 사용 시점에만 키를 검증(부팅 import 시 비-여권 플로우는 무영향). `import "server-only"`로 클라이언트 번들 유입 차단.
- **읽기 마스킹**: `getPassportProfile`은 `maskPassportNo(decrypt(...))` — 복호화 후 마스킹이라 클라이언트엔 항상 마스킹값(`M1****78`)만 노출.
- **암호화 대상은 `passportNo` 한 필드로 한정**(이름/생년월일은 평문 유지). 로그 스크러버(`pii.ts`)에 `passportNo` 키를 추가해 로그/에러 직렬화 시 `[REDACTED]`.

## Consequences (결과)

**얻은 것:**
- DB at-rest에서 여권번호가 암호문으로 저장 — 덤프/백업 유출 내성.
- 스키마 변경 0 (기존 `String` 컬럼 재사용). 배포-백필 사이 혼재 상태도 정상 동작.
- envelope 버전(`enc:v1:`)으로 향후 키 로테이션/알고리즘 교체(`enc:v2:`) 여지 확보.
- admin 예약 상세 client island에 traveler 전체 객체를 넘기던 **기존 과잉 직렬화(Phase 8)**를 안전 DTO 매핑으로 봉합 — passportNo·birthDate·phone·email이 더 이상 브라우저 RSC 페이로드로 새지 않음.

**포기한 것 / 미해결:**
- `passportNo`로 DB 검색 불가(랜덤 IV 비결정적) — 현재 소비자가 없어 무영향이나, 향후 검색 요구 시 blind index(HMAC) 별도 도입 필요.
- **키 로테이션 미구현** — `enc:v1:` 단일 키 가정. 키 교체 시 전수 재암호화 스크립트 + `enc:v2:` 분기 필요(envelope가 이를 위한 자리만 마련).
- **Traveler 읽기 경로 복호화 부재** — 현재 `traveler.passportNo`를 화면에 렌더하는 소비자가 없어 의도적으로 미구현. 향후 admin이 동행자 여권을 봐야 하면 복호화+마스킹 경로 추가 필요(노출 vs 마스킹은 제품 결정).

## Alternatives Considered (대안)

### 옵션 A: 별도 `encrypted_passport_no` 컬럼 추가 + 점진 백필
- 새 컬럼 추가 → 백필 → 평문 컬럼 drop의 3단계 마이그레이션.
- 거부: 스키마 마이그레이션 2회 + 두 컬럼 동기화 윈도우 동안 읽기 분기 복잡. 기존 컬럼 재사용 + envelope prefix가 동일 안전성을 더 단순하게 달성.

### 옵션 B: 일회성 백필만 (lazy passthrough 없음)
- 배포와 동시에 스크립트로 전체 평문을 한 번에 암호화.
- 거부: 백필 누락/실패 row가 1건이라도 있으면 읽기 복호화가 throw(페이지 크래시). lazy passthrough가 안전망 — 백필 전/중에도 평문 row를 정상 처리하고 점진 수렴.

### 옵션 C: 결정적 암호화(고정 IV) 또는 blind index
- 동일 평문 → 동일 암호문이라 검색/유니크 검사 가능.
- 거부: `passportNo`는 검색 대상이 아님(YAGNI). 고정 IV는 GCM에서 치명적(nonce 재사용 → 평문 복원 가능). 비결정적 랜덤 IV가 보안상 정석.

### 옵션 D: 라이브러리(`@noble`, `libsodium` 등) 도입
- 거부: Node 네이티브 `crypto`로 AES-256-GCM이 충분. 의존성 추가 없이 표준 라이브러리로 해결.

## Notes

- 모니터링: 배포 후 `scripts/encrypt-passports.ts` 실행 → 로그의 `encrypted N, skipped M, errors E` 확인. errors > 0이면 멱등 재실행.
- 6개월 뒤 의심 포인트: "왜 Traveler는 복호화 경로가 없지?" → 소비자 부재로 의도적 미구현(위 미해결 참조). "왜 검색이 안 되지?" → 랜덤 IV 비결정적(옵션 C 참조).
- `env.ts`의 `ENCRYPTION_KEY` base64 길이 검증은 Node `Buffer` 의존 → Edge runtime에서 실행 금지(middleware import 주의, 기존 "no Prisma in middleware" 제약과 동류).
- 테스트는 실 crypto 사용(`vitest.setup.ts`의 더미 32바이트 키). crypto/env를 mock하지 않아 라운드트립·tamper·멱등성이 실제 AES-GCM으로 검증됨.
- **배포 후 발견된 빌드 함정 (server-only × fat barrel)**: `passport-crypto.ts`의 `import "server-only"`(부수효과 전용 import라 트리셰이킹에서 제거되지 않음)가 `@/entities/booking` 배럴을 통해 'use client' 컴포넌트(CancelBookingButton·CheckoutForm)의 클라 번들로 끌려가 `node:crypto` Unhandled scheme 으로 `npm run build` 실패. `typecheck`/`vitest`(server-only를 mock alias)는 이 경로를 못 잡는다 — **server-only/배럴 경계 변경 시 반드시 `npm run build` 로 검증할 것.** 해소: booking 슬라이스에 client-safe 서브배럴 `@/entities/booking/client.ts`(순수 model/constants/schemas/transitions/progress만, `./api/*` 제외)를 신설하고 두 클라 컴포넌트를 거기로 재지정. `index.ts`(server 포함 fat barrel)는 server importer 전용으로 유지. 향후 'use client' 에서 booking 슬라이스 import 시 반드시 `/client` 사용. (user 슬라이스는 `import type` 만 클라에서 쓰여 erase 되므로 분리 불요.) 더 근본적으론 모든 슬라이스의 `index.ts`=client-safe / `server.ts`=server 로의 전면 분리가 이상적이나 영향 범위가 커 후속 과제로 남김.
