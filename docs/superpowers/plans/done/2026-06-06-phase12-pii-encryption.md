# Phase 12 — 여권 정보(PII) 암호화 구현 계획

> 설계 승인: 2026-06-06. 범위 = `passportNo`만(이름/생년 평문 유지), `PassportProfile` + `Traveler` 둘 다,
> `enc:v1:` envelope prefix 기반 lazy 마이그레이션 + 일회성 백필. 알고리즘 AES-256-GCM (Node `crypto`).

## 아키텍처 결정 (확정)

- **암호화 대상**: `PassportProfile.passportNo`, `Traveler.passportNo` (둘 다 컬럼 단위).
- **알고리즘**: AES-256-GCM. IV 12바이트 랜덤, auth tag 16바이트. 저장 포맷 `enc:v1:` + base64(`iv || authTag || ciphertext`).
- **쿼리 불필요**: `passportNo`로 검색/유니크 검사 전무 → 랜덤 IV(비결정적) 안전, blind index 불요.
- **하위 호환(lazy)**: `decrypt()`는 `enc:v1:` prefix 없으면 평문으로 간주해 그대로 반환. 다음 쓰기 때 암호화로 수렴.
- **백필**: `scripts/encrypt-passports.ts` — 멱등(`isEncrypted` 스킵), 기존 평문을 일괄 암호화.
- **키 관리**: `ENCRYPTION_KEY` (base64, 디코드 시 32바이트). `env.ts`에서 검증, production 필수.
- **레이어**: 유틸은 `shared/lib/crypto/`(도메인 무지) + `import "server-only"`(클라 번들 차단).

---

## Task 1 — 암호화 유틸 + env 키 관리

- [x] `src/shared/lib/crypto/passport-crypto.test.ts` 작성 (TDD, FAIL 먼저):
  - [x] `encrypt` → `decrypt` 라운드트립이 원문 복원
  - [x] `encrypt` 출력은 `enc:v1:`로 시작하고 평문과 다름
  - [x] 같은 입력을 두 번 암호화하면 서로 다른 ciphertext (랜덤 IV)
  - [x] `decrypt`에 평문(prefix 없음) 전달 시 그대로 반환 (하위 호환)
  - [x] `isEncrypted` true/false 판별
  - [x] 변조된 ciphertext는 `decrypt`에서 throw (GCM 무결성)
- [x] `src/shared/lib/crypto/passport-crypto.ts` 구현:
  - [x] `import "server-only"`, `ENC_PREFIX = "enc:v1:"`
  - [x] 키 로더: `env.ENCRYPTION_KEY` base64 디코드, 32바이트 아니면 throw (lazy/memoized)
  - [x] `encrypt(plaintext: string): string`, `decrypt(value: string): string`, `isEncrypted(value: string): boolean`
  - [x] barrel/직접 import 경로 정리 (필요 시 `shared/lib/crypto/index.ts`)
- [x] `src/shared/lib/env.ts`: `ENCRYPTION_KEY: z.string().optional()` 추가 + superRefine에 (a) production 필수 (b) 존재 시 base64→32바이트 검증
- [x] `vitest.setup.ts`: `ENCRYPTION_KEY` 더미(유효 32바이트 base64) 주입 (모듈 부팅 fail-fast 방지)
- [x] `npm run test -- passport-crypto` / `npm run typecheck` 통과 증거

## Task 2 — PassportProfile 쓰기/읽기 경로 연동

- [x] `src/features/passport-profile/server/__tests__/actions.test.ts` 갱신 (TDD):
  - [x] upsert에 전달되는 `passportNo`가 `isEncrypted` true임을 검증 (create·update 양쪽)
- [x] `src/features/passport-profile/server/actions.ts`: upsert 전 `passportNo`를 `encrypt()` (평문 TODO 주석 제거)
- [x] `src/entities/user/api/queries.ts` `getPassportProfile`: `maskPassportNo(decrypt(row.passportNo))`로 변경 (복호화 후 마스킹)
- [x] queries 테스트: 암호화 row → 복호화 후 올바른 마스킹 / 평문 row(레거시) → 동일 마스킹 (하위 호환)
- [x] `npm run test` 관련 스위트 / `npm run typecheck` 통과 증거

## Task 3 — Traveler 쓰기 경로 연동 (예약 도메인)

- [x] `src/entities/booking/api/mutations.ts:74`: `passportNo: t.passportNo ? encrypt(t.passportNo) : t.passportNo` (optional null 통과)
- [x] booking mutations 테스트: traveler 생성 시 passportNo가 암호화되어 저장됨 검증 (null이면 null 유지)
- [x] 💳 Domain Booking 자가점검: 좌석/금액/멱등성/트랜잭션 무손상 (암호화는 순수 문자열 변환, 트랜잭션 내 외부 IO 추가 없음)
- [x] `npm run test` booking 스위트 / `npm run typecheck` 통과 증거

## Task 4 — 백필 스크립트

- [x] `scripts/encrypt-passports.ts` 작성:
  - [x] `PassportProfile` 전체 조회 → `isEncrypted` 아닌 row만 `encrypt` 후 update (멱등)
  - [x] `Traveler` passportNo not-null 조회 → `isEncrypted` 아닌 row만 `encrypt` 후 update (멱등)
  - [x] `if (process.env.NODE_ENV !== "test")` 가드 + `db.$disconnect()` finally
  - [x] 진행 로그 (`✓ ...`)
- [x] `scripts/encrypt-passports.test.ts`: 멱등성(2회 실행해도 이중 암호화 없음) + 평문→암호화 전환 단위 검증 (순수 헬퍼 분리)
- [x] `npm run test` 스크립트 스위트 통과 증거 (5/5 pass)

## 최종 검증 (QA Engineer)

- [x] `npm run typecheck` 전체 통과
- [x] `npm run test` 전체 통과 (981/981, env+backfill 보강 후)
- [x] `npm run lint` 통과 (Phase 12 변경분 무경고; 기존 checkout 2건 무관)
- [x] `grep -rn "use client" src/shared/lib/crypto` → 없음 (server-only 경계)
- [x] `git diff docs/superpowers/plans/` 체크박스 반영 확인
- [x] ADR 작성 — [ADR-0041] 키 관리 + lazy 마이그레이션 결정 박제
