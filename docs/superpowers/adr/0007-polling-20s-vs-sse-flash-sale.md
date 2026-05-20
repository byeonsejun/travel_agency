# ADR-0007: 좌석 실시간성 — SSE/WebSocket 대신 20초 폴링 선택

- **상태**: Accepted
- **결정일**: 2026-05-20
- **영향 범위**: `src/features/live-seat/`, `src/app/api/products/[id]/departures/route.ts`
- **관련 commit**: `feat(live-seat): polling-based live departure list`

## Context (배경)

상품 상세 페이지(PDP)에서 출발일별 잔여 좌석은 실시간으로 변한다. 특히 flash sale처럼 단기 집중 모객 상황에서는 "예약하기" 클릭 직전에도 좌석이 마감될 수 있다. 그러나 이 데이터를 어떻게 클라이언트에 전달하느냐는 구현 복잡도·인프라 비용·사용자 경험의 균형 문제다.

`getDeparturesByProduct`는 `unstable_cache` + 1시간 TTL로 캐시되어 있어, 같은 채널로 폴링하면 TTL이 만료되기 전까지 갱신이 없다. 폴링 API는 캐시 분리가 필수다.

## Decision (결정)

클라이언트 컴포넌트(`LiveDepartureList`)에서 `setInterval`로 20초 주기 폴링. 폴링 API(`/api/products/[id]/departures`)는 `listDepartureSeats` — 의도적 uncached(ADR-0008).

```ts
// src/features/live-seat/model/constants.ts
export const POLL_INTERVAL_MS = 20_000;
```

`useEffect` cleanup에서 `clearInterval` + `AbortController.abort()` 로 메모리 누수를 차단한다(Frontend R2).

## Consequences (결과)

**얻은 것:**
- 서버리스(Vercel) 인프라에서 추가 설정 없이 동작.
- 구현·테스트·디버깅 복잡도 최저.
- 좌석 변경 후 최대 20초 내 UI 반영 — flash sale 및 일반 모객 모두에서 충분한 신선도.
- SSR initial value로 첫 페인트 대기 시간 없음 (폴링 첫 응답 전까지 SSR 데이터 표시).

**포기한 것 / 미해결:**
- 좌석 변경 후 최대 20초 지연 (즉시성 불가).
- 매 20초 per-user DB 쿼리 발생 (ADR-0008에서 최소 페이로드로 완화).
- 동시 접속 수가 많아지면 DB 쿼리 부하 선형 증가.

## Alternatives Considered (대안)

### 옵션 A: Server-Sent Events (SSE)
- 서버가 연결을 유지하면서 변경 시에만 push → 즉시성.
- Vercel serverless에서 SSE는 30초 타임아웃 제한 있음 — Edge Function으로 우회 가능하지만 복잡도 급상승.
- DB change stream 또는 Redis pub/sub 추가 인프라 필요.
- 현재 팀 규모·인프라에서 운영 부담 과다 → 거부.

### 옵션 B: WebSocket
- 양방향 실시간. SSE보다 인프라 요구사항 더 높음.
- Vercel에서 WebSocket 지원 별도 서비스(Pusher, Ably 등) 필요.
- 좌석 상태는 서버→클라이언트 단방향이면 충분 → WebSocket 과잉 → 거부.

### 옵션 C: SWR / React Query deduplicated polling
- 외부 라이브러리 추가 의존성, 현 스택에 없음.
- 폴링 로직 직접 구현 대비 실질적 이득 미미 → 거부.

### 옵션 D: 5초 폴링
- DB 부하 4배 증가, flash sale 대응엔 충분하나 비용 효율 저하.
- 20초도 "예약 버튼 클릭 전 마지막 갱신"으로 충분히 신선 → 거부.

## Notes

- 동시 접속 100명 기준 분당 DB 쿼리 300회 — 현 Phase에서 허용 범위.
- Phase 2 후반: DB 부하가 문제가 되면 Redis read replica 또는 좌석 집계를 캐시 레이어에 올리는 방향 검토.
