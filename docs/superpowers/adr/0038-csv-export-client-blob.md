# ADR-0038: Client-side Blob CSV 추출 + 5,000건 상한

- **상태**: Accepted
- **결정일**: 2026-06-05
- **영향 범위**: `src/features/admin-dashboard-drilldown/lib/downloadCsv.ts`, `src/shared/lib/csv/toCsv.ts`, `src/entities/analytics/api/drilldown.ts`
- **관련 commit**: `d1b9516` `25d6d61` `687f9b8` `46b2340` `a20b792`

## Context (배경)

운영 대시보드 KPI 카드(매출·위약금·취소·좌석점유율) 클릭 시, 해당 집계의 원천 로우를 Sheet 패널로 확인하고 CSV로 내보내야 했다.

CSV 생성 방법으로 두 가지 접근이 검토되었다:
1. **Server Streaming Route Handler** — 서버에서 `Content-Disposition: attachment` 헤더와 함께 스트리밍
2. **Client-side Blob** — 이미 Sheet 패널에 로드된 in-memory 행을 브라우저에서 직렬화

동시에, 드릴다운 원천 쿼리(`entities/analytics/api/drilldown.ts`)는 `COUNT(*) OVER()`(윈도우 함수)로 전체 매칭 건수를 단일 쿼리에서 확보하면서, 실제 반환 행은 5,000건으로 제한(`LIMIT 5000`)한다.

## Decision (결정)

**Client-side Blob + 5,000건 캡** 채택.

```ts
// toCsv: 외부 라이브러리 0, RFC4180 순수 직렬화
const csv = toCsv(rows, columns);
// BOM + Blob → objectURL → click → revoke(메모리 누수 차단)
const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
const url = URL.createObjectURL(blob);
try { a.click(); } finally { URL.revokeObjectURL(url); }
```

- Sheet 패널이 이미 보유한 in-memory 행을 직렬화 → **서버 추가 부하 0, 왕복 요청 0**
- `toCsv` 순수 함수: 외부 CSV 라이브러리 없음, 번들 증가 0
- UTF-8 BOM(`﻿`) prepend: 엑셀에서 한글 깨짐 없이 열림
- `URL.revokeObjectURL` finally 보장: 다운로드 후 메모리 즉시 해제
- 5,000건 캡: `COUNT(*) OVER()` 윈도우로 전체 건수(cap 무시)를 단일 쿼리에서 확보, 초과 시 배너 표시

## Consequences (결과)

**얻은 것:**
- 서버 스트리밍 인프라 불필요(Route Handler·Vercel Function 추가 없음)
- 신규 npm 의존성 0 (papaparse 등 CSV 라이브러리 제외)
- Sheet 패널과 CSV가 동일 in-memory 행을 공유 → 표시 내용 = 다운로드 내용 (불일치 원천 차단)
- 브라우저 메모리 누수 방어 패턴(`revokeObjectURL`)이 codebase 표준으로 확립

**포기한 것 / 미해결:**
- 5,000건 초과 전체 데이터 추출 불가 (현재 대시보드 운영 규모에서 해당 없음)
- 서버 측 필터·정렬 조합 후 추출 불가 (Sheet 표시 순서가 곧 CSV 순서)

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: Server Streaming Route Handler
- `GET /api/admin/drilldown/csv?metric=revenue&range=30d` → Prisma 쿼리 → `ReadableStream` → `Content-Disposition: attachment`
- **거부 이유:**
  - Sheet 패널과 CSV 쿼리가 이중화됨 — 서버 부하 2배, 코드 중복
  - Vercel Fluid Compute에서 스트리밍은 작동하나 현재 데이터 규모(≤5,000행)에서 불필요한 인프라 복잡도
  - Sheet에서 이미 받은 데이터를 다시 서버에서 내려받는 UX 비효율

### 옵션 B: 외부 CSV 라이브러리 (papaparse, csv-stringify 등)
- **거부 이유:**
  - RFC4180 준수(쉼표·따옴표·개행 이스케이프)는 20줄 순수 함수로 충분
  - 번들 사이즈 증가 + 의존성 공격 표면 확대 — "No external deps" 플랜 원칙 위반
  - 한글 BOM 처리는 라이브러리마다 상이 → 직접 제어가 더 안전

### 옵션 C: 5,000건 캡 없이 전체 추출
- **거부 이유:**
  - 대용량 로우를 브라우저 메모리에 적재하면 OOM 위험
  - 관리자 운영 실무에서 단일 날짜 범위 내 5,000건 초과 추출 수요 미확인
  - 승격 조건: 상시 수만 행 초과 시 Server Streaming(옵션 A)으로 전환

## Notes

- **승격 조건**: 단일 날짜 범위 드릴다운 데이터가 상시 5,000건을 초과하게 되면 옵션 A(Server Streaming Route Handler)로 전환 검토
- `COUNT(*) OVER()` 윈도우 함수가 `LIMIT` 이전에 평가됨 → 캡 무시 전체 건수를 단일 쿼리에서 확보(추가 COUNT 쿼리 불필요)
- `DrilldownSheet`의 stale-token 가드와 ESC 리스너 cleanup은 이 ADR 범위 밖이나 동일 에픽에서 함께 박제됨 ([ADR-0033] client island 격리 패턴의 연장)
- **머지 정정 (2026-06-05)**: 본 ADR은 원래 0037로 발행됐으나 Phase 10([ADR-0037] dashboard quantized cache keys)이 먼저 main에 머지되어 번호가 충돌 → 0038로 재번호. 동시에 Phase 10의 `DashboardFilter`(productId + 커스텀 날짜) 리팩터로 인해 드릴다운 입력이 단순 `range` enum → `parseFilter` 기반 `{start,end,productId}`로 포팅됨. 드릴다운 SQL에 `AND pr.id = ${productId}` 술어를 추가해 KPI 카드와 동일 코호트를 조회 → **카드 숫자와 드릴다운 합계 정합**(머니 대시보드 무결성).
