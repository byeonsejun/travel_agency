"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PRESETS, presetRange } from "@/entities/analytics";

export function DateRangePicker({
  start,
  end,
}: {
  start: string;
  end: string;
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
      <div className="inline-flex gap-0.5 rounded-lg border border-gray-200 bg-white p-1 text-[12px]">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => {
              const r = presetRange(p.key);
              setDraftStart(r.start);
              setDraftEnd(r.end);
              pushWith(r.start, r.end);
            }}
            className="rounded-md px-2.5 py-1 text-gray-500 hover:bg-gray-100"
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
        className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[12.5px] text-gray-700"
      />
      <span className="text-gray-400">~</span>
      <label className="sr-only" htmlFor="dash-end">
        종료일
      </label>
      <input
        id="dash-end"
        aria-label="종료일"
        type="date"
        value={draftEnd}
        onChange={(e) => setDraftEnd(e.target.value)}
        className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[12.5px] text-gray-700"
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
