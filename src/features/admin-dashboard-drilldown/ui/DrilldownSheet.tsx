"use client";
import { useEffect, useRef, useState } from "react";
import type { CsvColumn } from "@/shared/lib/csv/toCsv";
import {
  DRILLDOWN_COLUMNS,
  DRILLDOWN_LABEL,
  type DrilldownData,
  type DrilldownMetric,
} from "@/entities/analytics";
import { loadDrilldownAction } from "../server/actions";
import { downloadCsv } from "../lib/downloadCsv";

function fmtCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  return typeof v === "number" ? v.toLocaleString("ko-KR") : v;
}

export function DrilldownSheet({
  metric,
  start,
  end,
  productId,
  onClose,
}: {
  metric: DrilldownMetric;
  start: string;
  end: string;
  productId: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<DrilldownData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const tokenRef = useRef(0);

  // 데이터 로드 (메트릭 전환 시 stale 응답 무시).
  useEffect(() => {
    const token = ++tokenRef.current;
    setLoading(true);
    setError(null);
    setData(null);
    loadDrilldownAction({ metric, start, end, productId: productId ?? undefined })
      .then((res) => {
        if (token !== tokenRef.current) return; // stale
        if (res.type === "error") setError(res.message);
        else setData(res.data);
      })
      .catch(() => {
        if (token === tokenRef.current) setError("데이터 조회 실패");
      })
      .finally(() => {
        if (token === tokenRef.current) setLoading(false);
      });
  }, [metric, start, end, productId]);

  // ESC 닫기 (리스너 cleanup 필수).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleCsv = () => {
    if (!data) return;
    const cols = DRILLDOWN_COLUMNS[data.metric] as CsvColumn<unknown>[];
    const span = `${start}_${end}`.replace(/-/g, "");
    const scope = productId ? "product" : "all";
    downloadCsv(data.result.rows as unknown[], cols, `nextour_${data.metric}_${scope}_${span}.csv`);
  };

  const columns = (DRILLDOWN_COLUMNS[metric] as CsvColumn<unknown>[]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-3xl flex-col bg-card shadow-xl">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-bold text-foreground">{DRILLDOWN_LABEL[metric]}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCsv}
              disabled={!data || data.result.rows.length === 0}
              className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              CSV 다운로드{data ? ` (${data.result.rows.length}건)` : ""}
            </button>
            <button onClick={onClose} aria-label="닫기" className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted">
              닫기
            </button>
          </div>
        </header>

        {data?.result.capped && (
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-800">
            전체 {data.result.total.toLocaleString("ko-KR")}건 중 상위 5,000건만 표시·추출됩니다.
          </div>
        )}

        <div className="flex-1 overflow-auto px-5 py-3">
          {loading && <p className="py-10 text-center text-sm text-muted-foreground">불러오는 중…</p>}
          {error && <p className="py-10 text-center text-sm text-red-600">{error}</p>}
          {data && data.result.rows.length === 0 && !loading && (
            <p className="py-10 text-center text-sm text-muted-foreground">해당 기간 데이터가 없습니다.</p>
          )}
          {data && data.result.rows.length > 0 && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 border-b border-border bg-muted text-left">
                <tr>
                  {columns.map((c) => (
                    <th key={c.header} className="whitespace-nowrap px-2 py-2 font-medium text-foreground">{c.header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.result.rows.map((row, i) => (
                  <tr key={i} className="border-b border-border">
                    {columns.map((c) => (
                      <td key={c.header} className="whitespace-nowrap px-2 py-1.5 text-foreground">{fmtCell(c.value(row))}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
