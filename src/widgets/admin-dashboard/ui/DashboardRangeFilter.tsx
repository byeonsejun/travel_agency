import Link from "next/link";
import type { RangeKey } from "@/entities/analytics";

const TABS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "오늘" },
  { key: "7d", label: "7일" },
  { key: "30d", label: "30일" },
  { key: "90d", label: "90일" },
  { key: "all", label: "전체" },
];

// useState 미사용 — 각 탭은 ?range= 링크. 활성 탭은 현재 key 비교.
export function DashboardRangeFilter({ active }: { active: RangeKey }) {
  return (
    <div className="inline-flex gap-0.5 rounded-lg border border-gray-200 bg-white p-1 text-[12.5px]">
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={`/admin/dashboard?range=${t.key}`}
            className={
              on
                ? "rounded-md bg-red-700 px-3 py-1.5 font-semibold text-white"
                : "rounded-md px-3 py-1.5 text-gray-500 hover:bg-gray-100"
            }
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
