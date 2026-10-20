import { describe, expect, it } from "vitest";
import {
  type ProductForTopUp,
  type TemplateDeparture,
  FALLBACK_CAPACITY,
  FALLBACK_MIN_PAX,
  buildRollbackSql,
  hasBookableFuture,
  parseStatuses,
  planTopUp,
  rollbackFileName,
} from "../ops/topup-departures";

describe("rollbackFileName — --apply 롤백 파일명 (UTC 타임스탬프, 정렬 가능)", () => {
  it("topup-departures-YYYYMMDDTHHMMSSZ.sql", () => {
    expect(rollbackFileName(new Date("2026-10-20T06:44:55.123Z"))).toBe("topup-departures-20261020T064455Z.sql");
  });
});

describe("buildRollbackSql — 생성 출발편 ID 목록 + 가드된 DELETE", () => {
  const META = { ids: ["cmq1abc", "cmq2def"], createdAt: new Date("2026-10-20T06:44:55Z"), host: "localhost" };

  it("헤더에 생성 시각·DB host·ID 목록을 남긴다", () => {
    const sql = buildRollbackSql(META);
    expect(sql).toContain("2026-10-20T06:44:55.000Z");
    expect(sql).toContain("localhost");
    expect(sql).toContain("--   cmq1abc");
    expect(sql).toContain("--   cmq2def");
  });

  it("생성한 ID 만 대상으로 한 트랜잭션 DELETE", () => {
    const sql = buildRollbackSql(META);
    expect(sql).toMatch(/BEGIN;[\s\S]*DELETE FROM "Departure"[\s\S]*COMMIT;/);
    expect(sql).toContain(`d.id IN ('cmq1abc', 'cmq2def')`);
  });

  it("예약·좌석·취소 배치가 붙은 출발편은 지우지 않는 가드 포함", () => {
    const sql = buildRollbackSql(META);
    expect(sql).toContain(`d."bookedSeats" = 0`);
    expect(sql).toContain(`NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b."departureId" = d.id)`);
    expect(sql).toContain(`NOT EXISTS (SELECT 1 FROM "DepartureCancellation" c WHERE c."departureId" = d.id)`);
  });

  it("빈 목록은 거부 (생성 0건이면 파일을 만들지 않는다)", () => {
    expect(() => buildRollbackSql({ ...META, ids: [] })).toThrow(RangeError);
  });

  it("cuid 형식이 아닌 ID 는 거부 (SQL 인젝션 차단)", () => {
    expect(() => buildRollbackSql({ ...META, ids: ["x'); DROP TABLE \"Departure\";--"] })).toThrow(RangeError);
  });
});

describe("parseStatuses — --statuses 옵션 파싱 (기본 PUBLISHED)", () => {
  it("미지정이면 PUBLISHED 만", () => {
    expect(parseStatuses(undefined)).toEqual(["PUBLISHED"]);
  });
  it("콤마 목록 + 중복 제거", () => {
    expect(parseStatuses("PUBLISHED,DRAFT,CLOSED,DRAFT")).toEqual(["PUBLISHED", "DRAFT", "CLOSED"]);
  });
  it("알 수 없는 상태는 거부", () => {
    expect(() => parseStatuses("PUBLISHED,ARCHIVED")).toThrow(RangeError);
  });
});

const NOW = new Date("2026-10-20T06:00:00Z");
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const OPTS = { count: 3, intervalDays: 14, leadDays: 7 };

function dep(overrides: Partial<TemplateDeparture> = {}): TemplateDeparture {
  return {
    departureDate: d("2026-05-01"),
    returnDate: d("2026-05-05"),
    priceAdult: 1_290_000,
    priceChild: 990_000,
    priceInfant: 0,
    capacity: 16,
    minPax: 8,
    status: "SCHEDULED",
    penaltyPolicyKey: null,
    ...overrides,
  };
}

function product(departures: TemplateDeparture[], overrides: Partial<ProductForTopUp> = {}): ProductForTopUp {
  return { id: "p1", basePriceAdult: 1_390_000, durationNights: 4, departures, ...overrides };
}

describe("hasBookableFuture — 오늘 이후 예약 가능한(SCHEDULED/CONFIRMED) 출발편 존재 여부", () => {
  it("과거 출발편만 있으면 false", () => {
    expect(hasBookableFuture([dep()], NOW)).toBe(false);
  });

  it("오늘 출발편(UTC 자정 기준)은 미래로 친다", () => {
    expect(hasBookableFuture([dep({ departureDate: d("2026-10-20") })], NOW)).toBe(true);
  });

  it("미래라도 CANCELED/CLOSED 만 있으면 false (예약 불가)", () => {
    expect(
      hasBookableFuture(
        [dep({ departureDate: d("2026-12-01"), status: "CANCELED" }), dep({ departureDate: d("2026-12-08"), status: "CLOSED" })],
        NOW,
      ),
    ).toBe(false);
  });

  it("미래 CONFIRMED 는 true", () => {
    expect(hasBookableFuture([dep({ departureDate: d("2026-12-01"), status: "CONFIRMED" })], NOW)).toBe(true);
  });
});

describe("planTopUp — 미래 출발편이 없는 상품에만 보충 일정 계획", () => {
  it("과거 출발편만 있으면 최근 출발편을 템플릿으로 (오늘+lead)부터 interval 간격 count 건", () => {
    const plan = planTopUp([product([dep()])], NOW, OPTS);
    expect(plan.map((p) => p.departureDate.toISOString().slice(0, 10))).toEqual([
      "2026-10-27",
      "2026-11-10",
      "2026-11-24",
    ]);
    // 여행 기간은 템플릿의 (return - departure) = 4일 유지
    expect(plan[0].returnDate.toISOString().slice(0, 10)).toBe("2026-10-31");
    expect(plan[0]).toMatchObject({
      productId: "p1",
      priceAdult: 1_290_000,
      priceChild: 990_000,
      priceInfant: 0,
      capacity: 16,
      minPax: 8,
      source: "template",
    });
  });

  it("템플릿은 가장 최근의 비-CANCELED 출발편 (가격·정책 승계)", () => {
    const plan = planTopUp(
      [
        product([
          dep({ departureDate: d("2026-03-01"), returnDate: d("2026-03-05"), priceAdult: 1_000_000 }),
          dep({ departureDate: d("2026-06-01"), returnDate: d("2026-06-04"), priceAdult: 1_500_000, penaltyPolicyKey: "strict" }),
          dep({ departureDate: d("2026-07-01"), status: "CANCELED", priceAdult: 9_990_000 }),
        ]),
      ],
      NOW,
      OPTS,
    );
    expect(plan[0].priceAdult).toBe(1_500_000);
    expect(plan[0].penaltyPolicyKey).toBe("strict");
    expect(plan[0].returnDate.toISOString().slice(0, 10)).toBe("2026-10-30"); // 3일 기간
  });

  it("출발편이 아예 없으면 상품 기본가 폴백 (아동=성인 동일가, 유아 0, 기본 좌석)", () => {
    const plan = planTopUp([product([])], NOW, OPTS);
    expect(plan).toHaveLength(3);
    expect(plan[0]).toMatchObject({
      priceAdult: 1_390_000,
      priceChild: 1_390_000,
      priceInfant: 0,
      capacity: FALLBACK_CAPACITY,
      minPax: FALLBACK_MIN_PAX,
      penaltyPolicyKey: null,
      source: "fallback",
    });
    // 기간 = durationNights
    expect(plan[0].returnDate.toISOString().slice(0, 10)).toBe("2026-10-31");
  });

  it("이미 미래 예약 가능 출발편이 있으면 계획 0 (재실행 멱등)", () => {
    expect(planTopUp([product([dep({ departureDate: d("2026-11-01") })])], NOW, OPTS)).toEqual([]);
  });

  it("후보일이 기존 출발편(예: 미래 CANCELED)과 겹치면 건너뛰고 다음 간격으로 채워 count 유지 (@@unique 충돌 회피)", () => {
    const plan = planTopUp(
      [product([dep(), dep({ departureDate: d("2026-10-27"), returnDate: d("2026-10-31"), status: "CANCELED" })])],
      NOW,
      OPTS,
    );
    expect(plan.map((p) => p.departureDate.toISOString().slice(0, 10))).toEqual([
      "2026-11-10",
      "2026-11-24",
      "2026-12-08",
    ]);
  });

  it("입력 배열을 변이하지 않는다", () => {
    const departures = [dep({ departureDate: d("2026-06-01") }), dep({ departureDate: d("2026-03-01") })];
    const snapshot = departures.map((x) => x.departureDate.toISOString());
    planTopUp([product(departures)], NOW, OPTS);
    expect(departures.map((x) => x.departureDate.toISOString())).toEqual(snapshot);
  });

  it("금액은 정수만 — 비정수 기본가는 거부", () => {
    expect(() => planTopUp([product([], { basePriceAdult: 1_390_000.5 })], NOW, OPTS)).toThrow(RangeError);
  });

  it("잘못된 옵션 거부 (count/interval ≥1, lead ≥0 정수)", () => {
    expect(() => planTopUp([], NOW, { ...OPTS, count: 0 })).toThrow(RangeError);
    expect(() => planTopUp([], NOW, { ...OPTS, intervalDays: 0 })).toThrow(RangeError);
    expect(() => planTopUp([], NOW, { ...OPTS, leadDays: -1 })).toThrow(RangeError);
    expect(() => planTopUp([], NOW, { ...OPTS, count: 1.5 })).toThrow(RangeError);
  });
});
