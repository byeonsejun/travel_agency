# Pending Ops — 운영/배포 전 수동 작업 목록

> 코드로 자동화할 수 없는 외부 설정·키 발급·콘솔 작업을 모아둔다.
> 각 항목은 완료 시 `[x]` 처리 후 완료 일자와 담당자를 기입한다.

---

## 인증 / OAuth

- [x] **카카오 OAuth 실제 클라이언트 ID/Secret 발급 및 콜백 URI 설정** (완료: 2026-05-21, 담당: qustpwns93@gmail.com)
  - 카카오 Developers 콘솔 → 애플리케이션 생성 → REST API 키 발급
  - Redirect URI 등록: `https://<prod-domain>/api/auth/callback/kakao`
  - 환경 변수: `AUTH_KAKAO_ID`, `AUTH_KAKAO_SECRET`
  - 참고: `src/features/auth/server/auth.ts` (Kakao provider), `src/shared/lib/env.ts` (페어 검증 superRefine)
  - 검증: 로컬 `/login` → 카카오 버튼 → 콜백 → 세션 발급 수동 확인 완료

- [x] **구글 OAuth 실제 클라이언트 ID/Secret 발급 및 콜백 URI 설정** (완료: 2026-05-21, 담당: qustpwns93@gmail.com)
  - Google Cloud Console → OAuth 2.0 클라이언트 ID 생성
  - Redirect URI 등록: `https://<prod-domain>/api/auth/callback/google`
  - 환경 변수: `AUTH_GOOGLE_ID` (`.apps.googleusercontent.com` 포맷), `AUTH_GOOGLE_SECRET`
  - 참고: `src/shared/lib/env.ts` (포맷 검증 + 페어 검증 superRefine)
  - 검증: 로컬 `/login` → 구글 버튼 → 콜백 → 세션 발급 수동 확인 완료

---

## 결제

- [x] **토스페이먼츠 샌드박스 웹훅 등록** (완료: 2026-05-26, 담당: qustpwns93@gmail.com)
  - 토스 개발자 콘솔 → 샌드박스 → 웹훅 URL 등록: `https://<dev-domain>/api/payments/webhook/toss`
  - 환경 변수: `TOSS_WEBHOOK_SECRET`
  - ⚠️ 운영 키(`live_`) 사용 금지 — NO-REAL-MONEY 원칙 (CLAUDE.md §5)
  - ⚠️ **경로 주의**: 코드 컨벤션은 `payments`(복수) + provider 분리(`webhook/toss/`).
    단수형(`/api/payment/webhook`)으로 등록 시 Next 가 핸들러를 못 찾아 404 반환.
  - 검증: ngrok dev 환경에서 `PAYMENT_STATUS_CHANGED` v2 페이로드 → **200 OK** 확인 완료.
    Verification(서명) 은 별도 plan 까지 dev signature skip 분기로 통과 (production 은
    여전히 401 throw — 실거래 안전성).

---

## 인프라

- [x] **Supabase Storage 버킷 생성** (완료: 2026-05-21, 담당: qustpwns93@gmail.com)
  - 버킷명: `product-images` (public read)
  - 환경 변수: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
  - 향후 리뷰 사진 후기(A2) 도입 시 같은 인프라 위에 `review-photos` 등 별도
    버킷 또는 path prefix 분리 검토 필요
