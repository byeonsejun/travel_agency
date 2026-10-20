/**
 * topup-departures.ts — 미래 출발편이 없는 상품에 앞으로의 출발 일정을 "보충"한다. [ADR-0063]
 *
 * 배경: 시드·데모 출발일은 적재 시점 기준 상대일이라 시간이 지나면 전부 과거가 되어
 * ProductCard 가 "출발일 미정"을 띄우고 예약 동선이 막힌다. shift-departures.ts(전체 이동)는
 * 기존 출발편 — 예약이 달린 것 포함 — 의 날짜를 움직인다. 이 스크립트는 **기존 행을 0건 수정**하고,
 * 오늘 이후 예약 가능한(SCHEDULED/CONFIRMED) 출발편이 하나도 없는 PUBLISHED 상품에만
 * 새 Departure 를 INSERT 한다(bookedSeats=0, status=SCHEDULED).
 *
 * 보충 규칙 (순수 함수 planTopUp — 단위 테스트 SSOT):
 *  - 템플릿 = 가장 최근의 비-CANCELED 출발편(없으면 가장 최근 출발편). 가격·좌석·최소인원·
 *    위약금 정책 키·여행 기간(return-departure)을 승계.
 *  - 출발편이 아예 없으면 상품 폴백: 성인=아동=basePriceAdult(정수 원), 유아 0,
 *    좌석 FALLBACK_CAPACITY / 최소 FALLBACK_MIN_PAX, 기간 = durationNights.
 *  - 날짜 = 오늘(UTC 자정)+lead 부터 interval 간격 count 건. 기존 출발일과 겹치면 건너뛴다
 *    (@@unique([productId, departureDate])).
 *
 * 안전장치:
 *  - 기본은 DRY-RUN(조회만). `--apply` 를 줘야 INSERT 한다.
 *  - 단일 트랜잭션 안에서 재조회 → 재계획 → createMany(skipDuplicates). 부분 적용 없음.
 *  - 멱등: 미래 출발편이 생긴 상품은 계획 대상에서 빠지므로 재실행 시 0건.
 *  - 되돌리기: 출력된 생성 id 목록을 삭제(bookedSeats=0 이고 예약이 붙기 전이라면 안전).
 *
 * 실행:
 *   npx tsx --env-file=<env 파일> scripts/ops/topup-departures.ts            # dry-run
 *   npx tsx --env-file=<env 파일> scripts/ops/topup-departures.ts --apply    # 적용
 *   옵션: --count=<건수>(기본 4)  --interval=<일수>(기본 14)  --lead=<일수>(기본 7)
 *
 * 주의: Prisma 만 사용하고 앱 env 스키마(@/shared/lib/env)는 import 하지 않는다 —
 * DATABASE_URL 하나만 있으면 동작하도록(shift-departures.ts 와 동일 방침).
 * 반영: 홈 ≤5분, PDP ≤1시간(use cache), 체크아웃 즉시.
 */
import { type DepartureStatus, PrismaClient } from "@prisma/client";

const DAY_MS = 86_400_000;

export const FALLBACK_CAPACITY = 20;
export const FALLBACK_MIN_PAX = 8;

const BOOKABLE: ReadonlySet<DepartureStatus> = new Set<DepartureStatus>(["SCHEDULED", "CONFIRMED"]);

export type TemplateDeparture = {
  departureDate: Date;
  returnDate: Date;
  priceAdult: number;
  priceChild: number;
  priceInfant: number;
  capacity: number;
  minPax: number;
  status: DepartureStatus;
  penaltyPolicyKey: string | null;
};

export type ProductForTopUp = {
  id: string;
  basePriceAdult: number;
  durationNights: number;
  departures: TemplateDeparture[];
};

export type TopUpOptions = { count: number; intervalDays: number; leadDays: number };

export type PlannedDeparture = {
  productId: string;
  departureDate: Date;
  returnDate: Date;
  priceAdult: number;
  priceChild: number;
  priceInfant: number;
  capacity: number;
  minPax: number;
  penaltyPolicyKey: string | null;
  source: "template" | "fallback";
};

function utcMidnight(now: Date): Date {
  const t = new Date(now);
  t.setUTCHours(0, 0, 0, 0);
  return t;
}

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

function assertInt(name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${name} 는 ${min} 이상의 정수여야 합니다: ${value}`);
  }
}

/** 오늘(UTC 자정) 이후 예약 가능한(SCHEDULED/CONFIRMED) 출발편이 하나라도 있는가. */
export function hasBookableFuture(departures: readonly TemplateDeparture[], now: Date): boolean {
  const today = utcMidnight(now).getTime();
  return departures.some((d) => d.departureDate.getTime() >= today && BOOKABLE.has(d.status));
}

function pickTemplate(departures: readonly TemplateDeparture[]): TemplateDeparture | undefined {
  const latestFirst = departures.toSorted((a, b) => b.departureDate.getTime() - a.departureDate.getTime());
  return latestFirst.find((d) => d.status !== "CANCELED") ?? latestFirst[0];
}

/** 미래 예약 가능 출발편이 없는 상품마다 보충할 출발편 목록을 계산한다(부수효과 없음). */
export function planTopUp(products: readonly ProductForTopUp[], now: Date, opts: TopUpOptions): PlannedDeparture[] {
  assertInt("count", opts.count, 1);
  assertInt("intervalDays", opts.intervalDays, 1);
  assertInt("leadDays", opts.leadDays, 0);

  const start = addDays(utcMidnight(now), opts.leadDays);
  const plan: PlannedDeparture[] = [];

  for (const p of products) {
    if (hasBookableFuture(p.departures, now)) continue;

    const template = pickTemplate(p.departures);
    const base = template
      ? {
          priceAdult: template.priceAdult,
          priceChild: template.priceChild,
          priceInfant: template.priceInfant,
          capacity: template.capacity,
          minPax: template.minPax,
          penaltyPolicyKey: template.penaltyPolicyKey,
          tripDays: Math.round((template.returnDate.getTime() - template.departureDate.getTime()) / DAY_MS),
          source: "template" as const,
        }
      : {
          priceAdult: p.basePriceAdult,
          priceChild: p.basePriceAdult,
          priceInfant: 0,
          capacity: FALLBACK_CAPACITY,
          minPax: FALLBACK_MIN_PAX,
          penaltyPolicyKey: null,
          tripDays: p.durationNights,
          source: "fallback" as const,
        };
    // 돈은 정수(원)만 — [domain-booking R6]
    assertInt("priceAdult", base.priceAdult, 0);
    assertInt("priceChild", base.priceChild, 0);
    assertInt("priceInfant", base.priceInfant, 0);

    const taken = new Set(p.departures.map((d) => d.departureDate.getTime()));
    let added = 0;
    for (let i = 0; added < opts.count; i++) {
      const departureDate = addDays(start, i * opts.intervalDays);
      if (taken.has(departureDate.getTime())) continue;
      const { tripDays, ...rest } = base;
      plan.push({ productId: p.id, departureDate, returnDate: addDays(departureDate, tripDays), ...rest });
      added++;
    }
  }
  return plan;
}

function argNumber(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  return raw === undefined ? fallback : Number(raw);
}

const fmt = (d: Date) => d.toISOString().slice(0, 10);

type Db = Pick<PrismaClient, "product">;

function loadPublished(db: Db) {
  return db.product.findMany({
    where: { status: "PUBLISHED" },
    select: {
      id: true,
      title: true,
      basePriceAdult: true,
      durationNights: true,
      departures: {
        select: {
          departureDate: true,
          returnDate: true,
          priceAdult: true,
          priceChild: true,
          priceInfant: true,
          capacity: true,
          minPax: true,
          status: true,
          penaltyPolicyKey: true,
        },
      },
    },
  });
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const opts: TopUpOptions = {
    count: argNumber("count", 4),
    intervalDays: argNumber("interval", 14),
    leadDays: argNumber("lead", 7),
  };

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 미설정 — --env-file 확인");
  const host = new URL(url).hostname;

  const db = new PrismaClient();
  try {
    const now = new Date();
    const products = await loadPublished(db);
    const stale = products.filter((p) => !hasBookableFuture(p.departures, now));
    const plan = planTopUp(products, now, opts);

    console.log(`DB host                         : ${host}`);
    console.log(`모드                            : ${apply ? "APPLY (실제 INSERT)" : "DRY-RUN (조회만)"}`);
    console.log(`옵션                            : count=${opts.count} interval=${opts.intervalDays}d lead=${opts.leadDays}d`);
    console.log(`PUBLISHED 상품                  : ${products.length}건`);
    console.log(`오늘 이후 예약가능 출발편 0건 상품 : ${stale.length}건`);
    for (const p of stale) {
      const rows = plan.filter((x) => x.productId === p.id);
      console.log(
        `  - ${p.title} (${p.id}) [${rows[0]?.source}] → ${rows.map((r) => fmt(r.departureDate)).join(", ")}` +
          ` / 성인 ${rows[0]?.priceAdult.toLocaleString("ko-KR")}원`,
      );
    }

    if (plan.length === 0) {
      console.log("→ 보충할 상품 없음");
      return;
    }
    if (!apply) {
      console.log(`→ DRY-RUN 종료 (${plan.length}건 생성 예정). 적용하려면 같은 명령에 --apply`);
      return;
    }

    // Tx 안에서 재조회·재계획 — dry-run 출력과 실행 사이의 변경(관리자 등록 등)에도 멱등.
    const created = await db.$transaction(async (tx) => {
      const fresh = planTopUp(await loadPublished(tx), now, opts);
      const res = await tx.departure.createMany({
        data: fresh.map(({ source: _source, ...row }) => ({ ...row, status: "SCHEDULED" as const })),
        skipDuplicates: true,
      });
      return res.count;
    });
    const remaining = (await loadPublished(db)).filter((p) => !hasBookableFuture(p.departures, new Date())).length;
    console.log(`✅ Departure ${created}건 생성 → 오늘 이후 예약가능 출발편 0건 상품: ${remaining}건`);
  } finally {
    await db.$disconnect();
  }
}

// 테스트에서 import 시 실행하지 않도록 직접 실행일 때만 main.
if (process.argv[1]?.endsWith("topup-departures.ts")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
