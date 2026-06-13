"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PresetKey } from "@/entities/analytics";

// 서버 부모(AdminDashboard)가 presetRange를 미리 계산해 주입한다.
// [ADR-0053] 'use cache'를 품은 @/entities/analytics 배럴을 client가 값(value)으로
// import하면 서버 그래프가 client 번들로 누출돼 빌드가 깨진다 → type만 import + 나머지는 prop.
type PresetButton = { key: PresetKey; label: string; start: string; end: string };

export function DateRangePicker({
  start,
  end,
  presets,
}: {
  start: string;
  end: string;
  presets: PresetButton[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  // 로컬 편집 버퍼(비제어 대용). URL 이 SSOT지만 "적용" 전까지 입력 누적이 필요.
  const [draftStart, setDraftStart] = useState(start);
  const [draftEnd, setDraftEnd] = useState(end);

  const pushWith = (s: string, e: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("start", s);
    next.set("end", e);
    startTransition(() => {
      router.push(`/admin/dashboard?${next.toString()}`);
    });
  };

  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <div className="inline-flex gap-0.5 rounded-lg border border-border bg-background p-1 text-[12px]">
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => {
              setDraftStart(p.start);
              setDraftEnd(p.end);
              pushWith(p.start, p.end);
            }}
            className="rounded-md px-2.5 py-1 text-muted-foreground hover:bg-muted"
          >
            {p.label}
          </button>
        ))}
      </div>

      <label className="sr-only" htmlFor="dash-start">
        시작일
      </label>
      <input
        id="dash-start"
        aria-label="시작일"
        type="date"
        value={draftStart}
        onChange={(e) => setDraftStart(e.target.value)}
        className="rounded-lg border border-border bg-background px-2 py-1.5 text-[12.5px] text-foreground"
      />
      <span className="text-muted-foreground">~</span>
      <label className="sr-only" htmlFor="dash-end">
        종료일
      </label>
      <input
        id="dash-end"
        aria-label="종료일"
        type="date"
        value={draftEnd}
        onChange={(e) => setDraftEnd(e.target.value)}
        className="rounded-lg border border-border bg-background px-2 py-1.5 text-[12.5px] text-foreground"
      />
      <button
        type="button"
        onClick={() => pushWith(draftStart, draftEnd)}
        disabled={isPending}
        aria-busy={isPending}
        className={`rounded-lg bg-red-700 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-red-800 ${
          isPending ? "opacity-50" : ""
        }`}
      >
        적용
      </button>
    </div>
  );
}
