# ADR-0008: `listDepartureSeats` — 폴링 채널 uncached 원칙

- **상태**: Accepted
- **결정일**: 2026-05-20
- **영향 범위**: `src/entities/departure/api/queries.ts`
- **관련 commit**: `feat(departure): polling uncached listDepartureSeats`

## Context (배경)

`getDeparturesByProduct`는 `unstable_cache` + 1시간 TTL로 캐시되어 있다. PDP(Product Detail Page)의 첫 로드와 가벼운 재방문은 이 캐시를 hit해 DB 쿼리 없이 서빙된다.

문제: 폴링 API(`/api/products/[id]/departures`)가 `getDeparturesByProduct`와 동일한 캐시를 사용하면, 좌석 변경 이후 `revalidateTag`가 호출되지 않는 한 캐시 만료(1시간)까지 폴링이 매번 **구식 데이터를 반환**한다. 폴링의 핵심 가치(신선도 확인)가 사라진다.

## Decision (결정)

폴링 전용 함수 `listDepartureSeats`를 `getDeparturesByProduct`와 분리하고, **의도적으로 `unstable_cache`를 사용하지 않는다**. 매 호출마다 DB를 직접 읽는다.

```ts
// src/entities/departure/api/queries.ts
// NO unstable_cache — 폴링 채널은 항상 신선한 DB hit이어야 한다
export async function listDepartureSeats(productId: string) {
  return db.departure.findMany({ ... select: minimal fields ... });
}
```

페이로드도 `id / status / remainingSeats / capacity` 4개 필드로 최소화해 매 20초 트래픽 영향을 억제한다.

## Consequences (결과)

**얻은 것:**
- 폴링 API가 항상 신선한 좌석 상태를 반환 — 폴링의 목적 달성.
- 캐시 무효화 경로(revalidateTag)와 폴링 경로가 독립 — 한 쪽 버그가 다른 쪽에 전파되지 않음.
- 최소 페이로드(4 필드)로 직렬화·전송 비용 최소화.

**포기한 것 / 미해결:**
- 매 폴링 호출이 DB 쿼리 1회 발생. 동시 접속 사용자 수 × (1분 / 20초) = 분당 쿼리 수 선형 증가.
- PDP 캐시(`getDeparturesByProduct`)와 폴링 캐시(`listDepartureSeats`) 응답이 일시적으로 다를 수 있음(정상, 의도된 불일치).

## Alternatives Considered (대안)

### 옵션 A: 같은 `unstable_cache` 사용, TTL을 30초로 단축
- TTL 내 폴링은 여전히 구식 데이터. 30초 TTL × 20초 폴링이면 최악 50초 지연.
- PDP와 폴링이 같은 캐시 버킷을 공유해 격리 없음 → 거부.

### 옵션 B: 좌석 변경 시 항상 `revalidateTag` 호출, 폴링도 캐시 사용
- booking 생성·취소의 모든 경로에서 revalidateTag 빠짐없이 호출해야 함.
- 누락 시 폴링이 침묵하며 구식 데이터 제공 — 안전망 없는 설계 → 거부.

### 옵션 C: Redis 좌석 카운터, 폴링은 Redis hit
- 신선도 + 저비용 모두 달성. 단, 현재 프로젝트에 Redis 인프라 없음.
- 도입 비용 대비 현 트래픽 예상에서 과잉 → Phase 2 후반 검토 대상 → 거부.

## Notes

- `listDepartureSeats`와 `getDeparturesByProduct`의 쿼리 where 조건(`departureDate >= today`, `status != CANCELED`)을 반드시 동일하게 유지할 것 — 드리프트 시 폴링에서 삭제된 출발일이 살아 돌아오는 UX 버그 발생.
