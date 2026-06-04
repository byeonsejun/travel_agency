# ADR-0030: 트랜잭셔널 아웃박스 단일 훅 + Resend 멱등키 effectively-once

- **상태**: Accepted
- **결정일**: 2026-06-03
- **영향 범위**: `src/entities/booking/api/mutations.ts`, `src/entities/booking/model/emailPolicy.ts`, `src/shared/lib/email-job/enqueue.ts`, `src/shared/email/provider.ts`, `prisma/schema.prisma`
- **관련 스펙**: `docs/superpowers/specs/2026-06-03-phase-5a-email-pipeline.md`

## Context (배경)

거래 종료(PAID 전이 = 예약 확정, PAID/READY → CANCELED 전이 = 환불 완료) 시점에 고객 알림 메일을 발송해야 한다.
단순하게 구현하면 두 가지 실패 모드가 생긴다.

1. **발송 누락(유실)**: Booking 상태 업데이트 성공 → 앱 크래시 → 메일 enqueue 미실행 → 고객 안내 0.
2. **중복 발송(over-delivery)**: 재시도 로직이 있으나 Resend 측에 멱등 보장이 없으면 고객 메일함에 동일 메일 N통.

추가로 Dev 환경에서 실제 발송이 나가면 `@nextour.test` 시드 주소가 바운스 리스트에 오를 수 있다.

## Decision (결정)

**트랜잭셔널 아웃박스(Transactional Outbox) 패턴을 단일 훅으로 통합**:

`transitionStatusTx`(Booking 상태전이 코어 Tx) 안에서, `BookingEvent` append 직후, 순수 정책 함수 `emailJobForTransition(from, to, bookingId)` 결과를 `enqueueEmailJob(tx, descriptor)`로 **같은 Tx에 원자적 적재**한다.

```ts
// mutations.ts — transitionStatusTx 내부
const emailDescriptor = emailJobForTransition(current.status, to, bookingId);
if (emailDescriptor) {
  await enqueueEmailJob(tx, { ...emailDescriptor, bookingId });
}
```

**멱등 enqueue (find-then-create)**:

`EmailJob.dedupeKey`는 `@unique`. `enqueueEmailJob`은 사전 `findUnique` 후 존재하면 no-op.
동시 전이(드문 race)는 두 번째 Tx가 P2002로 롤백 → Tx 단위 원자성이 백스톱.

**Resend 멱등키**:

워커 발송 시 `idempotencyKey = dedupeKey` 전달 → Resend가 동일 키로 중복 호출을 서버 측에서 무시.
at-least-once 재시도 + Resend 멱등 = effectively-once.

**Dev 콘솔 폴백**:

`NODE_ENV !== "production"` 이면 Resend 미호출, 콘솔 출력만. auth.ts 매직링크 폴백과 동일 기준.

## Consequences (결과)

**얻은 것:**
- 상태전이 + 메일 enqueue가 단일 Tx → 앱 크래시 시 메일 유실 0.
- 모든 booking 경로(`transitionStatus`, 환불 Saga, 배치 fan-out)가 `transitionStatusTx`를 경유하므로 별도 훅 없이 자동 커버.
- `emailJobForTransition`이 순수 함수라 Vitest에서 DB 없이 단위 테스트 가능.
- Resend `idempotencyKey`로 effectively-once 보장. 워커 재시도 부담 최소.
- Dev 환경 바운스 차단 — `@nextour.test` 시드 계정 발송 리스크 0.

**포기한 것 / 미해결:**
- `EmailJob` 테이블이 추가되어 Booking 생명주기와 묶임(onDelete: Cascade). 고도화 시 아카이빙 전략 필요.
- Resend 멱등 TTL(24h) 이후 같은 dedupeKey로 재발송 불가(원하는 경우 키에 타임스탬프 suffix 필요).
- 실 이메일 e2e 검증은 사용자가 Resend 대시보드에서 수동 확인(Dev 폴백이 자동 차단).
- 부분 환불(금액 일부) 메일은 현재 미구현(다음 에픽 후보).

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A (채택): 트랜잭셔널 아웃박스 — `transitionStatusTx` 단일 훅

현재 결정. 위 Decision 참조.

### 옵션 B: 호출부 직접 발송 (Inline send)

각 route handler/Server Action에서 `transitionStatus` 직후 `sendEmail` 직접 호출.
- **거부 이유**: 상태전이 성공 → `sendEmail` 실패 시 메일 유실. 호출부가 10곳 이상 분산되어 SSOT 없음. 외부 I/O(Resend P99 ~500ms)가 요청 경로 지연에 직결.

### 옵션 C: 경로별 개별 enqueue (각 Server Action이 직접 적재)

결제 웹훅, 환불 Saga, 관리자 취소 등 각 진입점에서 개별 `EmailJob` 삽입.
- **거부 이유**: SSOT 분산. 새 전이 경로 추가 시 enqueue 누락 위험. `transitionStatusTx` 단일 진입점 패턴(`assertTransition` + `BookingEvent`)의 일관성 파괴.

### 옵션 D: EmailJob에 payload JSON 박제

발송 데이터를 `EmailJob.payload`에 JSON으로 저장.
- **거부 이유**: 주소·상품명·금액이 스냅샷 되어 이후 수정과 drift 발생. `EmbeddingJob`도 payload 없이 hydration 패턴을 쓴다는 선례 위반. bookingId만으로 워커 발송 시 최신 데이터 로딩이 가능하므로 payload 박제는 불필요.

### 옵션 E: 동기 발송 (외부 I/O를 Tx 내부 포함)

Tx 안에서 Resend API 호출 후 commit.
- **거부 이유**: ADR-0003(Refund Saga 3-phase) 원칙 위반. DB Tx 안에 외부 I/O → Resend 지연이 Tx 보유 시간에 직결 → 커넥션 고갈 위험. 롤백 시 메일은 이미 발송된 상태(불일치).

## Notes

- `EmailJob` 워커는 `EmbeddingJob`/`RefundJob` CAS-claim + 지수 백오프 + stale IN_PROGRESS reaper 패턴과 동형.
- Vercel Cron `*/2` — 트래픽 낮은 프로젝트 기준으로 충분. 스케일 아웃 시 `limit` 조정 또는 Queues 전환.
- 환불 코드(`refund.ts`/`refundRetry.ts`)는 미수정 — `transitionStatus` 경유라 아웃박스 훅이 자동 적용.
