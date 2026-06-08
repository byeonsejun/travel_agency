# ADR-0044: 리뷰 신고를 `ReviewStatus.REPORTED` 상태 flip 대신 `ReviewReport` 이벤트 적재로 구현 (Phase 15)

- **상태**: Accepted
- **결정일**: 2026-06-09
- **영향 범위**: `prisma/schema.prisma`(`ReviewReport`), `src/entities/review/api/{mutations,queries}.ts`, `src/features/review-feed`, `src/features/admin-review-moderation`, `src/app/(admin)/admin/reviews`
- **관련 commit**: `4490bd7`(ReviewReport 모델), `3802fb6`(createReviewReport 멱등), `9e3b58e`(admin 큐), `9ec2408`(큐 PUBLISHED 한정), `07d9bc3`(PDP ISR island)

## Context (배경)

Phase 4-C에서 리뷰 모더레이션을 도입하며 `ReviewStatus` enum에 `PUBLISHED | HIDDEN | REPORTED` 세 값을 정의하고, `ALLOWED_REVIEW_TRANSITIONS`에 `REPORTED → PUBLISHED|HIDDEN` 출구 전이까지 예약해 두었다([ADR-0029]). 당시 CLAUDE.md 노트는 "REPORTED 진입점은 다음 Phase — enum 값만 보존"이라 적었다. 즉 **사용자 신고가 들어오면 리뷰의 `status`를 `REPORTED`로 flip**하는 그림이 암묵적 전제였다.

Phase 15에서 이 진입점을 채우려 할 때 두 가지 구조적 결함이 드러났다.

1. **검열 어뷰징(censorship abuse).** PDP(상품 상세)의 리뷰 쿼리는 `status: "PUBLISHED"`만 노출한다. 신고가 `status`를 `REPORTED`로 바꾸면, **단 1건의 악의적 신고가 정상 리뷰를 즉시 비공개**시킨다. 경쟁사·악성 사용자가 별점 낮은(혹은 높은) 리뷰를 임의로 가릴 수 있는 1-click 검열 벡터다.
2. **정보 손실.** `status` 단일 컬럼은 "누가·왜·언제·몇 번" 신고했는지를 담지 못한다. 중복 신고 dedup, 사유 분류(SPAM/ABUSIVE/…), 감사추적, admin triage가 모두 불가능하다.

`status` flip은 이 둘을 구조적으로 해결할 수 없어, 진입점을 채우기 전에 표현 방식 자체를 재결정해야 했다.

## Decision (결정)

신고를 리뷰의 **상태(state)** 가 아니라 별도 테이블의 **사건(event)** 으로 모델링한다. 신고는 `Review.status`를 절대 바꾸지 않고 `ReviewReport` 행만 append한다. 리뷰는 admin이 판결하기 전까지 계속 노출(무죄추정)되며, admin 큐는 `status`가 아니라 **OPEN 신고의 존재 여부**로 구동된다(report-driven).

```prisma
model ReviewReport {
  reviewId   String
  reporterId String
  reason     ReportReason   // SPAM | ABUSIVE | IRRELEVANT | PRIVACY | OTHER
  status     ReportStatus   // OPEN → RESOLVED | DISMISSED
  @@unique([reviewId, reporterId]) // 1인 1신고 (멱등 dedup)
}
```

```ts
// 큐 = status flip 이 아니라 OPEN 신고 존재 기준. PUBLISHED 리뷰만(이미 숨겨진 건 제외).
where: { status: "PUBLISHED", reports: { some: { status: "OPEN" } } }

// admin 판결: 숨김(인정) = HIDDEN 전이 + OPEN 신고 RESOLVED 를 단일 Tx 로 원자 처리
// 반려 = OPEN 신고 DISMISSED, 리뷰 status 불변
```

`ReviewStatus.REPORTED` enum 값은 **status-flip 용도로 사용하지 않고 예약 상태로 보존**한다(제거 시 마이그레이션·전이맵 churn + 미래 용도 여지 상실).

## Consequences (결과)

**얻은 것:**
- 검열 어뷰징 0 — 신고는 노출을 바꾸지 못하고, 숨김은 오직 admin 판결로만 발생.
- 감사추적·사유 분류·dedup — `ReviewReport`가 신고의 1급 원장. `@@unique`로 1인 1신고, `P2002` 흡수로 멱등.
- admin triage — 사유별 집계(`reasonCounts`)·신고 건수·대표 사유로 우선순위 판단 가능.
- 재신고 자연 처리 — admin이 DISMISSED 처리 후 다른 사용자가 신고하면 새 OPEN 행 → 큐 재진입.

**포기한 것 / 미해결:**
- 자동 takedown 없음 — 악성 리뷰는 admin이 처리할 때까지 노출(무죄추정의 대가). 임계치 자동 숨김은 향후 확장 여지로 남김.
- 테이블 1개 추가 + 큐가 `reports` relation join 의존(단, `@@index([status, createdAt(sort: Desc)])`로 유계).
- 이미 `HIDDEN`된 리뷰에 OPEN 신고가 남으면 큐에서 제외되어 그 신고는 미종결로 잔존(노출 안 되므로 무해, 데이터 위생상 흔적).
- `ReviewStatus.REPORTED`가 미사용 enum으로 남음(vestigial). 향후 활용 시 본 ADR 재검토 필요.

## Alternatives Considered (대안)

### 옵션 A: 즉시 `REPORTED` status flip (자동 숨김)
- 첫 신고 시 `PUBLISHED → REPORTED` 전이 → PDP에서 즉시 사라짐. 기존 "신고됨" 필터·전이맵 재사용으로 구현 최소.
- **거부:** 단일 악의적 신고로 정상 리뷰를 검열하는 치명적 어뷰징 벡터. 사유·신고자·횟수 정보 전부 소실. 빠른 takedown 이점보다 악용 리스크가 압도적.

### 옵션 B: 임계치 기반 자동 숨김 (N건 누적 시 flip)
- `ReviewReport`는 적재하되, OPEN 신고가 N건 도달하면 자동으로 `REPORTED`/`HIDDEN` 전환.
- **거부(이번 Phase 범위에서):** 임계치 산정·신고 가중치·동시성 카운터(조건부 차감) 복잡도가 큼. 소규모 서비스에서 N명의 담합으로 여전히 검열 가능. 이벤트 적재(본 결정)를 먼저 확립한 뒤 필요 시 그 위에 얹는 확장으로 분리하는 것이 안전. YAGNI.

### 옵션 C: `Review`에 `reportCount`/`reportReason` 컬럼만 추가 (경량)
- 별도 테이블 없이 리뷰 행에 신고 카운터·최근 사유만 비정규화.
- **거부:** dedup(1인 1신고)을 DB 제약으로 강제할 수 없고(누가 신고했는지 미저장), 사유별 분포·감사추적·재신고 lifecycle 표현 불가. `status` flip의 정보 손실 문제를 그대로 답습.

## Notes

- 본 결정은 과거 노트("REPORTED 진입점 다음 Phase")의 암묵 전제(status flip)를 **의도적으로 뒤집은** 것이다. [ADR-0029]의 전이맵 자체는 유효(REPORTED→* 출구는 미래 옵션 B 대비 보존).
- 연관 부수 결정: per-user `isOwn`(본인 리뷰 신고 버튼 숨김)을 PDP 정적 렌더에 굽지 않고 client island(`/api/reviews/viewer-context`)로 마운트 후 해소 — PDP ISR(1h) 보존([ADR-0018] 패턴 답습, 신규 ADR 불요).
- 모니터링 후보 지표: OPEN 신고 적체량, DISMISSED 비율(오신고/악용 신호), 단일 리뷰 신고 폭주(향후 옵션 B 임계치 설계 입력).
- 6개월 뒤 의심 가능 지점: "왜 신고해도 리뷰가 안 사라지나?" → 본 ADR D1(검열 방지). "REPORTED enum은 왜 안 쓰나?" → 본 ADR Decision 말미(예약 보존).
