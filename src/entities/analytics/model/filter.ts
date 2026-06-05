// src/entities/analytics/model/filter.ts
import type { DashboardFilter } from "./types";

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 30;
const DAY_BUCKET_MAX = 92;
const PRODUCT_ID_RE = /^[a-z0-9]+$/i; // 느슨한 형식; 존재 검증은 조인이 담당
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface DashboardFilterInput {
  start?: string | string[];
  end?: string | string[];
  productId?: string | string[];
  range?: string | string[]; // 레거시 ?range= 매핑용
}

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

const dayStr = (d: Date): string => d.toISOString().slice(0, 10);

/** "YYYY-MM-DD" → UTC 자정 Date, 형식 불일치/무효는 null. */
function parseDay(raw: string | undefined): Date | null {
  if (!raw || !DAY_RE.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 레거시 range key → 일수(start 폴백 폭). 모르면 null. */
function legacyRangeDays(raw: string | undefined): number | null {
  switch (raw) {
    case "today":
      return 0;
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
    case "all":
      return 100 * 365; // 사실상 epoch 근사 → bucket=month 유도
    default:
      return null;
  }
}

export function parseFilter(input: DashboardFilterInput): DashboardFilter {
  const todayMidnight = new Date();
  todayMidnight.setUTCHours(0, 0, 0, 0);

  let startDay = parseDay(first(input.start));
  let endDay = parseDay(first(input.end));

  // end 폴백 = 오늘, 미래 클램프
  if (!endDay) endDay = todayMidnight;
  if (endDay.getTime() > todayMidnight.getTime()) endDay = todayMidnight;

  // start 폴백 = end − (레거시 일수 || 기본 30일)
  if (!startDay) {
    const days = legacyRangeDays(first(input.range)) ?? DEFAULT_DAYS;
    startDay = new Date(endDay.getTime() - days * DAY_MS);
    startDay.setUTCHours(0, 0, 0, 0);
  }

  // 역전 스왑
  if (startDay.getTime() > endDay.getTime()) {
    const t = startDay;
    startDay = endDay;
    endDay = t;
  }

  const from = startDay;
  const to = new Date(endDay.getTime() + DAY_MS); // endDay 포함 → 미포함 상한

  const spanDays = Math.round((to.getTime() - from.getTime()) / DAY_MS);
  const bucket: "day" | "month" = spanDays <= DAY_BUCKET_MAX ? "day" : "month";

  const rawPid = first(input.productId);
  const productId =
    rawPid && PRODUCT_ID_RE.test(rawPid) ? rawPid : null;

  return {
    from,
    to,
    bucket,
    productId,
    cacheKey: {
      startDay: dayStr(startDay),
      endDay: dayStr(endDay),
      product: productId ?? "all",
    },
  };
}
