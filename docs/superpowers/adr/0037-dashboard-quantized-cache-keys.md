# ADR-0037: 대시보드 start/end 일 양자화 캐시 키 + 프리셋=숏컷 (Phase 10)

- **상태**: Accepted
- **결정일**: 2026-06-05
- **영향 범위**: `src/entities/analytics/`, `src/widgets/admin-dashboard/`, `src/app/(admin)/admin/dashboard/page.tsx`
- **관련 commit**: `c34c899`, `0a57490`, `1d41fff`, `8b64184`, `54a9d12`

## Context (배경)

Phase 6까지 대시보드 기간 필터는 enum(`RangeKey`: today/7d/30d/90d/all) 5종이었고 `unstable_cache` 키도 enum 값을 그대로 썼다. Phase 10 목표는 임의 start/end 날짜 입력 + 상품별 필터(productId) 추가.

문제: `to=new Date()`(현재 시각 ms)를 캐시 키에 쓰면 매 요청마다 키가 유니크해져 `unstable_cache`가 항상 미스 → DB 집계 6회가 매 요청 재실행. 상품 차원까지 추가되면 키 카디널리티가 더 폭발함.

또한 구 `DashboardRangeFilter`는 `Link href="/admin/dashboard?range=X"` 하드코딩으로 productId가 URL에 있어도 범위 변경 시 날아가는 비대칭 UX 문제가 있었음.

## Decision (결정)

start/end를 `YYYY-MM-DD` 일 경계(`parseFilter`가 UTC 00:00:00.000Z로 양자화, ms 제거)로 변환하고, `to`를 오늘 날짜로 미래 클램프해 키를 안정화한다.

캐시 키 = `["dash-X", startDay, endDay, productId|"all"]` (모두 직렬화 가능 string).

```ts
// parseFilter 핵심: ms 제거 + 미래 클램프 + 역전 스왑
todayMidnight.setUTCHours(0, 0, 0, 0);
if (endDay.getTime() > todayMidnight.getTime()) endDay = todayMidnight;
if (startDay.getTime() > endDay.getTime()) { /* swap */ }

// 캐시 키: 직렬화 가능 string 3개
cacheKey: { startDay: "YYYY-MM-DD", endDay: "YYYY-MM-DD", product: productId ?? "all" }
```

프리셋(오늘/7d/30d/90d/전체)은 독립 `DashboardRangeFilter` 컴포넌트를 제거하고, `DateRangePicker` 내부의 `PRESETS` 칩(클릭 시 start/end를 URL에 set)으로 강등. 이로써 범위 변경 시 productId가 보존됨.

## Consequences (결과)

**얻은 것:**
- 동일 날짜 구간 반복 조회는 60s TTL 내 캐시 적중 (일 경계 이후 자동 신선화)
- productId 필터를 포함한 6개 집계 쿼리 일관성
- 레거시 `?range=7d` 북마크도 `parseFilter`가 start/end로 매핑해 하위호환
- 프리셋 클릭 시 productId가 URL에서 사라지지 않음 (UX 비대칭 해소)

**포기한 것 / 미해결:**
- 자정 경계 통과 시 "오늘" 키 변경 → 의도된 신선화 (stale 방지)
- 키 카디널리티 = 구간수 × 상품수 (TTL 60s 자연만료로 흡수)
- 런타임 상품 스코핑 + 미존재 productId 증거 수집은 dev 서버 기동 필요 → 별도 검증 에픽

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: unstable_cache 전면 제거 (매 요청 DB 직접 쿼리)

- admin force-dynamic 페이지라 캐시 없이도 동작함
- 왜 거부: 집계 쿼리 6종이 복잡한 `$queryRaw` + JOIN. 다수 admin 동시 접근 시 DB 부하 직결. TTL 60s 캐시가 "최신성 vs DB 보호" 균형점으로 더 적절.

### 옵션 B: 커스텀 Map/LRU 인메모리 캐시

- `unstable_cache` 외부에 직접 캐시 구현
- 왜 거부: Next.js 배포 인스턴스 간 공유 불가, 코드 복잡도 증가, `unstable_cache`의 `revalidateTag` 통합 불가.

### 옵션 C: react-day-picker 등 캘린더 UI 라이브러리 도입

- 더 풍부한 날짜 선택 UX
- 왜 거부: 추가 번들 크기, RSC/클라이언트 혼재 복잡도. 네이티브 `<input type="date">`가 admin 내부 도구 요건을 충분히 충족. 의존성 최소화.

### 옵션 D: enum RangeKey 확장 (고정 프리셋만 허용, 임의 날짜 미지원)

- 기존 코드 변경 최소
- 왜 거부: 사용자 요구(임의 날짜 범위)를 충족하지 못함. 상품별 드릴다운 기능 확장 불가.

## Notes

- 스왑 후 endDay를 오늘로 재클램프하는 2단계 처리가 필요함 — start > end swap 후 새 endDay가 미래일 수 있으므로 (`fix: re-clamp endDay after swap to prevent future-date leak`, commit `c34c899`)
- `DateRangePicker`의 `useState(start)` stale 초기화 문제 → `page.tsx`에서 `key={startDay+endDay}` 전달로 URL 변경마다 컴포넌트 재마운트 해결
- 캐시 무효화는 60s TTL 자연만료 + `revalidateTag('analytics:dashboard')` 즉시 무효화 가능
- `RangeKey`/`DateRange` 타입 제거 + `range.ts` 파일 삭제로 레거시 enum 기반 슬라이스 완전 정리 (`parseRange` → `parseFilter`로 대체)
