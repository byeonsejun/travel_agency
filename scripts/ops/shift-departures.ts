/**
 * shift-departures.ts — 데모 데이터 출발일 일괄 이동 (운영 데모 사이트 "출발일 미정" 복구용).
 *
 * 배경: 시드·데모 출발일은 적재 시점 기준 상대일이라 시간이 지나면 전부 과거가 되어
 * ProductCard 가 "출발일 미정"을 띄우고 예약·결제 동선이 막힌다. 재시드는 비-시드 상품·
 * 예약·임베딩을 지우므로, 모든 Departure 의 departureDate/returnDate 를 **같은 일수만큼**
 * 뒤로 민다(상대 간격·좌석·가격·상태 불변). 가장 이른 출발일이 (오늘 + leadDays) 가 되도록.
 *
 * 안전장치:
 *  - 기본은 DRY-RUN(조회만). `--apply` 를 줘야 UPDATE 한다.
 *  - 단일 트랜잭션 UPDATE — 부분 적용 없음.
 *  - 멱등: 이미 최소 출발일이 목표일 이후면 이동 0.
 *  - 되돌리기: 출력된 shiftDays 를 음수로 `--days=-N --apply` 하면 원복.
 *
 * 실행:
 *   npx tsx --env-file=<env 파일> scripts/ops/shift-departures.ts              # dry-run
 *   npx tsx --env-file=<env 파일> scripts/ops/shift-departures.ts --apply      # 적용
 *   옵션: --lead=<일수>(기본 1)  --days=<일수>(계산 대신 고정 이동, 원복용)
 *
 * 주의: Prisma 만 사용하고 앱 env 스키마(@/shared/lib/env)는 import 하지 않는다 —
 * DATABASE_URL 하나만 있으면 동작하도록(운영 env 의 다른 키 유무와 무관).
 * 이동 후 홈은 최대 5분, PDP 는 최대 1시간 캐시(use cache) — 즉시 반영이 필요하면 재배포.
 */
import { PrismaClient } from "@prisma/client";

const DAY_MS = 86_400_000;

/** 가장 이른 출발일을 (오늘 UTC 자정 + leadDays) 로 맞추는 이동 일수. 이미 이후면 0. */
export function computeShiftDays(minDeparture: Date, now: Date, leadDays: number): number {
  if (!Number.isInteger(leadDays) || leadDays < 0) {
    throw new RangeError(`leadDays 는 0 이상의 정수여야 합니다: ${leadDays}`);
  }
  const target = new Date(now);
  target.setUTCHours(0, 0, 0, 0);
  target.setUTCDate(target.getUTCDate() + leadDays);
  const days = Math.ceil((target.getTime() - minDeparture.getTime()) / DAY_MS);
  return Math.max(0, days);
}

function argValue(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

type Summary = { mn: Date | null; mx: Date | null; total: number; future: number; booked: number };

async function summarize(db: PrismaClient): Promise<Summary> {
  const [row] = await db.$queryRaw<
    Array<{ mn: Date | null; mx: Date | null; total: bigint; future: bigint; booked: bigint }>
  >`SELECT MIN("departureDate") mn, MAX("departureDate") mx, COUNT(*) total,
           COUNT(*) FILTER (WHERE "departureDate" >= date_trunc('day', now()) AND status = 'SCHEDULED') future,
           COUNT(*) FILTER (WHERE "bookedSeats" > 0) booked
      FROM "Departure"`;
  return {
    mn: row.mn,
    mx: row.mx,
    total: Number(row.total),
    future: Number(row.future),
    booked: Number(row.booked),
  };
}

const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "-");

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const lead = Number(argValue("lead") ?? "1");
  const fixedDays = argValue("days");

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 미설정 — --env-file 확인");
  const host = new URL(url).hostname;

  const db = new PrismaClient();
  try {
    const before = await summarize(db);
    if (!before.mn) {
      console.log(`[${host}] Departure 0건 — 할 일 없음`);
      return;
    }
    const days = fixedDays !== undefined ? Number(fixedDays) : computeShiftDays(before.mn, new Date(), lead);
    if (!Number.isInteger(days)) throw new RangeError(`--days 는 정수여야 합니다: ${fixedDays}`);

    const shift = (d: Date | null) => (d ? new Date(d.getTime() + days * DAY_MS) : null);
    console.log(`DB host            : ${host}`);
    console.log(`모드               : ${apply ? "APPLY (실제 변경)" : "DRY-RUN (조회만)"}`);
    console.log(`Departure 전체      : ${before.total}건 (예약 좌석 있는 출발편 ${before.booked}건 — 이 예약들의 여행 일정도 함께 이동)`);
    console.log(`현재 출발일 범위    : ${fmt(before.mn)} ~ ${fmt(before.mx)} / 오늘 이후 SCHEDULED ${before.future}건`);
    console.log(`이동 일수           : ${days}일`);
    console.log(`이동 후 출발일 범위 : ${fmt(shift(before.mn))} ~ ${fmt(shift(before.mx))}`);

    if (days === 0) {
      console.log("→ 이미 최소 출발일이 목표일 이후 — 이동하지 않음");
      return;
    }
    if (!apply) {
      console.log("→ DRY-RUN 종료. 적용하려면 같은 명령에 --apply 를 붙여 재실행");
      return;
    }

    const updated = await db.$transaction(async (tx) =>
      tx.$executeRaw`UPDATE "Departure"
         SET "departureDate" = "departureDate" + make_interval(days => ${days}::int),
             "returnDate"    = "returnDate"    + make_interval(days => ${days}::int)`,
    );
    const after = await summarize(db);
    console.log(`✅ ${updated}건 이동 완료 → ${fmt(after.mn)} ~ ${fmt(after.mx)} / 오늘 이후 SCHEDULED ${after.future}건`);
    console.log(`   되돌리기: 같은 명령에 --days=${-days} --apply`);
  } finally {
    await db.$disconnect();
  }
}

// 테스트에서 import 시 실행하지 않도록 직접 실행일 때만 main.
if (process.argv[1]?.endsWith("shift-departures.ts")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
