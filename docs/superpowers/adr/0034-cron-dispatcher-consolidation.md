# ADR-0034: 단일 Cron Dispatcher + Vercel daily + 외부 트리거로 실시간성 분리

- **상태**: Accepted
- **결정일**: 2026-06-04
- **영향 범위**: `src/app/api/cron/**`, `src/shared/lib/refund-job/**`, `src/shared/lib/cron/authorize.ts`, `vercel.json`
- **관련 commit**: `e6fb7bf`(가드 추출), `af4de4b`(refund 워커 추출), `eaef3f2`(얇은 래퍼), `4d4fa11`(dispatcher), `63d605d`(vercel.json)

## Context (배경)

Vercel 배포가 **cron 요금제 제한**으로 실패했다(`vercel.link` → cron usage-and-pricing 문서). 기존 `vercel.json`:

```json
"crons": [
  { "path": "/api/cron/process-refunds", "schedule": "*/2 * * * *" },
  { "path": "/api/cron/embedding-job",   "schedule": "*/2 * * * *" },
  { "path": "/api/cron/email-job",       "schedule": "*/2 * * * *" }
]
```

Vercel **Hobby 플랜은 cron 최대 2개 + 1일 1회 빈도**만 허용 → 3개 × `*/2`(2분)는 개수·빈도 양쪽 초과 → 배포 거부.

추가로 코드가 비대칭이었다: `process-refunds`만 로직이 라우트에 인라인(~75줄)이고 email/embedding은 `shared/lib/*-job/worker.ts`로 추출돼 있었으며, `isAuthorized()` Bearer 가드가 3벌 복제돼 있었다.

이 서비스는 **Mock/샌드박스 상한**(NO-REAL-MONEY)이라 라이브 과금은 없지만, 배포 파이프라인의 초록 배지는 회귀 탐지·미리보기 검증을 위해 필요하다.

## Decision (결정)

워커 처리 주기(2분)를 희생하지 않으면서 Vercel 제약을 우회하기 위해 **오케스트레이션과 일을 분리**한다:

1. **순수 워커**: refund 인라인 로직을 `shared/lib/refund-job/worker.ts`의 `processRefundJobBatch({limit})`로 추출 → 3개 워커가 모두 동형 순수 함수.
2. **공통 가드**: `shared/lib/cron/authorize.ts`의 `isCronAuthorized(req)`로 복제 제거.
3. **얇은 래퍼**: 기존 3개 라우트는 `auth → worker → JSON` 어댑터로 축소(삭제하지 않음).
4. **Master Dispatcher**: `app/api/cron/dispatcher/route.ts`가 3개 워커를 `Promise.allSettled`로 병렬 호출(워커 단위 격리).
5. **Vercel cron 1개**: `{ "path": "/api/cron/dispatcher", "schedule": "0 0 * * *" }` — Hobby 제약 충족.
6. **실시간성 분리**: 2분 주기 처리는 **Vercel 밖 외부 트리거**(별도 스케줄러)가 dispatcher 또는 개별 래퍼 라우트를 호출해 담당. Vercel 설정의 daily는 안전망(safety-net) 역할.

```ts
// dispatcher: 병렬 격리 — 한 워커 throw가 전체를 죽이지 않음
const settled = await Promise.allSettled(WORKERS.map((w) => w.run()));
```

## Consequences (결과)

**얻은 것:**
- Vercel 배포 초록 통과(cron 1개·daily). Hobby 플랜 유지하면서 워커 처리 주기는 외부 트리거로 2분 보존.
- 중복 제거: 가드 3벌→1, refund 로직이 라우트(119줄)→얇은 래퍼로 축소(−171줄/+333줄, 대부분 테스트).
- 워커가 HTTP 무관 순수 함수라 단위 테스트 용이(dispatcher·라우트·워커 각각 격리 테스트).
- `Promise.allSettled` 워커 단위 격리 — 한 워커 장애가 다른 워커·전체 응답을 막지 않음(서버리스 타임아웃에도 독립·고속).
- 개별 래퍼 라우트 생존 → 외부 트리거가 per-worker 개별 호출 가능(유연성).

**포기한 것 / 미해결:**
- **Vercel 설정과 실제 운영 주기의 괴리**: `vercel.json`은 daily인데 실제 의도는 2분 → 외부 트리거가 반드시 별도로 존재해야 의미가 성립. 외부 트리거 미구성 시 워커는 하루 1회만 돈다(처리 지연). 이 트리거 구현은 별도 과제(out of scope).
- dispatcher 단일 호출이 3워커를 동시에 → 서버리스 함수 1회 실행에 DB 부하 3배 순간 집중(현재 limit 5~10이라 무시 가능).

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: cron 2개로 줄이되 daily (Hobby 개수만 맞춤)
- refund+email을 하나로 묶고 embedding은 별도 → cron 2개.
- **거부 이유**: 개수(≤2)는 맞아도 **빈도(1일1회)** 제약은 그대로 → 여전히 `*/2` 불가. 절반만 해결. 또 "왜 이 둘만 묶였나" 임의 그룹핑이 생긴다. 단일 dispatcher가 더 깔끔하고 대칭적.

### 옵션 B: Vercel Pro 플랜 업그레이드 (cron 무제한·분단위)
- 플랜을 올리면 기존 3개 `*/2` 그대로 배포 가능.
- **거부 이유**: 이 프로젝트는 Mock/샌드박스 학습용(NO-REAL-MONEY)이라 유료 플랜 비용 부적절. 코드 구조 문제(인라인 로직·가드 복제)도 그대로 방치된다. 제약을 설계 개선의 계기로 삼는 게 낫다.

### 옵션 C: 기존 3개 라우트 완전 삭제 후 dispatcher만
- 라우트를 지우고 dispatcher 단일 진입점만 남김.
- **거부 이유**: 외부 트리거가 "refund만" 또는 "email만" 개별 호출할 유연성을 잃는다(장애 시 특정 워커만 재실행 등). 얇은 래퍼는 비용이 거의 0(auth+위임 ~15줄)이라 유지가 합리적. 사용자 결정으로 옵션 거부.

### 옵션 D: 동기 enqueue 직후 즉시 처리 (cron 제거)
- 큐 없이 트랜잭션 직후 워커 동기 실행.
- **거부 이유**: ADR-0003/0026/0030가 일관되게 거부한 패턴. 외부 IO(PG/Resend/OpenAI)를 상태전이 Tx에 직결시키면 지연·롤백 불일치. 비동기 큐 + cron drain 원칙 유지.

## Notes

- **다음 작업자 주의**: `vercel.json`의 daily는 *안전망*이다. 실제 2분 주기 처리는 외부 트리거(예: GitHub Actions schedule, 외부 cron SaaS, Upstash QStash 등)가 `/api/cron/dispatcher`를 `Bearer ${CRON_SECRET}`로 호출해야 성립. 트리거 미구성 시 처리 지연을 의심.
- 새 워커 추가 시: `shared/lib/<x>-job/worker.ts` 순수 함수 작성 → dispatcher의 `WORKERS` 배열에 한 줄 추가 → (선택) 얇은 래퍼 라우트. dispatcher가 자동으로 병렬 포함.
- 6개월 뒤 의심받을 부분: "왜 Vercel은 daily인데 README엔 2분이라 하지?" → 본 ADR의 옵션 분리 결정. Vercel 무료 제약 + 외부 트리거 분리가 답.
