# ADR-0060: 매직링크 transport는 Gmail SMTP로 분리, 아웃박스 메일은 Resend 유지

- **상태**: Accepted
- **결정일**: 2026-06-29
- **영향 범위**: `src/shared/email/smtp.ts`, `src/features/auth/server/auth.ts`, `src/shared/lib/env.ts`
- **관련 commit**: `81b707a` (feat(auth): replace magic link transport with Gmail SMTP), merge `1c17389`

## Context (배경)

매직링크 로그인 메일과 거래 알림(아웃박스) 메일을 모두 Resend 단일 transport로 발송하고 있었다. 그런데 Resend는 **발신 도메인 인증 전(샌드박스 모드)에는 `onboarding@resend.dev` 발신으로 계정 본인 이메일에게만 발송**된다 — 임의 수신자에게 메일이 도달하지 않는다.

매직링크는 **누구나(처음 보는 리뷰어·테스트 사용자 등) 로그인**해야 하므로, 본인 메일로만 가는 제약은 치명적이다. 반면 아웃박스 메일(예약확정·환불완료)의 수신자는 이미 결제·예약을 마친 본인이거나 관리자라 제약 영향이 작다.

도메인을 구매해 Resend 도메인 인증을 하면 풀리지만, 이 프로젝트는 포트폴리오·검증 단계라 **유료 도메인 없이 무료로 임의 수신자에게 매직링크를 보내야** 한다.

## Decision (결정)

이메일 transport를 **용도별로 둘로 분리**한다:

- **매직링크 로그인 메일 = Gmail SMTP** (`nodemailer`, `src/shared/email/smtp.ts`). 도메인 구매 없이 Google 앱 비밀번호만으로 임의 수신자에게 발송 가능하고, Gmail 발신은 DMARC가 정렬돼 도달률이 양호하다. 발신 표시명은 `Nextour <GMAIL_USER>`로 브랜딩(`brandedFrom`).
- **아웃박스(예약확정·환불완료) 메일 = Resend SDK** (`src/shared/email/provider.ts`). 그대로 유지. 아웃박스의 핵심은 **멱등 발송**(`idempotencyKey = dedupeKey`)으로 at-least-once 재시도를 effectively-once로 만드는 것이며([ADR-0030]), 이는 Resend의 서버측 멱등에 의존한다. 수신자도 본인/관리자라 샌드박스 제약 영향이 작다.

인증 흐름·토큰·매직링크 URL 생성은 Auth.js 책임으로 **무변경**, 교체된 것은 `sendVerificationRequest`의 발송 transport뿐이다. dev/test는 양쪽 모두 `NODE_ENV !== "production"` 콘솔 폴백을 공유한다.

## Consequences (결과)

**얻은 것:**
- 유료 도메인 없이 임의 수신자에게 매직링크 도달 — 검증·리뷰 단계 로그인 차단 해소.
- 아웃박스의 멱등 보장(Resend)을 손대지 않아 거래 알림 신뢰성 무손상.

**포기한 것 / 미해결:**
- 매직링크 발신이 개인 Gmail 주소라 브랜드 일관성이 약하다(표시명만 Nextour).
- Gmail SMTP 무료 한도(대략 일 500통)에 묶인다 — 로그인 트래픽이 커지면 재검토 필요.
- transport가 둘로 갈려 운영 env가 `RESEND_*` + `GMAIL_*` 둘 다 필요(README env 표·`.env.example`에 반영).
- 추후 도메인을 확보하면 Resend 도메인 인증으로 **단일화 여지**가 있다(이 ADR을 Superseded로 전환).

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: 도메인 구매 + Resend 도메인 인증 (단일 transport 유지)
- 도메인 1개 구매 후 Resend에 SPF/DKIM 등록 → 매직링크·아웃박스 모두 브랜드 도메인 발신.
- 거부: **비용 발생**. 현 단계(포트폴리오/검증)에서 유료 도메인 확보는 과투자. transport 단일성·브랜딩은 좋으나 지금의 제약(무료)에 맞지 않음.

### 옵션 B: Brevo / SendGrid 등 타 ESP의 무료 free-mail 발신
- 도메인 없이도 발송 가능한 ESP 사용.
- 거부: 도메인 없이 free-mail 주소로 발신하면 **Gmail/Yahoo의 DMARC 강화 정책**에 걸려 스팸함·반송으로 도달률이 나쁘다. "보냈는데 안 온다"는 매직링크 최악의 실패 모드.

### 옵션 C: Gmail SMTP (앱 비밀번호) — **채택**
- Google 2단계 인증 후 발급한 앱 비밀번호로 `smtp.gmail.com` 직접 발송.
- 채택 이유: Gmail 발신은 **DMARC 정렬**돼 도달률이 양호하고, 도메인·비용 없이 **무료(~500/일)**. 매직링크 수요(저빈도 로그인)에 충분.

## Notes

- 아웃박스 Resend 서술은 여전히 정확 — [ADR-0030](./0030-email-outbox-and-idempotency.md)(멱등 아웃박스), [ADR-0042](./0042-partial-refund-email-outbox.md), [ADR-0005](./0005-cron-worker-3-layer-idempotency.md), [ADR-0034](./0034-cron-dispatcher-consolidation.md)는 모두 거래 알림(아웃박스) 맥락이라 무변경.
- 모니터링 지표: Gmail 일일 발송 한도 근접 여부, 매직링크 도달률(스팸함 분류율).
- 6개월 뒤 의심받을 부분: "왜 이메일 transport가 둘이지?" → 본 ADR. 도메인 확보 시 Resend 단일화로 Superseded 가능.
