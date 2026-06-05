// src/entities/analytics/model/presets.ts
export type PresetKey = "today" | "7d" | "30d" | "90d" | "all";

export interface PresetRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "오늘" },
  { key: "7d", label: "7일" },
  { key: "30d", label: "30일" },
  { key: "90d", label: "90일" },
  { key: "all", label: "전체" },
];

const DAY_MS = 86_400_000;
const dayStr = (d: Date): string => d.toISOString().slice(0, 10);

export function presetRange(key: PresetKey, now: Date = new Date()): PresetRange {
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  const endStr = dayStr(end);

  if (key === "today") return { start: endStr, end: endStr };
  if (key === "all") return { start: "2000-01-01", end: endStr };

  const days = key === "7d" ? 7 : key === "30d" ? 30 : 90;
  const start = new Date(end.getTime() - days * DAY_MS);
  return { start: dayStr(start), end: endStr };
}
