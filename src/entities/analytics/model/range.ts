import type { DateRange, RangeKey } from "./types";

const VALID: ReadonlySet<RangeKey> = new Set([
  "today",
  "7d",
  "30d",
  "90d",
  "all",
]);

const DAYS: Record<Exclude<RangeKey, "all" | "today">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/**
 * searchParam(string | string[] | undefined) → DateRange.
 * 미지정·오타·배열 입력은 모두 "30d"로 폴백(.catch 정신). useState 미사용 — URL이 SSOT.
 */
export function parseRange(raw: unknown): DateRange {
  const key: RangeKey =
    typeof raw === "string" && VALID.has(raw as RangeKey)
      ? (raw as RangeKey)
      : "30d";

  const to = new Date();

  if (key === "all") {
    return { from: new Date(0), to, key, bucket: "month" };
  }

  if (key === "today") {
    const from = new Date(to);
    from.setUTCHours(0, 0, 0, 0);
    // to는 오늘 자정 이후이므로, 자정에 호출된 경우에도 from < to 를 보장하기 위해
    // 상한을 내일 자정(= 오늘 범위의 미포함 상한)으로 설정한다.
    const tomorrowMidnight = new Date(from.getTime() + 86_400_000);
    return { from, to: tomorrowMidnight, key, bucket: "day" };
  }

  const from = new Date(to.getTime() - DAYS[key] * 86_400_000);
  return { from, to, key, bucket: "day" };
}
