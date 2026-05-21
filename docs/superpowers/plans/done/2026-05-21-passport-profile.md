# 2026-05-21 — Feature B: 마이페이지 여권 정보 관리 + 예약 내역 페이지네이션

> PRD §4.1B 「B2C 마이페이지 완성」 구현.
> 여권 정보 upsert, 민감 정보 마스킹, 예약 내역 오프셋 페이지네이션.

## Context

- 185833d 커밋으로 `PassportProfileForm`, `updatePassportProfile` Server Action, `BookingPaginator`, `listMyBookings` 페이지네이션이 구현 완료.
- 미완성: `maskPassportNo` 함수가 `features/passport-profile/ui/` (UI 레이어)에 위치 — Architect 규칙 위반.
  엔티티 레이어(`entities/user/model/`)로 이동하고, `getPassportProfile` 쿼리가 서버 응답 시 마스킹된 값을 반환하도록 수정 필요.

## Persona Activation

| 페르소나 | 발동 사유 |
|---|---|
| 🏛️ Architect | `entities/user` 레이어 수정, barrel 공개 API, FSD 단방향 |
| ⚙️ Backend Expert | `getPassportProfile` 반환 타입 변경, `SafePassportProfile` 타입 설계 |
| 🎨 Frontend Expert | `PassportProfileForm` props 타입 업데이트 |
| 🔬 QA Engineer | 작업 완료 보고 직전 자동 증거 수집 |

## Design Decisions

1. **마스킹 위치**: 서버 쿼리 응답 시점(`getPassportProfile`)에서 마스킹 적용 — 클라이언트에 원본 전달 금지.
2. **SafePassportProfile**: `Omit<PassportProfile, "passportNo"> & { passportNo: string }` — passportNo 필드는 동일한 이름이지만 값이 마스킹된 버전으로 대체.
3. **maskPassportNo 규칙**: 앞 2자 + `****` (길이 관계없이 고정 4개) + 뒤 2자. 총 길이 4 미만이면 `****`.
4. **Form defaultValue 제거**: `passportNo` input의 defaultValue는 비움 — 마스킹된 값이 저장되는 사고 방지. 마스킹 미리보기는 별도 `<p>` 태그로만 표시.
5. **TDD**: `mask.ts`는 순수 함수이므로 테스트 먼저 작성(RED) → 구현(GREEN) 순서.

## Files Touched

| 작업 | 파일 | 종류 |
|---|---|---|
| 신규 | `src/entities/user/model/__tests__/mask.test.ts` | Vitest |
| 신규 | `src/entities/user/model/mask.ts` | 순수 함수 |
| 수정 | `src/entities/user/model/types.ts` | SafePassportProfile 타입 추가 |
| 수정 | `src/entities/user/api/queries.ts` | getPassportProfile 반환 타입 변경 |
| 수정 | `src/entities/user/index.ts` | SafePassportProfile, maskPassportNo export |
| 수정 | `src/features/passport-profile/ui/PassportProfileForm.tsx` | props 타입 변경, 내부 maskPassportNo 제거 |

## Tasks

### Task 0 — PENDING_OPS.md 신설

- [x] `docs/superpowers/PENDING_OPS.md` 생성
  - `[ ] 카카오 OAuth 실제 클라이언트 ID/Secret 발급 및 콜백 URI 설정 (QA/배포 전 필수)`
  - `[ ] 구글 OAuth 실제 클라이언트 ID/Secret 발급 및 콜백 URI 설정 (QA/배포 전 필수)`

### Task 1 — 기존 구현 검증 (이미 완료된 항목)

- [x] `Prisma PassportProfile` 모델 존재 확인 (`schema.prisma`)
- [x] `listMyBookings` 오프셋 페이지네이션(`take/skip`) 동작 확인
- [x] `BookingPaginator` UI (`?page=N` 링크 방식) 존재 확인
- [x] `updatePassportProfile` Server Action (Zod 검증 + upsert) 존재 확인
- [x] `actions.test.ts` 4개 케이스 PASS 확인

### Task 2 — 마스킹 로직 엔티티화 (TDD)

- [x] `src/entities/user/model/__tests__/mask.test.ts` 작성 — RED 확인
  - `maskPassportNo("M12345678")` → `"M1****78"`
  - `maskPassportNo("AB1234567")` → `"AB****67"`
  - `maskPassportNo("M1")` → `"****"` (4자 미만)
  - `maskPassportNo("")` → `"****"` (빈 문자열)
- [x] `src/entities/user/model/mask.ts` 구현 — GREEN 확인 (6/6)
- [x] `src/entities/user/model/types.ts` 수정 — `SafePassportProfile` 타입 추가
- [x] `src/entities/user/api/queries.ts` 수정 — `getPassportProfile`이 `SafePassportProfile | null` 반환
- [x] `src/entities/user/index.ts` 수정 — `SafePassportProfile`, `maskPassportNo` named export
- [x] Architect 자가 점검: ✅ 엔티티 레이어 범위 내, barrel 명시적 export

### Task 3 — PassportProfileForm 업데이트

- [x] `src/features/passport-profile/ui/PassportProfileForm.tsx` 수정
  - `PassportProfile` (Prisma) import 제거 → `SafePassportProfile` from `@/entities/user`
  - `Props.initial` 타입 `SafePassportProfile | null`
  - 내부 `maskPassportNo` 함수 제거 (엔티티 레이어에서 이미 마스킹됨)
  - 마스킹 미리보기 `{initial.passportNo}` — 이미 마스킹된 값 표시 (함수 호출 불필요)
  - `passportNo` input의 `defaultValue` 제거 (마스킹값 저장 사고 방지)
- [x] Frontend Expert 자가 점검: ✅ `'use client'` 유지(폼 훅 사용), hook cleanup 없음

### Task 4 — 정적 & 동적 검증

- [x] `npm run typecheck` → exit 0 (clean)
- [x] `npm run test` → 42 files / **421 tests passed** (mask 6 신규 포함, 이전 415 → 421)
- [x] `npm run lint` → 신규/수정 파일 error/warning **0건**

### Task 5 — 완료 처리

- [x] 본 plan의 모든 `- [ ]` 를 작업 직후 `- [x]` 로 갱신 (CLAUDE.md §4.1)
- [x] 보고 양식 §7.1 준수

## Verification Checklist (최종)

- [x] `maskPassportNo` 함수가 `entities/user/model/mask.ts` 에 위치 (엔티티 레이어)
- [x] `getPassportProfile`이 `SafePassportProfile | null` 반환 (원본 passportNo 노출 차단)
- [x] `PassportProfileForm` props가 `SafePassportProfile`을 받음
- [x] passportNo input에 마스킹된 값이 defaultValue로 들어가지 않음
- [x] typecheck / test / lint 그린

## Out of Scope

- passportNo 컬럼 단위 암호화 (Phase 2 ADR 예정, 현재 평문 저장)
- 계정 unlink UI (별도 plan)
- 라이브 실거래(NO-REAL-MONEY §5) 관련 작업 일체
